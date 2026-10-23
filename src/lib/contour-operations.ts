import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { buildContourPlan, type ContourBlock, type ContourCoverageEntry } from '@/lib/contour-planning'
import type { SemanticRepresentation } from '@/lib/semantic-codemap'

const TYPE = 'functional-semantic-contour'

export type ContourState = {
  schemaVersion: 1
  operationId: string
  status: 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'
  stage: 'interpretation' | 'relations' | 'indexing' | 'scenarios' | 'complete'
  createdAt: string
  updatedAt: string
  coverage: ContourCoverageEntry[]
  blocks: ContourBlock[]
  proposals: { positions: Record<string, unknown>[]; relations: Record<string, unknown>[] }
  materialized: { positions: string[]; relations: string[] }
  relationsState?: { status: 'pending' | 'running' | 'completed' | 'error'; attempts: number; modelCallId: string | null; error: string | null }
  indexState?: { status: 'pending' | 'running' | 'completed' | 'error'; entries: { representation: SemanticRepresentation; entityId: string; status: string; attempts: number; error?: string; model?: string | null; dimensions?: number | null; completedAt?: string | null }[]; next: number; error: string | null }
  importedIndexRebuildRequired?: boolean
  pilotSourceFragmentIds?: string[]
  decisionFlows?: ReturnType<typeof import('./contour-planning').buildDecisionFlow>[]
  validation?: { items: { positionId: string; scenarioId: string | null; executorRunId: string | null; evaluatorRunId: string | null; status: 'pending' | 'executor-running' | 'executor-done' | 'evaluator-done' | 'error'; error: string | null; attempts: number }[]; next: number; status: 'pending' | 'running' | 'completed' | 'error' }
  diagnostics: Record<string, unknown>
}

export async function getContourState(projectId: string, versionId: string) {
  const analysis = await db.analysis.findFirst({ where: { projectId, versionId, type: TYPE }, orderBy: { createdAt: 'desc' } })
  if (!analysis) return null
  try { return { analysis, state: JSON.parse(analysis.result) as ContourState } }
  catch { return { analysis, state: null } }
}

export async function createContourOperation(projectId: string, versionId: string) {
  const [version, existing] = await Promise.all([
    db.documentVersion.findFirst({ where: { id: versionId, projectId }, include: { fragments: { orderBy: { order: 'asc' } } } }),
    getContourState(projectId, versionId),
  ])
  if (!version) throw new Error('Версия не принадлежит выбранному проекту')
  if (existing?.state && ['running', 'paused'].includes(existing.state.status)) throw new Error('Для этой версии уже есть незавершённая операция. Возобновите её или отмените.')
  const plan = buildContourPlan(version.fragments.map((fragment) => ({
    id: fragment.id, versionId: fragment.versionId, kind: fragment.kind, path: fragment.path,
    order: fragment.order, title: fragment.title, text: fragment.text,
  })))
  const now = new Date().toISOString()
  const state: ContourState = {
    schemaVersion: 1, operationId: randomUUID(), status: 'running', stage: 'interpretation', createdAt: now, updatedAt: now,
    coverage: plan.coverage, blocks: plan.blocks, proposals: { positions: [], relations: [] }, materialized: { positions: [], relations: [] }, relationsState: { status: 'pending', attempts: 0, modelCallId: null, error: null }, indexState: { status: 'pending', entries: [], next: 0, error: null },
    validation: { items: [], next: 0, status: 'pending' },
    diagnostics: { totalFragments: version.fragments.length, selectedSourceFragments: plan.selectedFragmentCount, totalBlocks: plan.blocks.length, duplicateRepresentations: plan.coverage.filter((item) => item.status === 'duplicate-representation').length },
  }
  const analysis = await db.analysis.create({ data: {
    projectId, versionId, type: TYPE, backend: 'freellmapi', model: 'auto', status: 'running',
    summary: `Пакетный функционально-смысловой контур: 0/${plan.blocks.length} блоков`, result: JSON.stringify(state),
    fragmentCount: version.fragments.length,
  } })
  return { analysis, state }
}

