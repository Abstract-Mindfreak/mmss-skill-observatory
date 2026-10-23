// Document/version creation pipeline + shared loaders for API responses
// (document DTO lists with counts, and the full AppStateDTO assembly).

import { db } from '@/lib/db'
import { buildFragmentsForVersion, extractKnownVersion } from '@/lib/parser'
import { runLocalAnalysis } from '@/lib/analysis'
import {
  analysisMeta,
  safeParse,
  sha256Hex,
  toChatMessageDTO,
  toConnectionDTO,
  toFindingDTO,
  toFragmentDTO,
  toNoteDTO,
  toProjectDTO,
  toRunDTO,
  toScenarioDTO,
  toVersionDTO,
} from '@/lib/serialize'
import type {
  AppStateDTO,
  AssignmentDTO,
  DocumentDTO,
  DocumentVersionDTO,
  FragmentDTO,
  NoteDTO,
  RoleId,
  ScenarioDTO,
} from '@/lib/types'
import type { Document, DocumentVersion as VersionRow, Note, Project } from '@prisma/client'

const FRAGMENT_BATCH = 200

export interface CreateDocumentInput {
  projectId: string
  title: string
  content: string
  source: string
  sourceUrl?: string | null
  knownVersion?: string | null
  note?: string | null
  label?: string
  kind?: string
  completeness?: string
  isActive?: boolean
}

export async function createDocumentWithVersion(
  input: CreateDocumentInput
): Promise<{ document: Document; version: VersionRow }> {
  const contentHash = sha256Hex(input.content)
  const knownVersion =
    input.knownVersion !== undefined && input.knownVersion !== null
      ? input.knownVersion
      : extractKnownVersion(input.content)

  const document = await db.document.create({
    data: { projectId: input.projectId, title: input.title },
  })

  const isActive = input.isActive ?? false
  if (isActive) {
    await db.documentVersion.updateMany({
      where: { documentId: document.id, isActive: true },
      data: { isActive: false },
    })
  }

  const version = await db.documentVersion.create({
    data: {
      documentId: document.id,
      projectId: input.projectId,
      label: input.label ?? 'origin',
      kind: input.kind ?? 'original',
      source: input.source,
      sourceUrl: input.sourceUrl ?? null,
      knownVersion,
      completeness: input.completeness ?? 'full',
      content: input.content,
      contentHash,
      parentVersionId: null,
      note: input.note ?? null,
      isActive,
    },
  })

  const payloads = buildFragmentsForVersion(version.id, input.content)
  for (let i = 0; i < payloads.length; i += FRAGMENT_BATCH) {
    await db.fragment.createMany({ data: payloads.slice(i, i + FRAGMENT_BATCH) })
  }

  await runLocalAnalysis(version.id)
  return { document, version }
}

export async function reparseAndAnalyze(versionId: string): Promise<void> {
  const version = await db.documentVersion.findUnique({ where: { id: versionId } })
  if (!version) throw new Error('Версия не найдена')

  const oldFragments = await db.fragment.findMany({
    where: { versionId },
    select: { id: true, path: true },
  })
  const oldIdToPath = new Map(oldFragments.map((f) => [f.id, f.path]))

  await db.fragment.deleteMany({ where: { versionId } })
  await db.analysis.deleteMany({ where: { versionId, type: 'local-structural' } })

  const payloads = buildFragmentsForVersion(versionId, version.content)
  for (let i = 0; i < payloads.length; i += FRAGMENT_BATCH) {
    await db.fragment.createMany({ data: payloads.slice(i, i + FRAGMENT_BATCH) })
  }

  // keep scenario links valid across reparse: remap old fragment ids by path
  const created = await db.fragment.findMany({
    where: { versionId },
    select: { id: true, path: true },
  })
  const newPathToId = new Map<string, string>()
  for (const p of created) {
    if (!newPathToId.has(p.path)) newPathToId.set(p.path, p.id)
  }
  const scenarios = await db.scenario.findMany({
    where: { projectId: version.projectId, fragmentId: { not: null } },
  })
  for (const scenario of scenarios) {
    const oldPath = scenario.fragmentId ? oldIdToPath.get(scenario.fragmentId) : null
    if (!oldPath) continue
    const newId = newPathToId.get(oldPath)
    if (newId && newId !== scenario.fragmentId) {
      await db.scenario.update({ where: { id: scenario.id }, data: { fragmentId: newId } })
    }
  }

  await runLocalAnalysis(versionId)
}

