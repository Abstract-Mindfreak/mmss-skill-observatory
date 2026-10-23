import { createHash } from 'node:crypto'
import { db } from '@/lib/db'

export type InstructionContextMode = 'none' | 'selected' | 'full'

export interface InstructionContextSelection {
  mode: InstructionContextMode
  versionId: string | null
  fragmentIds: string[]
  includeParentSections: boolean
  includeTableOfContents?: boolean
}

export interface InstructionContextProvenance {
  mode: InstructionContextMode | 'unknown'
  versionId: string | null
  versionLabel: string | null
  fullVersionSha256: string | null
  fullVersionChars: number | null
  selectedFragmentIds: string[]
  includedFragmentIds: string[]
  sentContextSha256: string | null
  sentContextChars: number
  text: string
}

const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

export function instructionContextDigest(text: string): string { return digest(text) }

export function normalizeInstructionContextSelection(input: unknown): InstructionContextSelection {
  if (!input || typeof input !== 'object') return { mode: 'none', versionId: null, fragmentIds: [], includeParentSections: false }
  const value = input as Record<string, unknown>
  const mode = value.mode
  if (mode !== 'none' && mode !== 'selected' && mode !== 'full') throw new Error('Неизвестный режим контекста инструкции')
  const ids = Array.isArray(value.fragmentIds) ? value.fragmentIds.filter((id): id is string => typeof id === 'string') : []
  if (Array.isArray(value.fragmentIds) && ids.length !== value.fragmentIds.length) throw new Error('Некорректный ID фрагмента')
  return { mode, versionId: typeof value.versionId === 'string' ? value.versionId : null, fragmentIds: ids, includeParentSections: value.includeParentSections === true }
}

export async function resolveInstructionContext(input: {
  projectId: string
  selection?: InstructionContextSelection | null
  fallbackVersionId?: string | null
}): Promise<InstructionContextProvenance> {
  const selection = input.selection ?? {
    mode: 'none', versionId: input.fallbackVersionId ?? null, fragmentIds: [], includeParentSections: false,
  }
  if (!selection || typeof selection !== 'object' || typeof selection.mode !== 'string' || !Array.isArray(selection.fragmentIds) || typeof selection.includeParentSections !== 'boolean') throw new Error('Некорректный выбор контекста инструкции')
  if (selection.fragmentIds.some((id) => typeof id !== 'string' || id.length > 200)) throw new Error('Некорректный ID фрагмента')
  if (!['none', 'selected', 'full'].includes(selection.mode)) throw new Error('Неизвестный режим контекста инструкции')
  const versionId = selection.versionId ?? input.fallbackVersionId ?? null
  if (selection.mode === 'none') {
    return { mode: 'none', versionId, versionLabel: null, fullVersionSha256: null, fullVersionChars: null, selectedFragmentIds: [], includedFragmentIds: [], sentContextSha256: null, sentContextChars: 0, text: '' }
  }
  if (!versionId) throw new Error('Выберите версию инструкции для этого режима контекста')
  const version = await db.documentVersion.findFirst({ where: { id: versionId, projectId: input.projectId } })
  if (!version) throw new Error('Выбранная версия недоступна в текущем проекте. Выберите другую версию.')

  let rows: { id: string; path: string; title: string | null; text: string; order: number }[] = []
  if (selection.mode === 'full') {
    const text = version.content
    return {
      mode: 'full', versionId, versionLabel: version.label, fullVersionSha256: version.contentHash,
      fullVersionChars: version.content.length, selectedFragmentIds: [], includedFragmentIds: [],
      sentContextSha256: digest(text), sentContextChars: text.length, text,
    }
  }

  const requestedIds = [...new Set(selection.fragmentIds)]
  if (requestedIds.length === 0 && !selection.includeTableOfContents) throw new Error('Выберите хотя бы один фрагмент инструкции или включите оглавление')
  rows = requestedIds.length ? await db.fragment.findMany({
    where: { id: { in: requestedIds }, versionId }, orderBy: { order: 'asc' },
    select: { id: true, path: true, title: true, text: true, order: true },
  }) : []
  if (rows.length !== requestedIds.length) throw new Error('Один или несколько фрагментов не принадлежат выбранной версии')
  const selectedIds = rows.map((r) => r.id)
  const toc = selection.includeTableOfContents
    ? version.content.split('\n').filter((line) => /^#{1,2}\s+\S/.test(line)).map((line) => line.trim()).join('\n')
    : ''
  if (selection.includeParentSections) {
    const sectionRows = await db.fragment.findMany({ where: { versionId, kind: 'section' }, orderBy: { order: 'asc' }, select: { id: true, path: true, title: true, text: true, order: true } })
    const parents = sectionRows.filter((section) => rows.some((r) => r.path !== section.path && r.path.startsWith(`${section.path}.`)))
    const byId = new Map([...parents, ...rows].map((row) => [row.id, row]))
    rows = [...byId.values()].sort((a, b) => a.order - b.order)
  }
  const selectedText = rows.map((r) => `[[fragment id=${r.id} path=${r.path}${r.title ? ` title=${JSON.stringify(r.title)}` : ''}]]\n${r.text}`).join('\n\n')
  const text = [toc ? `=== TABLE OF CONTENTS · version ${versionId} ===\n${toc}` : '', selectedText].filter(Boolean).join('\n\n')
  return {
    mode: 'selected', versionId, versionLabel: version.label, fullVersionSha256: version.contentHash,
    fullVersionChars: version.content.length, selectedFragmentIds: selectedIds, includedFragmentIds: rows.map((r) => r.id),
    sentContextSha256: digest(text), sentContextChars: text.length, text,
  }
}