export async function materializeContourProposals(analysisId: string, state: ContourState) {
  for (const [index, proposal] of state.proposals.positions.entries()) {
    const key = `${String(proposal.sourceBlockId)}:${String(proposal.modelCallId)}:${index}`
    if (state.materialized.positions.includes(key)) continue
    const fragmentIds = Array.isArray(proposal.fragmentIds) ? proposal.fragmentIds.filter((id): id is string => typeof id === 'string') : []
    const title = typeof proposal.title === 'string' ? proposal.title : ''
    const analysis = await db.analysis.findUniqueOrThrow({ where: { id: analysisId }, select: { projectId: true, versionId: true } })
    const fragments = fragmentIds.length ? await db.fragment.findMany({ where: { id: { in: fragmentIds }, versionId: analysis.versionId } }) : []
    if (!title || fragments.length !== new Set(fragmentIds).size || !fragments.length) { state.materialized.positions.push(key); continue }
    const positionId = `contour-pos-${randomId(key)}`
    const existing = await db.semanticPosition.findUnique({ where: { id: positionId } })
    if (!existing) {
      await db.semanticPosition.create({ data: {
        id: positionId, projectId: analysis.projectId, versionId: analysis.versionId,
        title, purpose: String(proposal.purpose ?? ''), regulatedDecision: String(proposal.regulatedDecision ?? ''),
        conditions: String(proposal.conditions ?? ''), expectedBehavior: String(proposal.expectedBehavior ?? ''), limitations: String(proposal.limitations ?? ''),
        provenance: 'model-interpret', provenanceRef: analysisId, status: 'proposed',
        sourceFragmentRefs: JSON.stringify({ modelCallId: proposal.modelCallId ?? null, actualProvider: proposal.actualProvider ?? null, actualModel: proposal.actualModel ?? null, requestedBackend: proposal.requestedBackend ?? null, requestedModel: proposal.requestedModel ?? null }),
        fragments: { create: fragments.map((fragment) => ({ fragmentId: fragment.id })) },
      } })
    }
    for (const block of state.blocks) if (block.id === proposal.sourceBlockId) {
      for (const fragmentId of fragmentIds) { const coverage = state.coverage.find((entry) => entry.fragmentId === fragmentId); if (coverage) coverage.positionIds = [...new Set([...coverage.positionIds, positionId])] }
    }
    state.materialized.positions.push(key)
  }
  const analysis = await db.analysis.findUniqueOrThrow({ where: { id: analysisId }, select: { versionId: true } })
  const rows = await db.semanticPosition.findMany({ where: { versionId: analysis.versionId } })
  for (const [index, proposal] of state.proposals.relations.entries()) {
    const key = `${String(proposal.sourceBlockId)}:${String(proposal.modelCallId)}:${index}`
    if (state.materialized.relations.includes(key)) continue
    const sources = rows.filter((position) => position.title === proposal.sourceTitle)
    const targets = rows.filter((position) => position.title === proposal.targetTitle)
    if (sources.length !== 1 || targets.length !== 1 || sources[0].id === targets[0].id) { state.diagnostics.unresolvedRelations = [...(Array.isArray(state.diagnostics.unresolvedRelations) ? state.diagnostics.unresolvedRelations as unknown[] : []), { ...proposal, reason: 'title-not-unique-or-missing' }]; state.materialized.relations.push(key); continue }
    const source = sources[0], target = targets[0]
    const relationId = `contour-rel-${randomId(key)}`
    if (!await db.semanticRelation.findUnique({ where: { id: relationId } })) await db.semanticRelation.create({ data: {
      id: relationId, projectId: source.projectId, versionId: source.versionId, sourcePositionId: source.id, targetPositionId: target.id,
      kind: String(proposal.kind), rationale: `${String(proposal.rationale)} [ModelCall ${String(proposal.modelCallId ?? 'неизвестен')}]`,
      provenance: 'model-proposal', status: 'proposed',
    } })
    state.materialized.relations.push(key)
  }
  const createdCalls = await db.modelCall.findMany({ where: { projectId: (await db.analysis.findUniqueOrThrow({ where: { id: analysisId }, select: { projectId: true } })).projectId, action: { in: ['functional-semantic-contour-block', 'functional-semantic-contour-relations'] } }, select: { id: true, actualProvider: true, actualModel: true, requestedModel: true, backend: true, relatedEntities: true } })
  const byId = new Map(createdCalls.map((call) => [call.id, call]))
  for (const position of await db.semanticPosition.findMany({ where: { provenanceRef: analysisId } })) {
    try {
      const refs = JSON.parse(position.sourceFragmentRefs) as Record<string, unknown>
      const call = typeof refs.modelCallId === 'string' ? byId.get(refs.modelCallId) : null
      if (!call) continue
      await db.semanticPosition.update({ where: { id: position.id }, data: { sourceFragmentRefs: JSON.stringify({ ...refs, actualProvider: call.actualProvider, actualModel: call.actualModel, requestedBackend: call.backend, requestedModel: call.requestedModel }) } })
    } catch { /* Keep historical source refs if malformed. */ }
  }
}

function randomId(value: string) {
  return value.split('').reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(16).padStart(8, '0').repeat(3).slice(0, 24)
}

export async function saveContourState(analysisId: string, state: ContourState, summary?: string) {
  state.updatedAt = new Date().toISOString()
  return db.analysis.update({ where: { id: analysisId }, data: {
    status: state.status === 'running' || state.status === 'paused' ? 'running' : state.status === 'completed' ? 'completed' : 'failed',
    summary: summary ?? `Пакетный функционально-смысловой контур: ${state.blocks.filter((block) => block.status === 'completed').length}/${state.blocks.length} блоков · ${state.status}`,
    result: JSON.stringify(state), error: state.status === 'failed' ? String(state.diagnostics.lastError ?? '') : null,
  } })
}

export function abortContourOperation(analysisId: string) {
  const registry = globalThis as typeof globalThis & { __contourAbort?: Map<string, AbortController> }
  const controller = registry.__contourAbort?.get(analysisId)
  if (!controller) return false
  controller.abort()
  return true
}

export function contourOperationIsActive(analysisId: string) {
  const registry = globalThis as typeof globalThis & { __contourActive?: Set<string> }
  return registry.__contourActive?.has(analysisId) ?? false
}

export function markContourOperationActive(analysisId: string, active: boolean) {
  const registry = globalThis as typeof globalThis & { __contourActive?: Set<string> }
  registry.__contourActive ??= new Set()
  if (active) registry.__contourActive.add(analysisId)
  else registry.__contourActive.delete(analysisId)
}

export function registerContourController(analysisId: string, controller: AbortController) {
  const registry = globalThis as typeof globalThis & { __contourAbort?: Map<string, AbortController> }
  registry.__contourAbort ??= new Map()
  registry.__contourAbort.set(analysisId, controller)
}

export function unregisterContourController(analysisId: string) {
  const registry = globalThis as typeof globalThis & { __contourAbort?: Map<string, AbortController> }
  registry.__contourAbort?.delete(analysisId)
}
