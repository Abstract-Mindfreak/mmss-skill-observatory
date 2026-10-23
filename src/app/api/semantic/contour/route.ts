import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { callModel, extractFirstJsonObject } from '@/lib/runner'
import { buildRoleMessages } from '@/lib/role-messages'
import { resolveInstructionContext } from '@/lib/instruction-context'
import { assignmentForRole } from '@/lib/backend-routing'
import { abortContourOperation, contourOperationIsActive, createContourOperation, getContourState, markContourOperationActive, materializeContourProposals, registerContourController, saveContourState, unregisterContourController, type ContourState } from '@/lib/contour-operations'
import { buildDecisionFlow, parseContourProposals } from '@/lib/contour-planning'
import { indexOne, type SemanticRepresentation } from '@/lib/semantic-codemap'
import { createAndRunRun } from '@/lib/runner'
import { appendUserDecisionHistory } from '@/lib/user-decision-history'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId') ?? ''
  const versionId = url.searchParams.get('versionId') ?? ''
  if (!projectId || !versionId) return NextResponse.json({ error: 'Укажите projectId и versionId' }, { status: 400 })
  const found = await getContourState(projectId, versionId)
  if (!found) return NextResponse.json({ analysisId: null, state: null })
  const state = found.state as ContourState | null
  const positions = await db.semanticPosition.findMany({ where: { projectId, versionId, ...(state ? { provenanceRef: found.analysis.id } : {}) }, select: { id: true, title: true, fragments: { select: { fragmentId: true } } } })
  const observations = await db.positionObservation.findMany({ where: { projectId, versionId, position: { provenanceRef: found.analysis.id } }, select: { id: true } })
  const sourceIds = state?.pilotSourceFragmentIds ?? []
  const vectors = await db.embeddingVector.findMany({ where: { projectId, versionId } })
  const coverage = (representation: string, ids: string[]) => {
    const selected = vectors.filter((row) => row.representation === representation && ids.includes(row.positionId ?? row.fragmentId ?? row.observationId ?? ''))
    const ready = selected.filter((row) => row.status === 'ready').length
    const stale = selected.filter((row) => row.status === 'stale').length
    const failed = selected.filter((row) => row.status === 'failed').length
    return { total: ids.length, ready, stale, failed, missing: Math.max(0, ids.length - new Set(selected.map((row) => row.positionId ?? row.fragmentId ?? row.observationId)).size) }
  }
  const coverageCounts = (state?.coverage ?? []).reduce<Record<string, number>>((counts, item) => { counts[item.status] = (counts[item.status] ?? 0) + 1; return counts }, {})
  const semanticCoverage = {
    positionsWithSources: positions.filter((position) => position.fragments.length > 0).length,
    positionsMissingSources: positions.filter((position) => position.fragments.length === 0).length,
    proposed: await db.semanticPosition.count({ where: { projectId, versionId, provenanceRef: found.analysis.id, status: 'proposed' } }),
    accepted: await db.semanticPosition.count({ where: { projectId, versionId, provenanceRef: found.analysis.id, status: 'accepted' } }),
    disputed: await db.semanticPosition.count({ where: { projectId, versionId, provenanceRef: found.analysis.id, status: 'disputed' } }),
  }
  return NextResponse.json({ analysisId: found.analysis.id, state, fragmentCoverage: { total: state?.coverage.length ?? 0, byStatus: coverageCounts }, semanticCoverage, indexCoverage: {
    functional: coverage('functional', positions.map((row) => row.id)),
    sourcePilot: coverage('source', sourceIds),
    sourceAllVersion: { fragments: await db.fragment.count({ where: { versionId } }), vectors: vectors.filter((row) => row.representation === 'source').length, outsidePilot: vectors.filter((row) => row.representation === 'source' && !sourceIds.includes(row.fragmentId ?? '')).length },
    observation: coverage('observation', observations.map((row) => row.id)),
    totalStoredVectors: vectors.length,
  }, indexRebuildRequired: state?.importedIndexRebuildRequired === true })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const action = typeof body?.action === 'string' ? body.action : ''
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  const versionId = typeof body?.versionId === 'string' ? body.versionId : ''
  const analysisId = typeof body?.analysisId === 'string' ? body.analysisId : ''
  if (!projectId || !versionId || !['start', 'step', 'cancel', 'relations', 'index-init', 'index-step', 'validation-init', 'validation-step', 'decision-flow', 'decision-flow-update'].includes(action)) return NextResponse.json({ error: 'Укажите projectId, versionId и допустимое действие контура.' }, { status: 400 })
  if (action === 'start') {
    try { const created = await createContourOperation(projectId, versionId); return NextResponse.json({ analysisId: created.analysis.id, state: created.state }, { status: 201 }) }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 }) }
  }
  if (!analysisId) return NextResponse.json({ error: 'Укажите analysisId операции' }, { status: 400 })
  const found = await getContourState(projectId, versionId)
  if (!found || found.analysis.id !== analysisId || !found.state) return NextResponse.json({ error: 'Операция не найдена в этой версии' }, { status: 404 })
  const state = found.state as ContourState
  if (action === 'decision-flow-update') {
    const flowId = typeof body?.flowId === 'string' ? body.flowId : ''
    const flow = state.decisionFlows?.find((item) => item.id === flowId) as (Record<string, unknown> & { nodes?: Record<string, unknown>[]; transitions?: Record<string, unknown>[] }) | undefined
    const patch = body?.flowPatch && typeof body.flowPatch === 'object' ? body.flowPatch as Record<string, unknown> : null
    if (!flow || !patch) return NextResponse.json({ error: 'Codemap и правка не найдены в выбранной версии.' }, { status: 404 })
    if (Array.isArray(patch.nodes)) {
      const incomingNodes = patch.nodes.filter((node): node is Record<string, unknown> => Boolean(node && typeof node === 'object'))
      const priorNodes = flow.nodes ?? []
      const nodes = incomingNodes.map((node) => {
        const prior = priorNodes.find((entry) => entry.nodeId === node.nodeId)
        const next = { ...node }
        if (!prior && node.status !== 'proposed') return { ...node, __decisionBasisMissing: true }
        if (prior && node.status !== prior.status) {
          const decisionBasis = typeof node.decisionBasis === 'string' ? node.decisionBasis.trim() : ''
          if (!decisionBasis) return { ...node, __decisionBasisMissing: true }
          Object.assign(next, appendUserDecisionHistory(prior, String(prior.status ?? 'proposed'), String(node.status), decisionBasis))
        } else if (prior) {
          next.decisionHistory = prior.decisionHistory ?? []
        } else {
          next.decisionHistory = []
        }
        delete next.decisionBasis
        return next
      })
      if (nodes.some((node) => node.__decisionBasisMissing === true)) return NextResponse.json({ error: 'Для изменения статуса узла укажите основание решения.' }, { status: 400 })
      const positions = await db.semanticPosition.findMany({ where: { id: { in: nodes.flatMap((node) => Array.isArray(node.positionIds) ? node.positionIds.filter((id): id is string => typeof id === 'string') : typeof node.positionId === 'string' ? [node.positionId] : []) }, projectId, versionId }, include: { fragments: { select: { fragmentId: true } } } })
      if (nodes.some((node) => typeof node.nodeId !== 'string' || !['condition', 'action', 'expected-result', 'gap'].includes(String(node.kind)) || !['proposed', 'accepted', 'disputed'].includes(String(node.status)) || typeof node.basis !== 'string' || !String(node.basis).trim())) return NextResponse.json({ error: 'Узел должен иметь тип, основание и явный статус.' }, { status: 400 })
      if (positions.length !== new Set(nodes.flatMap((node) => Array.isArray(node.positionIds) ? node.positionIds.filter((id): id is string => typeof id === 'string') : typeof node.positionId === 'string' ? [node.positionId] : [])).size) return NextResponse.json({ error: 'Узлы могут ссылаться только на положения этой версии.' }, { status: 400 })
      for (const node of nodes) {
        const positionRefs = Array.isArray(node.positionIds) ? node.positionIds : [node.positionId]
        const allowedFragments = new Set(positions.filter((position) => positionRefs.includes(position.id)).flatMap((position) => position.fragments.map((link) => link.fragmentId)))
        const sourceFragmentIds = Array.isArray(node.sourceFragmentIds) ? node.sourceFragmentIds : []
        if (!sourceFragmentIds.length || sourceFragmentIds.some((id) => typeof id !== 'string' || !allowedFragments.has(id))) return NextResponse.json({ error: 'Каждый узел должен ссылаться на Fragment источника связанного положения.' }, { status: 400 })
      }
      flow.nodes = nodes
    }
    if (patch.appendTransition && typeof patch.appendTransition === 'object') {
      const transition = patch.appendTransition as Record<string, unknown>
      const nodes = flow.nodes ?? []
      const fromId = typeof transition.fromNodeId === 'string' ? transition.fromNodeId : ''
      const toId = typeof transition.toNodeId === 'string' ? transition.toNodeId : ''
      const conditionLabel = typeof transition.conditionLabel === 'string' ? transition.conditionLabel.trim() : ''
      const basis = typeof transition.basis === 'string' ? transition.basis.trim() : ''
      const positionIds = Array.isArray(transition.positionIds) ? [...new Set(transition.positionIds.filter((id): id is string => typeof id === 'string'))] : []
      const sourceFragmentIds = Array.isArray(transition.sourceFragmentIds) ? [...new Set(transition.sourceFragmentIds.filter((id): id is string => typeof id === 'string'))] : []
      const fromNode = nodes.find((node) => node.nodeId === fromId), toNode = nodes.find((node) => node.nodeId === toId)
      const positions = positionIds.length ? await db.semanticPosition.findMany({ where: { id: { in: positionIds }, projectId, versionId }, include: { fragments: { select: { fragmentId: true } } } }) : []
      const linkedPositionIds = new Set(nodes.flatMap((node) => Array.isArray(node.positionIds) ? node.positionIds.filter((id): id is string => typeof id === 'string') : typeof node.positionId === 'string' ? [node.positionId] : []))
      const allowedFragments = new Set(positions.flatMap((position) => position.fragments.map((link) => link.fragmentId)))
      if (!fromNode || !toNode || fromId === toId || !conditionLabel || !basis || !positionIds.length || positions.length !== positionIds.length || positionIds.some((id) => !linkedPositionIds.has(id)) || !sourceFragmentIds.length || sourceFragmentIds.some((id) => !allowedFragments.has(id))) return NextResponse.json({ error: 'Переход требует разные существующие узлы, подпись условия, основание, связанные положения и их исходные Fragment.' }, { status: 400 })
      const transitions = Array.isArray(flow.transitions) ? flow.transitions : []
      transitions.push({ id: `flow-transition-${randomUUID()}`, fromNodeId: fromId, toNodeId: toId, conditionLabel, basis, positionIds, sourceFragmentIds, provenance: 'user', status: 'proposed', limitations: typeof transition.limitations === 'string' ? transition.limitations.trim() : '' })
      flow.transitions = transitions
    }
    if (patch.transitionDecision && typeof patch.transitionDecision === 'object') {
      if (Array.isArray(patch.transitions)) return NextResponse.json({ error: 'Обновляйте статус перехода или список переходов одним действием.' }, { status: 400 })
      const decision = patch.transitionDecision as Record<string, unknown>
      const transitions = Array.isArray(flow.transitions) ? flow.transitions : []
      const transition = transitions.find((item) => item.id === decision.id)
      const basis = typeof decision.basis === 'string' ? decision.basis.trim() : ''
      if (!transition || !['accepted', 'disputed', 'proposed'].includes(String(decision.status))) return NextResponse.json({ error: 'Переход или статус не найдены.' }, { status: 400 })
      if (!basis) return NextResponse.json({ error: 'Для изменения статуса перехода укажите основание решения.' }, { status: 400 })
      Object.assign(transition, appendUserDecisionHistory(transition, String(transition.status), String(decision.status), basis))
      transition.provenance = 'user'
    }
    if (Array.isArray(patch.transitions)) {
      const transitions = patch.transitions.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      const nodes = flow.nodes ?? []
      const nodeIds = new Set(nodes.map((node) => String(node.nodeId ?? '')))
      const positionIds = [...new Set(transitions.flatMap((item) => Array.isArray(item.positionIds) ? item.positionIds.filter((id): id is string => typeof id === 'string') : []))]
      const positions = positionIds.length ? await db.semanticPosition.findMany({ where: { id: { in: positionIds }, projectId, versionId }, include: { fragments: { select: { fragmentId: true } } } }) : []
      const allowedFragments = new Set(positions.flatMap((position) => position.fragments.map((link) => link.fragmentId)))
      if (transitions.some((item) => typeof item.id !== 'string' || typeof item.fromNodeId !== 'string' || typeof item.toNodeId !== 'string' || item.fromNodeId === item.toNodeId || !nodeIds.has(String(item.fromNodeId)) || !nodeIds.has(String(item.toNodeId)) || typeof item.conditionLabel !== 'string' || !String(item.conditionLabel).trim() || typeof item.basis !== 'string' || !String(item.basis).trim() || !['proposed', 'accepted', 'disputed'].includes(String(item.status)) || !['instruction-interpretation', 'user'].includes(String(item.provenance))) || positions.length !== positionIds.length || transitions.some((item) => !Array.isArray(item.sourceFragmentIds) || item.sourceFragmentIds.length === 0 || item.sourceFragmentIds.some((id) => typeof id !== 'string' || !allowedFragments.has(String(id))))) return NextResponse.json({ error: 'Каждый переход должен иметь существующие узлы, условие, основание, source-linked положения и статус.' }, { status: 400 })
      const priorTransitions = Array.isArray(flow.transitions) ? flow.transitions : []
      const nextTransitions: Record<string, unknown>[] = []
      for (const transition of transitions) {
        const prior = priorTransitions.find((entry) => entry.id === transition.id)
        if (!prior && transition.status !== 'proposed') return NextResponse.json({ error: 'Новый переход должен начинаться со статуса proposed.' }, { status: 400 })
        if (prior && transition.status !== prior.status) {
          const basis = typeof transition.decisionBasis === 'string' ? transition.decisionBasis.trim() : ''
          if (!basis) return NextResponse.json({ error: 'Для изменения статуса перехода укажите основание решения.' }, { status: 400 })
          nextTransitions.push({ ...transition, decisionHistory: [...(Array.isArray(prior.decisionHistory) ? prior.decisionHistory : []), { previousStatus: prior.status, newStatus: transition.status, basis, decidedAt: new Date().toISOString(), actorType: 'user' }], provenance: 'user' })
        } else nextTransitions.push({ ...transition, decisionHistory: prior?.decisionHistory ?? [], provenance: prior?.provenance ?? transition.provenance })
      }
      for (const transition of nextTransitions) delete transition.decisionBasis
      flow.transitions = nextTransitions
    }
    const finalNodeIds = new Set((flow.nodes ?? []).map((node) => String(node.nodeId ?? '')))
    const finalTransitions = Array.isArray(flow.transitions) ? flow.transitions : []
    if (finalTransitions.some((transition) => !finalNodeIds.has(String(transition.fromNodeId)) || !finalNodeIds.has(String(transition.toNodeId)))) return NextResponse.json({ error: 'Нельзя удалить узел, на который ссылается сохранённый переход. Сначала удалите или переназначьте переход.' }, { status: 400 })
    const stateFlows = state.decisionFlows ?? []
    state.decisionFlows = stateFlows.map((item) => item.id === flowId ? flow as unknown as typeof item : item)
    await saveContourState(analysisId, state)
    return NextResponse.json({ analysisId, state, flow })
  }
  if (action === 'decision-flow') {
    const caseLabel = typeof body?.caseLabel === 'string' ? body.caseLabel.trim().slice(0, 500) : ''
    const ids = Array.isArray(body?.positionIds) ? [...new Set(body.positionIds.filter((id): id is string => typeof id === 'string'))].slice(0, 8) : []
    if (!caseLabel || !ids.length) return NextResponse.json({ error: 'Укажите ситуацию и выберите 1–8 положений.' }, { status: 400 })
    const positions = await db.semanticPosition.findMany({ where: { id: { in: ids }, projectId, versionId, provenanceRef: analysisId, status: 'proposed' }, include: { fragments: { include: { fragment: { select: { id: true } } } } } })
    if (positions.length !== ids.length || positions.some((position) => position.fragments.length === 0)) return NextResponse.json({ error: 'Выберите положения этой операции с исходными Fragment.' }, { status: 400 })
    const flow = buildDecisionFlow(caseLabel, ids.map((id) => { const position = positions.find((item) => item.id === id)!; return { ...position, fragmentIds: position.fragments.map((link) => link.fragment.id) } }))
    state.decisionFlows = state.decisionFlows ?? []
    if (!state.decisionFlows.some((item) => item.id === flow.id)) state.decisionFlows.push(flow)
    await saveContourState(analysisId, state)
    return NextResponse.json({ analysisId, state, flow })
  }
  if (action === 'cancel') {
    abortContourOperation(analysisId)
    const active = state.blocks.find((block) => block.status === 'running')
    if (active) active.status = 'interrupted'
    state.status = 'cancelled'
    await saveContourState(analysisId, state)
    return NextResponse.json({ analysisId, state })
  }
  if (action === 'index-init') {
    const sourceFragmentIds = Array.isArray(body?.sourceFragmentIds) ? [...new Set(body.sourceFragmentIds.filter((id): id is string => typeof id === 'string'))] : []
    const validFragments = sourceFragmentIds.length ? await db.fragment.findMany({ where: { id: { in: sourceFragmentIds }, versionId }, select: { id: true } }) : []
    if (validFragments.length !== sourceFragmentIds.length) return NextResponse.json({ error: 'Корпус источников содержит Fragment не из этой версии.' }, { status: 400 })
    const positions = await db.semanticPosition.findMany({ where: { projectId, versionId }, select: { id: true, provenanceRef: true, status: true } })
    const observations = await db.positionObservation.findMany({ where: { projectId, versionId }, select: { id: true, position: { select: { provenanceRef: true, status: true } } } })
    const pilotPositionIds = positions.filter((position) => position.provenanceRef === analysisId).map((position) => position.id)
    const pilotObservationIds = observations.filter((item) => item.position.provenanceRef === analysisId).map((item) => item.id)
    const entries: { representation: SemanticRepresentation; entityId: string; status: string; attempts: number }[] = [
      ...pilotPositionIds.map((entityId) => ({ representation: 'functional' as const, entityId, status: 'pending', attempts: 0 })),
      ...sourceFragmentIds.map((entityId) => ({ representation: 'source' as const, entityId, status: 'pending', attempts: 0 })),
      ...pilotObservationIds.map((entityId) => ({ representation: 'observation' as const, entityId, status: 'pending', attempts: 0 })),
    ]
    state.pilotSourceFragmentIds = sourceFragmentIds
    state.indexState = { status: entries.length ? 'running' : 'completed', entries, next: 0, error: null }; state.stage = 'indexing'; state.status = 'paused'
    await saveContourState(analysisId, state, `Embedding coverage задана для ${entries.length} представлений (${sourceFragmentIds.length} исходных Fragment)`)
    return NextResponse.json({ analysisId, state })
  }
  if (action === 'index-step') {
    const indexState = state.indexState
    if (!indexState) return NextResponse.json({ error: 'Сначала создайте список индексации.' }, { status: 409 })
    if (indexState.next >= indexState.entries.length) { indexState.status = 'completed'; state.stage = 'scenarios'; state.status = 'paused'; await saveContourState(analysisId, state); return NextResponse.json({ analysisId, state }) }
    const entry = indexState.entries[indexState.next]
    if (entry.attempts >= 3) { indexState.status = 'error'; indexState.error = `Исчерпаны попытки: ${entry.representation}:${entry.entityId}`; await saveContourState(analysisId, state); return NextResponse.json({ analysisId, state, error: indexState.error }, { status: 409 }) }
    entry.attempts += 1
    try { const result = await indexOne(projectId, versionId, entry.representation, entry.entityId); const assignment = await db.assignment.findUnique({ where: { projectId_role: { projectId, role: 'embedding' } }, select: { model: true } }); entry.status = result.status; entry.model = assignment?.model ?? null; entry.dimensions = 'dimensions' in result ? result.dimensions : null; entry.completedAt = new Date().toISOString(); if (result.error) { entry.error = result.error; indexState.status = 'error'; indexState.error = result.error } else { indexState.next += 1; indexState.status = 'running'; indexState.error = null } }
    catch (error) { entry.status = 'failed'; entry.error = error instanceof Error ? error.message : String(error); indexState.status = 'error'; indexState.error = entry.error }
    await saveContourState(analysisId, state)
    if (entry.status === 'failed') return NextResponse.json({ analysisId, state, error: entry.error }, { status: 502 })
    if (indexState.next >= indexState.entries.length) { indexState.status = 'completed'; state.stage = 'scenarios'; state.status = 'paused' }
    await saveContourState(analysisId, state)
    return NextResponse.json({ analysisId, state })
  }
  if (action === 'validation-init') {
    const ids = Array.isArray(body?.positionIds) ? [...new Set(body.positionIds.filter((id): id is string => typeof id === 'string'))].slice(0, 6) : []
    if (!ids.length) return NextResponse.json({ error: 'Выберите 1–6 предложенных положений для Validation.' }, { status: 400 })
    const positions = await db.semanticPosition.findMany({ where: { id: { in: ids }, projectId, versionId, provenanceRef: analysisId, status: 'proposed' }, include: { fragments: { include: { fragment: { select: { id: true, path: true, text: true } } } } } })
    if (positions.length !== ids.length) return NextResponse.json({ error: 'Все положения должны быть proposed и созданы этим контуром.' }, { status: 400 })
    const scenarios = await db.scenario.findMany({ where: { projectId, title: { startsWith: '[VALIDATION]' } }, select: { id: true, title: true } })
    if (scenarios.length + ids.length > 6) return NextResponse.json({ error: 'В проекте уже достигнут лимит шести [VALIDATION] сценариев.' }, { status: 409 })
    for (const position of positions) {
      const scenario = await db.scenario.create({ data: { projectId, title: `[VALIDATION] ${position.title}`, description: `Проверяемая задача: ${position.purpose}\n\nКритерий: ${position.expectedBehavior}\n\nУсловия: ${position.conditions}\n\nРегулируемое решение: ${position.regulatedDecision}\n\nИсточники: ${position.fragments.map((link) => `${link.fragment.path} (${link.fragment.id})`).join(', ')}`, origin: 'user', status: 'unexplored', fragmentId: position.fragments[0]?.fragment.id ?? null } })
      state.validation?.items.push({ positionId: position.id, scenarioId: scenario.id, executorRunId: null, evaluatorRunId: null, status: 'pending', error: null, attempts: 0 })
    }
    if (state.validation) state.validation.status = 'running'; state.stage = 'scenarios'; state.status = 'paused'; await saveContourState(analysisId, state)
    return NextResponse.json({ analysisId, state })
  }
  if (action === 'validation-step') {
    const validation = state.validation
    if (!validation || !validation.items.length) return NextResponse.json({ error: 'Сначала выберите положения и создайте [VALIDATION] сценарии.' }, { status: 409 })
    const item = validation.items.find((entry) => entry.status !== 'evaluator-done')
    if (!item) { validation.status = 'completed'; state.stage = 'complete'; state.status = 'completed'; await saveContourState(analysisId, state); return NextResponse.json({ analysisId, state }) }
    if (item.attempts >= 3) { item.status = 'error'; item.error = 'Лимит трёх попыток исчерпан'; await saveContourState(analysisId, state); return NextResponse.json({ analysisId, state, error: item.error }, { status: 409 }) }
    const scenario = item.scenarioId ? await db.scenario.findFirst({ where: { id: item.scenarioId, projectId } }) : null
    const position = await db.semanticPosition.findUnique({ where: { id: item.positionId }, include: { fragments: { include: { fragment: { select: { id: true } } } } } })
    if (!scenario || !position) return NextResponse.json({ error: 'Сценарий или положение удалён/недоступен.' }, { status: 409 })
    const currentRole = item.executorRunId ? 'evaluator' : 'executor'
    if (currentRole === 'executor' && item.status === 'error') return NextResponse.json({ error: 'Предыдущий Executor завершился ошибкой. Сначала проверьте Runs и восстановите их состояние вручную.' }, { status: 409 })
    if (currentRole === 'executor' && item.status === 'pending') {
      const assignment = await assignmentForRole(projectId, 'executor')
      if (!assignment?.backend || !assignment.connectionId || !assignment.model) return NextResponse.json({ error: 'Назначьте Executor в «Подключениях».' }, { status: 400 })
      item.attempts += 1; item.status = 'executor-running'; state.status = 'running'; await saveContourState(analysisId, state)
      try {
        const run = await createAndRunRun({ projectId, role: 'executor', action: 'functional-semantic-validation-executor', backend: assignment.backend as 'ollama' | 'freellmapi', connectionId: assignment.connectionId, model: assignment.model, scenarioId: scenario.id, versionId, fragmentId: position.fragments[0]?.fragment.id ?? null, prompt: `${scenario.description ?? scenario.title}\n\nВыполни только задачу. Не оценивай и не создавай finding.`, settings: { temperature: 0, timeoutMs: 120000 }, taskContext: { versionId, fragmentId: position.fragments[0]?.fragment.id, instructionContext: { mode: 'none', versionId, fragmentIds: [], includeParentSections: false } } })
        item.executorRunId = run.id; item.status = run.status === 'completed' ? 'executor-done' : 'error'; item.error = run.error
        await saveContourState(analysisId, state)
        return NextResponse.json({ analysisId, state, run: { id: run.id, status: run.status, error: run.error } })
      } catch (error) { item.status = 'error'; item.error = error instanceof Error ? error.message : String(error); state.status = 'paused'; await saveContourState(analysisId, state); return NextResponse.json({ analysisId, state, error: item.error }, { status: 502 }) }
    }
    if (!item.executorRunId) return NextResponse.json({ error: 'Executor должен завершиться до evaluator.' }, { status: 409 })
    const executor = await db.run.findFirst({ where: { id: item.executorRunId, projectId, scenarioId: scenario.id, role: 'executor' } })
    if (!executor?.output || executor.status !== 'completed') return NextResponse.json({ error: 'Нет успешно завершённого Executor output.' }, { status: 409 })
    const assignment = await assignmentForRole(projectId, 'evaluator')
    if (!assignment?.backend || !assignment.connectionId || !assignment.model) return NextResponse.json({ error: 'Назначьте Evaluator в «Подключениях».' }, { status: 400 })
    item.attempts += 1; state.status = 'running'; await saveContourState(analysisId, state)
    try {
      const run = await createAndRunRun({ projectId, role: 'evaluator', action: 'functional-semantic-validation-evaluator', backend: assignment.backend as 'ollama' | 'freellmapi', connectionId: assignment.connectionId, model: assignment.model, scenarioId: scenario.id, versionId, parentRunId: executor.id, prompt: 'Оцени сохранённый ответ Executor строго по критерию. Не создавай Finding и не меняй SemanticPosition.', taskContext: { versionId, criterion: position.expectedBehavior, outputToEvaluate: executor.output, instructionContext: { mode: 'none', versionId, fragmentIds: [], includeParentSections: false } }, settings: { temperature: 0, timeoutMs: 120000 } })
      item.evaluatorRunId = run.id; item.status = run.status === 'completed' ? 'evaluator-done' : 'error'; item.error = run.error
      if (run.status === 'completed') await db.positionObservation.create({ data: { projectId, versionId, positionId: position.id, runId: run.id, observation: `Evaluator (${run.verdict ?? 'без распознанного вердикта'}): ${run.output ?? ''}`, evidenceText: run.output ?? '', conditions: position.conditions, criterion: position.expectedBehavior, status: 'unverified', limitations: 'Автоматическая пилотная фиксация; требует содержательной ручной проверки, не является подтверждением.' } })
      await saveContourState(analysisId, state)
      return NextResponse.json({ analysisId, state, run: { id: run.id, status: run.status, verdict: run.verdict, error: run.error } })
    } catch (error) { item.status = 'error'; item.error = error instanceof Error ? error.message : String(error); state.status = 'paused'; await saveContourState(analysisId, state); return NextResponse.json({ analysisId, state, error: item.error }, { status: 502 }) }
  }
  if (state.status === 'cancelled' || state.status === 'completed') return NextResponse.json({ analysisId, state })
  if (action === 'relations') {
    if (state.blocks.some((block) => block.status !== 'completed')) return NextResponse.json({ error: 'Сначала завершите интерпретацию всех блоков.' }, { status: 409 })
    if (contourOperationIsActive(analysisId)) return NextResponse.json({ error: 'Уже выполняется шаг операции' }, { status: 409 })
    const assignment = await assignmentForRole(projectId, 'interpreter')
    if (!assignment || !assignment.connectionId || !assignment.model || !['ollama', 'freellmapi'].includes(assignment.backend ?? '')) return NextResponse.json({ error: 'Для Interpreter назначьте FreeLLMAPI или Ollama в «Подключениях».' }, { status: 400 })
    const connection = await db.connection.findFirst({ where: { id: assignment.connectionId!, kind: assignment.backend! } })
    if (!connection) return NextResponse.json({ error: 'Назначенное подключение недоступно.' }, { status: 400 })
    const positions = await db.semanticPosition.findMany({ where: { versionId }, include: { fragments: { include: { fragment: { select: { id: true, path: true } } } } } })
    const current = state.relationsState ?? { status: 'pending' as const, attempts: 0, modelCallId: null, error: null }
    if (current.status === 'completed') return NextResponse.json({ analysisId, state })
    if (current.attempts >= 3) return NextResponse.json({ error: 'Для построения связей исчерпаны 3 попытки.' }, { status: 409 })
    const controller = new AbortController(); markContourOperationActive(analysisId, true); registerContourController(analysisId, controller)
    current.status = 'running'; current.attempts += 1; state.relationsState = current; state.stage = 'relations'; state.status = 'running'; await saveContourState(analysisId, state)
    try {
      const instruction = await resolveInstructionContext({ projectId, selection: { mode: 'none', versionId, fragmentIds: [], includeParentSections: false }, fallbackVersionId: versionId })
      const material = positions.map((item) => JSON.stringify({ id: item.id, title: item.title, purpose: item.purpose, regulatedDecision: item.regulatedDecision, conditions: item.conditions, expectedBehavior: item.expectedBehavior, limitations: item.limitations, fragmentIds: item.fragments.map((link) => link.fragment.id) })).join('\n')
      const messages = buildRoleMessages('interpreter', { fragmentText: `Предложи только явно обоснованные направленные связи между указанными положениями. Верни JSON {"relations":[{"sourcePositionId":"...","targetPositionId":"...","kind":"clarifies|limits|requires|excludes|supports|potential-conflict","rationale":"..."}]}. Правило чтения: source → relation → target. Не переориентируй связь ради разнообразия. Если направление неясно — не предлагай связь. Не меняй статусы.\n\nПОЛОЖЕНИЯ:\n${material}` }, instruction)
      const result = await callModel({ backend: assignment.backend as 'ollama' | 'freellmapi', connectionId: assignment.connectionId, model: assignment.model, messages, temperature: 0.2, timeoutMs: 120000, signal: controller.signal, provenance: { projectId, role: 'interpreter', action: 'functional-semantic-contour-relations', versionId, context: instruction, relatedEntities: [`analysis:${analysisId}`, ...positions.map((position) => `semantic-position:${position.id}`)] } })
      const parsed = extractFirstJsonObject(result.content) as { relations?: unknown[] } | null
      if (!parsed || !Array.isArray(parsed.relations)) throw new Error('Ответ не содержит JSON relations')
      const kinds = new Set(['clarifies', 'limits', 'requires', 'excludes', 'supports', 'potential-conflict'])
      const proposals = parsed.relations.flatMap((raw) => {
        if (!raw || typeof raw !== 'object') return []
        const row = raw as Record<string, unknown>
        if (typeof row.sourcePositionId !== 'string' || typeof row.targetPositionId !== 'string' || typeof row.kind !== 'string' || typeof row.rationale !== 'string' || !kinds.has(row.kind)) return []
        const source = positions.find((position) => position.id === row.sourcePositionId), target = positions.find((position) => position.id === row.targetPositionId)
        if (!source || !target || source.id === target.id || source.versionId !== target.versionId) return []
        return [{ sourcePositionId: source.id, targetPositionId: target.id, kind: row.kind, rationale: row.rationale, modelCallId: result.modelCallId ?? null, actualProvider: result.actualProvider ?? null, actualModel: result.actualModel ?? null }]
      })
      for (const [index, proposal] of proposals.entries()) {
        const id = `contour-rel-${randomKey(`${analysisId}:${result.modelCallId}:${index}`)}`
        if (!await db.semanticRelation.findUnique({ where: { id } })) await db.semanticRelation.create({ data: { id, projectId, versionId, ...proposal, provenance: 'model-proposal', status: 'proposed', rationale: `${proposal.rationale} [ModelCall ${proposal.modelCallId ?? 'неизвестен'}; actual ${proposal.actualProvider ?? 'unknown'}/${proposal.actualModel ?? 'unknown'}]` } })
      }
      current.status = 'completed'; current.modelCallId = result.modelCallId ?? null; current.error = null
      state.proposals.relations = proposals
      state.status = 'paused'; state.stage = 'indexing'; await saveContourState(analysisId, state)
      return NextResponse.json({ analysisId, state })
    } catch (error) {
      current.status = 'error'
      current.error = error instanceof Error ? error.message : String(error)
      state.relationsState = current
      state.status = controller.signal.aborted ? 'cancelled' : 'paused'
      await saveContourState(analysisId, state)
      return NextResponse.json({ analysisId, state, error: current.error }, { status: 502 })
    }
    finally { unregisterContourController(analysisId); markContourOperationActive(analysisId, false) }
  }
  await materializeContourProposals(analysisId, state)
  await saveContourState(analysisId, state)
  if (contourOperationIsActive(analysisId)) return NextResponse.json({ error: 'Уже выполняется шаг операции' }, { status: 409 })
  const version = await db.documentVersion.findFirst({ where: { id: versionId, projectId }, include: { fragments: { orderBy: { order: 'asc' } } } })
  if (!version) return NextResponse.json({ error: 'Версия недоступна' }, { status: 404 })
  const assignment = await assignmentForRole(projectId, 'interpreter')
  if (!assignment || !assignment.connectionId || !assignment.model || !['ollama', 'freellmapi'].includes(assignment.backend ?? '')) return NextResponse.json({ error: 'Для Interpreter назначьте FreeLLMAPI или Ollama в разделе «Подключения».' }, { status: 400 })
  const connection = await db.connection.findFirst({ where: { id: assignment.connectionId!, kind: assignment.backend! } })
  if (!connection) return NextResponse.json({ error: 'Назначенное подключение недоступно. Выберите его заново в «Подключениях».' }, { status: 400 })
  const block = state.blocks.find((item) => item.status === 'pending' || item.status === 'interrupted' || item.status === 'error')
  if (!block) { state.status = 'completed'; state.stage = 'relations'; await saveContourState(analysisId, state); return NextResponse.json({ analysisId, state }) }
  if (block.attempts >= 3) return NextResponse.json({ error: 'Для этого блока исчерпаны 3 попытки.' }, { status: 409 })
  const fragmentIds = new Set(block.fragmentIds)
  const rows = version.fragments.filter((fragment) => fragmentIds.has(fragment.id))
  if (rows.length !== block.fragmentIds.length) return NextResponse.json({ error: 'Состав сохранённого блока не совпадает с версией; обработка остановлена.' }, { status: 409 })
  const controller = new AbortController()
  markContourOperationActive(analysisId, true)
  registerContourController(analysisId, controller)
  block.status = 'running'; block.attempts += 1; state.status = 'running'; await saveContourState(analysisId, state)
  try {
    const instruction = await resolveInstructionContext({ projectId, selection: { mode: 'none', versionId, fragmentIds: [], includeParentSections: false }, fallbackVersionId: versionId })
    const material = rows.map((fragment) => `[[обязательный исходный Fragment id=${fragment.id} path=${fragment.path} kind=${fragment.kind}]]\n${fragment.text}`).join('\n\n')
    const task = [
      `Это блок ${block.sectionPath} (${block.sectionTitle}) инструкции. Рассматривай фрагменты совместно только там, где их текст обосновывает общую функцию.`,
      'Верни JSON: {"positions":[{"title":"...","purpose":"...","regulatedDecision":"...","conditions":"...","expectedBehavior":"...","limitations":"...","fragmentIds":["точные ID из материала"]}],"relations":[{"sourceTitle":"...","targetTitle":"...","kind":"clarifies|limits|requires|excludes|supports|potential-conflict","rationale":"..."}]}.',
      'Не выдумывай положения. Ссылайся только на переданные ID. Направление связи: source — отношение — target. Если подходящих положений/связей нет, верни пустые массивы. Все значения по-русски.',
      '\n=== ИСХОДНЫЕ ФРАГМЕНТЫ ===\n' + material,
    ].join('\n\n')
    const messages = buildRoleMessages('interpreter', { fragmentText: task }, instruction)
    const result = await callModel({ backend: assignment.backend as 'ollama' | 'freellmapi', connectionId: assignment.connectionId, model: assignment.model, messages, temperature: 0.2, timeoutMs: 120000, signal: controller.signal, provenance: {
      projectId, role: 'interpreter', action: 'functional-semantic-contour-block', versionId, context: instruction,
      relatedEntities: [`analysis:${analysisId}`, ...block.fragmentIds.map((id) => `fragment:${id}`)],
    } })
    block.modelCallId = result.modelCallId ?? null
    const parsed = extractFirstJsonObject(result.content)
    if (!parsed) { block.rawResponse = result.content; throw new Error('Ответ блока не содержит корректный JSON; исходный ответ сохранён в состоянии блока для проверки и повтора.') }
    const proposals = parseContourProposals(parsed, fragmentIds)
    if (!proposals.positions.length && !proposals.relations.length) {
      for (const id of block.fragmentIds) { const row = state.coverage.find((entry) => entry.fragmentId === id); if (row) { row.status = 'gap'; row.classification = 'no-proposal'; row.reason = 'Модель не предложила положение для данного материала.' } }
    }
    state.proposals.positions.push(...proposals.positions.map((proposal) => ({ ...proposal, sourceBlockId: block.id, modelCallId: result.modelCallId ?? null, actualProvider: result.actualProvider ?? null, actualModel: result.actualModel ?? null, requestedBackend: assignment.backend, requestedModel: assignment.model })))
    state.proposals.relations.push(...proposals.relations.map((proposal) => ({ ...proposal, sourceBlockId: block.id, modelCallId: result.modelCallId ?? null, actualProvider: result.actualProvider ?? null, actualModel: result.actualModel ?? null, requestedBackend: assignment.backend, requestedModel: assignment.model })))
    await materializeContourProposals(analysisId, state)
    for (const proposal of proposals.positions) for (const id of proposal.fragmentIds) { const row = state.coverage.find((entry) => entry.fragmentId === id); if (row) { row.status = 'processed'; row.classification = 'position-proposed' } }
    for (const id of block.fragmentIds) { const row = state.coverage.find((entry) => entry.fragmentId === id); if (row?.status === 'pending') { row.status = 'gap'; row.classification = 'no-proposal'; row.reason = 'Блок обработан, но ответ модели не связал этот исходный Fragment с положением.' } }
    block.status = 'completed'; block.error = null
    const completed = state.blocks.filter((item) => item.status === 'completed').length
    state.status = completed === state.blocks.length ? 'paused' : 'running'
    if (completed === state.blocks.length) state.stage = 'relations'
    await saveContourState(analysisId, state, `Функционально-смысловой контур: ${completed}/${state.blocks.length} блоков; фактический маршрут последнего ответа ${result.actualProvider ?? 'неизвестен'} / ${result.actualModel ?? 'неизвестен'}`)
    return NextResponse.json({ analysisId, state, lastCall: { id: result.modelCallId, actualProvider: result.actualProvider, actualModel: result.actualModel } })
  } catch (error) {
    block.status = controller.signal.aborted ? 'interrupted' : 'error'; block.error = error instanceof Error ? error.message : String(error)
    state.status = controller.signal.aborted ? 'cancelled' : 'paused'; state.diagnostics.lastError = block.error
    await saveContourState(analysisId, state)
    return NextResponse.json({ analysisId, state, error: block.error }, { status: 502 })
  } finally { unregisterContourController(analysisId); markContourOperationActive(analysisId, false) }
}

function randomKey(value: string) { return value.split('').reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(16).padStart(8, '0').repeat(3).slice(0, 24) }
