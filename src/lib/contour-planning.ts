import { createHash } from 'node:crypto'

export interface ContourFragment {
  id: string
  versionId: string
  kind: string
  path: string
  order: number
  title: string | null
  text: string
}

export interface ContourCoverageEntry {
  fragmentId: string
  path: string
  kind: string
  status: 'pending' | 'structural' | 'duplicate-representation' | 'processed' | 'gap' | 'ambiguous' | 'error'
  classification: string | null
  reason: string | null
  linkedFragmentId: string | null
  positionIds: string[]
}

export interface ContourBlock {
  id: string
  sectionPath: string
  sectionTitle: string
  fragmentIds: string[]
  inputChars: number
  inputSha256: string
  status: 'pending' | 'running' | 'completed' | 'error' | 'interrupted'
  attempts: number
  analysisId: string | null
  modelCallId: string | null
  error: string | null
  rawResponse?: string | null
}

export interface ContourPositionProposal {
  title: string
  purpose: string
  regulatedDecision: string
  conditions: string
  expectedBehavior: string
  limitations: string
  fragmentIds: string[]
}

export interface ContourRelationProposal {
  sourceTitle: string
  targetTitle: string
  kind: 'clarifies' | 'limits' | 'requires' | 'excludes' | 'supports' | 'potential-conflict'
  rationale: string
}

export function buildDecisionFlow(caseLabel: string, positions: {
  id: string; title: string; purpose: string; regulatedDecision: string; conditions: string
  expectedBehavior: string; limitations: string; fragmentIds: string[]
}[]) {
  const caseText = caseLabel.trim()
  if (!caseText || positions.length === 0) throw new Error('Укажите ситуацию и хотя бы одно предложенное положение')
  return {
    id: `decision-flow-${createHash('sha256').update(`${caseText}\n${positions.map((position) => position.id).join('\n')}`).digest('hex').slice(0, 20)}`,
    status: 'proposed' as const,
    caseLabel: caseText,
    executed: false,
    nodes: positions.map((position, index) => ({
      nodeId: position.id,
      kind: 'condition' as const,
      provenance: 'instruction-interpretation' as const,
      status: 'proposed' as const,
      basis: position.purpose,
      positionIds: [position.id],
      order: index + 1,
      positionId: position.id,
      title: position.title,
      condition: position.conditions,
      applicableRule: position.purpose,
      check: position.regulatedDecision,
      expectedAction: position.expectedBehavior,
      exceptionOrLimit: position.limitations,
      allowedResult: null,
      uncertainty: position.limitations || 'В положении не указано.',
      sourceFragmentIds: position.fragmentIds,
    })),
    transitions: [] as DecisionFlowTransition[],
    limitation: 'Предложенная интерпретация выбранных положений; порядок узлов служит для чтения и не задаёт переходы. Фактическое исполнение не проверено.',
    createdAt: new Date().toISOString(),
  }
}

export type DecisionFlowNodeKind = 'condition' | 'action' | 'expected-result' | 'gap'
export type DecisionFlowStatus = 'proposed' | 'accepted' | 'disputed'
export type DecisionFlowTransition = {
  id: string; fromNodeId: string; toNodeId: string; conditionLabel: string; basis: string
  positionIds: string[]; sourceFragmentIds: string[]; provenance: 'instruction-interpretation' | 'user'
  status: DecisionFlowStatus; limitations: string
  decisionHistory?: { previousStatus: DecisionFlowStatus; newStatus: DecisionFlowStatus; basis: string; decidedAt: string; actorType: 'user' }[]
}

const RELATIONS = new Set<ContourRelationProposal['kind']>(['clarifies', 'limits', 'requires', 'excludes', 'supports', 'potential-conflict'])

export function parseContourProposals(value: unknown, allowedFragmentIds: Set<string>) {
  const root = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const positions: ContourPositionProposal[] = []
  if (Array.isArray(root.positions)) for (const item of root.positions) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const strings = ['title', 'purpose', 'regulatedDecision', 'conditions', 'expectedBehavior'] as const
    if (strings.some((field) => typeof row[field] !== 'string' || !(row[field] as string).trim())) continue
    const fragmentIds = Array.isArray(row.fragmentIds) ? [...new Set(row.fragmentIds.filter((id): id is string => typeof id === 'string' && allowedFragmentIds.has(id)))] : []
    if (!fragmentIds.length) continue
    positions.push({
      title: (row.title as string).trim(), purpose: (row.purpose as string).trim(),
      regulatedDecision: (row.regulatedDecision as string).trim(), conditions: (row.conditions as string).trim(),
      expectedBehavior: (row.expectedBehavior as string).trim(),
      limitations: typeof row.limitations === 'string' ? row.limitations.trim() : '', fragmentIds,
    })
  }
  const relations: ContourRelationProposal[] = []
  if (Array.isArray(root.relations)) for (const item of root.relations) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.sourceTitle !== 'string' || typeof row.targetTitle !== 'string' || typeof row.rationale !== 'string' || typeof row.kind !== 'string') continue
    const kind = row.kind as ContourRelationProposal['kind']
    if (!RELATIONS.has(kind) || !row.sourceTitle.trim() || !row.targetTitle.trim() || !row.rationale.trim()) continue
    relations.push({ sourceTitle: row.sourceTitle.trim(), targetTitle: row.targetTitle.trim(), kind, rationale: row.rationale.trim() })
  }
  return { positions, relations }
}