// ---------- version DTO with computed counts ----------

interface VersionCounts {
  fragmentCount: number
  hasLocalAnalysis: boolean
  lastAnalysisAt: string | null
  childCount: number
}

async function versionCounts(versionIds: string[]): Promise<Map<string, VersionCounts>> {
  const out = new Map<string, VersionCounts>()
  if (versionIds.length === 0) return out
  const fragCounts = await db.fragment.groupBy({
    by: ['versionId'],
    _count: { _all: true },
    where: { versionId: { in: versionIds } },
  })
  const analyses = await db.analysis.findMany({
    where: { versionId: { in: versionIds }, type: 'local-structural' },
    select: { versionId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })
  const childCounts = await db.documentVersion.groupBy({
    by: ['parentVersionId'],
    _count: { _all: true },
    where: { parentVersionId: { in: versionIds } },
  })
  for (const id of versionIds) {
    const frag = fragCounts.find((g) => g.versionId === id)
    const lastAnalysis = analyses.find((a) => a.versionId === id)
    const children = childCounts.find((g) => g.parentVersionId === id)
    out.set(id, {
      fragmentCount: frag?._count._all ?? 0,
      hasLocalAnalysis: Boolean(lastAnalysis),
      lastAnalysisAt: lastAnalysis ? lastAnalysis.createdAt.toISOString() : null,
      childCount: children?._count._all ?? 0,
    })
  }
  return out
}

function sortVersions(versions: VersionRow[]): VersionRow[] {
  return [...versions].sort((x, y) => {
    const xOriginal = x.kind === 'original' ? 0 : 1
    const yOriginal = y.kind === 'original' ? 0 : 1
    if (xOriginal !== yOriginal) return xOriginal - yOriginal
    return x.importDate.getTime() - y.importDate.getTime()
  })
}

export async function loadDocumentDTOs(projectId: string): Promise<DocumentDTO[]> {
  const documents = await db.document.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
    include: { versions: true },
  })
  const allVersionIds = documents.flatMap((d) => d.versions.map((v) => v.id))
  const counts = await versionCounts(allVersionIds)
  return documents.map((d) => ({
    id: d.id,
    projectId: d.projectId,
    title: d.title,
    createdAt: d.createdAt.toISOString(),
    versions: sortVersions(d.versions).map((v) => toVersionDTO(v, counts.get(v.id))),
  }))
}

export async function loadDocumentDTO(documentId: string): Promise<DocumentDTO | null> {
  const document = await db.document.findUnique({
    where: { id: documentId },
    include: { versions: true },
  })
  if (!document) return null
  const counts = await versionCounts(document.versions.map((v) => v.id))
  return {
    id: document.id,
    projectId: document.projectId,
    title: document.title,
    createdAt: document.createdAt.toISOString(),
    versions: sortVersions(document.versions).map((v) => toVersionDTO(v, counts.get(v.id))),
  }
}

export async function loadVersionDTO(version: VersionRow): Promise<DocumentVersionDTO> {
  const counts = await versionCounts([version.id])
  return toVersionDTO(version, counts.get(version.id))
}

// ---------- AppStateDTO assembly (used by /api/state and /api/bootstrap) ----------

const ALL_ROLES: (RoleId | 'embedding')[] = [
  'executor', 'explorer', 'evaluator', 'challenger', 'editor',
  'assistant', 'interpreter', 'embedding',
]

export async function buildAppState(projectId?: string | null): Promise<AppStateDTO> {
  let project: Project | null = null
  if (projectId) {
    project = await db.project.findUnique({ where: { id: projectId } })
  }
  if (!project) {
    project = await db.project.findFirst({ orderBy: { createdAt: 'asc' } })
  }

  const seeded = (await db.setting.findUnique({ where: { key: 'seeded' } })) !== null

  if (!project) {
    return {
      project: null,
      documents: [],
      activeVersion: null,
      fragments: [],
      scenarios: [],
      runs: [],
      findings: [],
      notes: [],
      connections: [],
      assignments: [],
      chatMessages: [],
      analyses: [],
      sessionCloud: {
        available: false,
        note: 'Статус облачного бэкенда проверяется в разделе «Подключения»',
      },
      seeded,
    }
  }

  const documents = await loadDocumentDTOs(project.id)
  const allVersions = await db.documentVersion.findMany({
    where: { projectId: project.id },
    orderBy: { importDate: 'desc' },
  })
  const activeVersionRow =
    allVersions.find((v) => v.isActive) ?? allVersions[0] ?? null
  const activeVersion = activeVersionRow
    ? toVersionDTO(activeVersionRow, (await versionCounts([activeVersionRow.id])).get(activeVersionRow.id))
    : null

  const fragmentRows = activeVersionRow
    ? await db.fragment.findMany({
        where: { versionId: activeVersionRow.id },
        orderBy: { order: 'asc' },
      })
    : []
  const fragments: FragmentDTO[] = fragmentRows.map(toFragmentDTO)

  const scenarioRows = await db.scenario.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: 'asc' },
  })
  const runRowsForStatus = await db.run.findMany({
    where: { projectId: project.id },
    select: { scenarioId: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })
  const runCountByScenario = new Map<string, number>()
  const lastRunStatusByScenario = new Map<string, string>()
  for (const r of runRowsForStatus) {
    if (!r.scenarioId) continue
    runCountByScenario.set(r.scenarioId, (runCountByScenario.get(r.scenarioId) ?? 0) + 1)
    if (!lastRunStatusByScenario.has(r.scenarioId)) {
      lastRunStatusByScenario.set(r.scenarioId, r.status)
    }
  }
  const scenarios = scenarioRows.map((s) =>
    toScenarioDTO(s, {
      runCount: runCountByScenario.get(s.id) ?? 0,
      lastRunStatus: (lastRunStatusByScenario.get(s.id) ?? null) as ScenarioDTO['lastRunStatus'],
    })
  )

  const runRows = await db.run.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  const runs = runRows.map(toRunDTO)

  const findingRows = await db.finding.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: 'desc' },
  })
  const findings = findingRows.map(toFindingDTO)

  const noteRows = await db.note.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: 'asc' },
  })
  const notes: NoteDTO[] = noteRows.map((n: Note) => toNoteDTO(n))

  const connectionRows = await db.connection.findMany({ where: { projectId: null } })
  const allConnections = await db.connection.findMany()
  const connectionNameById = new Map(allConnections.map((c) => [c.id, c.name]))
  const connections = connectionRows.map(toConnectionDTO)

  const assignmentRows = await db.assignment.findMany({ where: { projectId: project.id } })
  const assignments: AssignmentDTO[] = ALL_ROLES.map((role) => {
    const row = assignmentRows.find((a) => a.role === role)
    if (!row) {
      return { role, backend: null, connectionId: null, connectionName: null, model: null }
    }
    return {
      role,
      backend: (row.backend as AssignmentDTO['backend']) ?? null,
      connectionId: row.connectionId,
      connectionName: row.connectionId
        ? connectionNameById.get(row.connectionId) ?? null
        : null,
      model: row.model,
    }
  })

  const chatRows = await db.chatMessage.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: 'desc' },
    take: 300,
  })
  const chatMessages = chatRows.reverse().map(toChatMessageDTO)

  const analysisRows = await db.analysis.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      versionId: true,
      type: true,
      backend: true,
      model: true,
      status: true,
      summary: true,
      fragmentCount: true,
      createdAt: true,
    },
  })
  const analyses = analysisRows.map((a) => analysisMeta(a as Parameters<typeof analysisMeta>[0]))

  return {
    project: toProjectDTO(project),
    documents,
    activeVersion,
    fragments,
    scenarios,
    runs,
    findings,
    notes,
    connections,
    assignments,
    chatMessages,
    analyses,
    sessionCloud: {
      available: false,
      note: 'Статус облачного бэкенда проверяется в разделе «Подключения»',
    },
    seeded,
  }
}