const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

function isUnder(path: string, parent: string) {
  return path !== parent && path.startsWith(`${parent}.`)
}

function nearestSection(fragment: ContourFragment, sections: ContourFragment[]) {
  return sections
    .filter((section) => section.path === fragment.path || isUnder(fragment.path, section.path))
    .sort((a, b) => b.path.length - a.path.length)[0]
}

/**
 * Select one non-overlapping source representation for interpretation:
 * list-item rows represent their nested sentence rows; paragraph and section
 * rows remain visible as structural coverage containers, not repeated input.
 */
export function buildContourPlan(fragments: ContourFragment[], limits = { maxItems: 16, maxChars: 7200 }) {
  const ordered = [...fragments].sort((a, b) => a.order - b.order)
  const sections = ordered.filter((fragment) => fragment.kind === 'section')
  const listItems = ordered.filter((fragment) => fragment.kind === 'list_item')
  const representedSentences = new Map<string, string>()
  for (const sentence of ordered.filter((fragment) => fragment.kind === 'sentence')) {
    const listParent = listItems
      .filter((item) => isUnder(sentence.path, item.path))
      .sort((a, b) => b.path.length - a.path.length)[0]
    if (listParent) representedSentences.set(sentence.id, listParent.id)
  }

  const selected = ordered.filter((fragment) =>
    fragment.text.trim().length > 0 &&
    (fragment.kind === 'list_item' || (fragment.kind === 'sentence' && !representedSentences.has(fragment.id)))
  )
  const coverage: ContourCoverageEntry[] = ordered.map((fragment) => {
    const representedBy = representedSentences.get(fragment.id)
    if (representedBy) return {
      fragmentId: fragment.id, path: fragment.path, kind: fragment.kind,
      status: 'duplicate-representation', classification: 'parser-overlap',
      reason: 'Предложение является вложенным представлением того же текста list_item; отдельная отправка исключена, исходный ID сохранён.',
      linkedFragmentId: representedBy, positionIds: [],
    }
    if (fragment.kind === 'section' || fragment.kind === 'paragraph') return {
      fragmentId: fragment.id, path: fragment.path, kind: fragment.kind,
      status: 'structural', classification: fragment.kind === 'section' ? 'section-context' : 'composite-container',
      reason: 'Структурный/составной уровень. Содержимое учитывается через дочерние единицы, чтобы не отправлять повторяющийся текст.',
      linkedFragmentId: null, positionIds: [],
    }
    if (!fragment.text.trim()) return {
      fragmentId: fragment.id, path: fragment.path, kind: fragment.kind,
      status: 'structural', classification: 'empty', reason: 'Пустой фрагмент не содержит индексируемого исходного текста.',
      linkedFragmentId: null, positionIds: [],
    }
    return {
      fragmentId: fragment.id, path: fragment.path, kind: fragment.kind,
      status: 'pending', classification: null, reason: null, linkedFragmentId: null, positionIds: [],
    }
  })

  const groups = new Map<string, { section: ContourFragment | null; items: ContourFragment[] }>()
  for (const fragment of selected) {
    const section = nearestSection(fragment, sections) ?? null
    const key = section?.path ?? '(root)'
    const group = groups.get(key) ?? { section, items: [] }
    group.items.push(fragment)
    groups.set(key, group)
  }

  const blocks: ContourBlock[] = []
  for (const [sectionPath, group] of groups) {
    let chunk: ContourFragment[] = []
    let chars = 0
    const flush = () => {
      if (!chunk.length) return
      const sectionTitle = group.section?.title ?? (sectionPath === '(root)' ? 'Корневой материал' : sectionPath)
      const input = chunk.map((item) => `[[fragment id=${item.id} path=${item.path} kind=${item.kind}]]\n${item.text}`).join('\n\n')
      const inputSha256 = hash(input)
      blocks.push({
        id: `block-${hash(`${sectionPath}\n${chunk.map((item) => item.id).join('\n')}\n${inputSha256}`).slice(0, 20)}`,
        sectionPath,
        sectionTitle,
        fragmentIds: chunk.map((item) => item.id),
        inputChars: input.length,
        inputSha256,
        status: 'pending',
        attempts: 0,
        analysisId: null,
        modelCallId: null,
        error: null,
      })
      chunk = []
      chars = 0
    }
    for (const item of group.items) {
      const itemChars = item.text.length + item.id.length + item.path.length + 48
      if (chunk.length && (chunk.length >= limits.maxItems || chars + itemChars > limits.maxChars)) flush()
      chunk.push(item)
      chars += itemChars
      if (itemChars > limits.maxChars) flush()
    }
    flush()
  }
  blocks.sort((a, b) => {
    const ao = ordered.find((item) => item.id === a.fragmentIds[0])?.order ?? 0
    const bo = ordered.find((item) => item.id === b.fragmentIds[0])?.order ?? 0
    return ao - bo
  })
  return { coverage, blocks, selectedFragmentCount: selected.length }
}

export function contourPositionId(analysisId: string, index: number, title: string) {
  return `contour-pos-${hash(`${analysisId}\n${index}\n${title}`).slice(0, 24)}`
}
