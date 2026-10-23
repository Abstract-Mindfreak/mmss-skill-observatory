'use client'

import * as React from 'react'
import { ArrowRight, Check, Pencil, Plus, Search, Sparkles, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ObjectTypeBadge, StatusBadge } from '@/components/shared/semantic-badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api-client'
import type { FragmentDTO, NoteDTO, ResearchDiscrepancyDTO, ResearchStateDTO, RunDTO } from '@/lib/types'
import { hasDiagnosticMarker } from '@/lib/semantic-filters'
import { useStore } from '@/lib/store'
import { ResearchCampaignPanel } from './research-campaign-panel'

type Relation = { id: string; kind: string; rationale: string; provenance: string; status: string; targetPosition?: { id: string; title: string; status: string }; sourcePosition?: { id: string; title: string; status: string } }
type Observation = { id: string; observation: string; evidenceText: string; conditions: string; criterion: string; limitations: string; status: string; runId: string | null; noteId: string | null; run?: { id: string; role: string; origin: string; status: string; input: string; output: string | null } | null; note?: { id: string; body: string; origin: string; kind: string } | null }
type Position = { id: string; versionId: string; title: string; purpose: string; regulatedDecision: string; conditions: string; expectedBehavior: string; limitations: string; provenance: string; provenanceRef: string | null; sourceFragmentRefs?: string; status: string; fragments: { fragment: Pick<FragmentDTO, 'id' | 'path' | 'text' | 'title'> }[]; outgoingRelations: Relation[]; incomingRelations: Relation[]; observations: Observation[] }
type Interpretation = { proposalKey: string; analysisId: string; fragmentId: string; interpretation: string; alternatives: string[]; scopeNote: string; limitations: string; actualProvider: string | null; actualModel: string | null; requestedModel: string | null }
type SearchHit = { representation: string; similarity: number; position: Position | null; fragment: { id: string; path: string; text: string; semanticLinks: { semanticPosition: { id: string; title: string; status: string } }[] } | null; observation: Observation & { position: { id: string; title: string; status: string } } | null; model: string; dimensions: number }
type MapTab = 'search' | 'positions' | 'flows' | 'research' | 'processing' | 'campaign'
type DecisionHistoryEntry = { previousStatus: string; newStatus: string; basis: string; decidedAt: string; actorType: 'user' }
type DecisionFlowNode = { nodeId?: string; kind?: 'condition' | 'action' | 'expected-result' | 'gap'; provenance?: 'instruction-interpretation' | 'user'; status?: 'proposed' | 'accepted' | 'disputed'; basis?: string; positionIds?: string[]; decisionHistory?: DecisionHistoryEntry[]; order: number; positionId: string; title: string; condition: string; applicableRule: string; check: string; expectedAction: string; exceptionOrLimit: string; allowedResult: string | null; uncertainty: string; sourceFragmentIds: string[] }
type DecisionFlowTransition = { id: string; fromNodeId: string; toNodeId: string; conditionLabel: string; basis: string; positionIds: string[]; sourceFragmentIds: string[]; provenance: 'instruction-interpretation' | 'user'; status: 'proposed' | 'accepted' | 'disputed'; limitations: string; decisionHistory?: DecisionHistoryEntry[] }
type DecisionFlow = { id: string; status: 'proposed' | 'accepted' | 'disputed'; caseLabel: string; executed: false; limitation: string; nodes: DecisionFlowNode[]; transitions?: DecisionFlowTransition[] }
type ContourState = { status: string; stage: string; blocks: { status: string; attempts: number }[]; diagnostics: Record<string, unknown>; proposals: { positions: unknown[]; relations: unknown[] }; coverage: { fragmentId: string; path: string; kind: string; status: string; classification: string | null; reason: string | null; linkedFragmentId: string | null; positionIds: string[] }[]; decisionFlows?: DecisionFlow[]; indexState?: { status: string; next: number; entries: unknown[] }; validation?: { status: string; items: { status: string }[] } }

const blankDraft = { title: '', purpose: '', regulatedDecision: '', conditions: '', expectedBehavior: '', limitations: '', fragmentIds: [] as string[], analysisId: '' }
const modes = [
  ['functional', 'Функции и решения'],
  ['source', 'Исходный текст'],
  ['observation', 'Наблюдения'],
] as const
const relationKinds = [
  ['clarifies', 'уточняет'], ['limits', 'ограничивает'], ['requires', 'требует'],
  ['excludes', 'исключает'], ['supports', 'поддерживает'], ['potential-conflict', 'потенциально конфликтует'],
] as const

export function SemanticCodemap({ projectId, versionId, fragments, runs, notes, initialFragmentId }: {
  projectId: string; versionId: string; fragments: FragmentDTO[]; runs: RunDTO[]; notes: NoteDTO[]; initialFragmentId: string | null
}) {
  const projectName = useStore((state) => state.appState?.project?.name ?? 'Проект')
  const selectRun = useStore((state) => state.selectRun)
  const selectScenario = useStore((state) => state.selectScenario)
  const setStudio = useStore((state) => state.setStudio)
  const codemapTarget = useStore((state) => state.codemapTarget)
  const selectCodemapTarget = useStore((state) => state.selectCodemapTarget)
  const codemapReturnCampaignId = useStore((state) => state.codemapReturnCampaignId)
  const setCodemapReturnCampaign = useStore((state) => state.setCodemapReturnCampaign)
  const [positions, setPositions] = React.useState<Position[]>([])
  const [interpretations, setInterpretations] = React.useState<Interpretation[]>([])
  const [includeDiagnostics, setIncludeDiagnostics] = React.useState(false)
  const [draft, setDraft] = React.useState(blankDraft)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [fragmentChoice, setFragmentChoice] = React.useState(initialFragmentId ?? '')
  const [query, setQuery] = React.useState('')
  const [activeTab, setActiveTab] = React.useState<MapTab>('search')
  const [selectedHitIndex, setSelectedHitIndex] = React.useState<number | null>(null)
  const [searched, setSearched] = React.useState(false)
  const [searchError, setSearchError] = React.useState('')
  const [mode, setMode] = React.useState<'functional' | 'source' | 'observation'>('functional')
  const [topK, setTopK] = React.useState(8)
  const [threshold, setThreshold] = React.useState(0.2)
  const [layers, setLayers] = React.useState({ positions: true, sources: true, relations: true, observations: true })
  const [hits, setHits] = React.useState<SearchHit[]>([])
  const [searchNote, setSearchNote] = React.useState('')
  const [selectedForRelation, setSelectedForRelation] = React.useState('')
  const [relationTarget, setRelationTarget] = React.useState('')
  const [relationKind, setRelationKind] = React.useState('clarifies')
  const [relationRationale, setRelationRationale] = React.useState('')
  const [observationPosition, setObservationPosition] = React.useState('')
  const [observationSource, setObservationSource] = React.useState('')
  const [observationText, setObservationText] = React.useState('')
  const [evidenceText, setEvidenceText] = React.useState('')
  const [observationConditions, setObservationConditions] = React.useState('')
  const [criterion, setCriterion] = React.useState('')
  const [observationStatus, setObservationStatus] = React.useState('unverified')
  const [busy, setBusy] = React.useState(false)
  const [message, setMessage] = React.useState('')
  const [navigationNotice, setNavigationNotice] = React.useState('')
  const [contourId, setContourId] = React.useState<string | null>(null)
  const [contour, setContour] = React.useState<ContourState | null>(null)
  const [pilotFragmentIds, setPilotFragmentIds] = React.useState<string[]>([])
  const [pilotPositionIds, setPilotPositionIds] = React.useState<string[]>([])
  const [flowCaseLabel, setFlowCaseLabel] = React.useState('Исторические сообщения отсутствуют; нужно подготовить честный отчёт')
  const [researchState, setResearchState] = React.useState<ResearchStateDTO | null>(null)
  const [discrepancies, setDiscrepancies] = React.useState<ResearchDiscrepancyDTO[]>([])
  const [loadedCodemapKey, setLoadedCodemapKey] = React.useState('')
  const [discrepancyAssessment, setDiscrepancyAssessment] = React.useState<'different-criteria' | 'potential-contradiction' | 'insufficient-basis'>('potential-contradiction')
  const [discrepancyCriterion, setDiscrepancyCriterion] = React.useState('')
  const [discrepancySummary, setDiscrepancySummary] = React.useState('')
  const [decisionReason, setDecisionReason] = React.useState<Record<string, string>>({})
  const [flowDecisionBasis, setFlowDecisionBasis] = React.useState<Record<string, string>>({})
  const [transitionFrom, setTransitionFrom] = React.useState('')
  const [transitionTo, setTransitionTo] = React.useState('')
  const [transitionLabel, setTransitionLabel] = React.useState('')
  const [transitionBasis, setTransitionBasis] = React.useState('')
  const [transitionPositionId, setTransitionPositionId] = React.useState('')
  const [transitionFragmentId, setTransitionFragmentId] = React.useState('')
  const [discrepancyRunIds, setDiscrepancyRunIds] = React.useState<{ executor: string; evaluator: string }>({ executor: '', evaluator: '' })
  const [nodeDrafts, setNodeDrafts] = React.useState<Record<string, Partial<DecisionFlowNode>>>({})
  const [newNode, setNewNode] = React.useState({ kind: 'gap' as NonNullable<DecisionFlowNode['kind']>, positionId: '', fragmentId: '', title: '', condition: '', basis: '', expectedAction: '', limitation: '' })
  const [sourceQuery, setSourceQuery] = React.useState('')
  const [sourceSection, setSourceSection] = React.useState('all')
  const [coverageQuery, setCoverageQuery] = React.useState('')
  const [coverageSection, setCoverageSection] = React.useState('all')
  const [coverageStatus, setCoverageStatus] = React.useState('all')
  const [coveragePage, setCoveragePage] = React.useState(0)
  const querySessionKey = `s2-semantic-search:${projectId}:${versionId}`

  React.useEffect(() => {
    try {
      const pendingQuery = window.sessionStorage.getItem(querySessionKey)
      if (pendingQuery !== null) {
        queueMicrotask(() => setQuery(pendingQuery))
        window.sessionStorage.removeItem(querySessionKey)
      }
    } catch {
      // The search remains usable when session storage is unavailable.
    }
  }, [querySessionKey])

  const openRelated = (kind: 'scenario' | 'run', id: string) => {
    try {
      if (query.trim()) window.sessionStorage.setItem(querySessionKey, query)
      else window.sessionStorage.removeItem(querySessionKey)
    } catch {
      // Navigation still works if session storage is unavailable.
    }
    if (kind === 'scenario') selectScenario(id)
    else selectRun(id)
    setStudio(kind === 'scenario' ? 'scenario' : 'lab')
  }

  const coverageRows = contour?.coverage ?? []
  const coverageSections = [...new Set(coverageRows.map((row) => row.path.split('.')[0]).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const filteredCoverage = coverageRows.filter((row) => {
    const sectionMatches = coverageSection === 'all' || row.path === coverageSection || row.path.startsWith(`${coverageSection}.`)
    const statusMatches = coverageStatus === 'all' || row.status === coverageStatus
    const fragmentText = fragments.find((fragment) => fragment.id === row.fragmentId)?.text ?? ''
    const queryMatches = !coverageQuery.trim() || `${row.path} ${row.kind} ${row.classification ?? ''} ${row.reason ?? ''} ${fragmentText}`.toLocaleLowerCase().includes(coverageQuery.trim().toLocaleLowerCase())
    return sectionMatches && statusMatches && queryMatches
  })
  const coveragePageSize = 50
  const coveragePageCount = Math.max(1, Math.ceil(filteredCoverage.length / coveragePageSize))
  const visibleCoverage = filteredCoverage.slice(coveragePage * coveragePageSize, (coveragePage + 1) * coveragePageSize)

  const reload = React.useCallback(async () => {
    const [data, state, discrepancyData] = await Promise.all([
      api.semanticCodemap(projectId, versionId, includeDiagnostics), api.researchState(projectId, versionId), api.researchDiscrepancies(projectId, versionId),
    ])
    setPositions(data.positions as Position[]); setInterpretations(data.interpretations as Interpretation[])
    setResearchState(state); setDiscrepancies(discrepancyData.discrepancies)
  }, [projectId, versionId, includeDiagnostics])
  React.useEffect(() => {
    if (!codemapTarget || loadedCodemapKey !== `${projectId}:${versionId}:${includeDiagnostics}`) return
    const targetPositionState = researchState?.positions.find((position) => position.positionId === codemapTarget.positionId)
    if (codemapTarget.kind === 'observation' && !includeDiagnostics && targetPositionState?.observationIds.includes(codemapTarget.id)) {
      const frame = window.requestAnimationFrame(() => {
        setNavigationNotice('Для открытия выбранной записи включены записи [SMOKE]/[DIAGNOSTIC]; другие данные не изменены.')
        setIncludeDiagnostics(true)
      })
      return () => window.cancelAnimationFrame(frame)
    }
    const target = codemapTarget
    let scrollFrame = 0
    const frame = window.requestAnimationFrame(() => {
      setActiveTab(target.kind === 'discrepancy' ? 'research' : 'positions')
      scrollFrame = window.requestAnimationFrame(() => {
        const anchorId = target.kind === 'discrepancy' ? `research-discrepancy-${target.id}` : `research-observation-${target.id}`
        const anchor = document.getElementById(anchorId) ?? document.getElementById(`research-position-${target.positionId}`)
        anchor?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        selectCodemapTarget(null)
      })
    })
    return () => {
      window.cancelAnimationFrame(frame)
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame)
    }
  }, [codemapTarget, loadedCodemapKey, projectId, versionId, includeDiagnostics, selectCodemapTarget])
  React.useEffect(() => {
    let active = true
    void Promise.all([api.semanticCodemap(projectId, versionId, includeDiagnostics), api.researchState(projectId, versionId), api.researchDiscrepancies(projectId, versionId)]).then(([data, state, discrepancyData]) => {
      if (!active) return
      setPositions(data.positions as Position[])
      setInterpretations(data.interpretations as Interpretation[])
      setResearchState(state); setDiscrepancies(discrepancyData.discrepancies)
      setLoadedCodemapKey(`${projectId}:${versionId}:${includeDiagnostics}`)
    }).catch((error) => {
      if (active) setMessage(error instanceof Error ? error.message : String(error))
    })
    return () => { active = false }
  }, [projectId, versionId, includeDiagnostics])
  React.useEffect(() => {
    let active = true
    void api.semanticContour(projectId, versionId).then((data) => {
      if (!active) return
      setContourId(data.analysisId)
      setContour(data.state as ContourState | null)
    }).catch(() => undefined)
    return () => { active = false }
  }, [projectId, versionId])

  const defaultEvaluatorRun = runs.find((run) => run.role === 'evaluator' && run.versionId === versionId && run.origin !== 'demo')
  const defaultExecutorRun = defaultEvaluatorRun ? runs.find((run) => run.id === defaultEvaluatorRun.parentRunId) : undefined
  const selectedEvaluatorRun = runs.find((run) => run.id === discrepancyRunIds.evaluator) ?? defaultEvaluatorRun
  const selectedExecutorRun = runs.find((run) => run.id === discrepancyRunIds.executor) ?? defaultExecutorRun
  const effectiveDiscrepancyRunIds = { executor: selectedExecutorRun?.id ?? '', evaluator: selectedEvaluatorRun?.id ?? '' }
  const effectiveDiscrepancyCriterion = discrepancyCriterion || selectedEvaluatorRun?.input?.taskContext?.criterion || ''

  const contourAction = async (action: 'start' | 'step' | 'cancel' | 'relations' | 'index-init' | 'index-step' | 'validation-init' | 'validation-step' | 'decision-flow') => {
    setBusy(true); setMessage(action === 'start' ? 'Инициализация пакетного контура…' : action === 'cancel' ? 'Отмена операции…' : 'Обработка одного ограниченного блока…')
    try {
      const result = await api.runSemanticContour({ action, projectId, versionId, ...(contourId ? { analysisId: contourId } : {}), ...(action === 'index-init' ? { sourceFragmentIds: pilotFragmentIds } : {}), ...(['validation-init', 'decision-flow'].includes(action) ? { positionIds: pilotPositionIds } : {}), ...(action === 'decision-flow' ? { caseLabel: flowCaseLabel } : {}) })
      if (result.analysisId) setContourId(result.analysisId)
      if (result.state) setContour(result.state as ContourState)
      await reload()
      setMessage(action === 'step' ? 'Сохранён один шаг. Можно продолжить, возобновить после перезагрузки или отменить.' : action === 'cancel' ? 'Операция отменена; созданные предложения сохранены.' : 'Операция создана. Модельные вызовы начнутся только после «Обработать блок».')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }

  const addFragment = () => {
    if (!fragmentChoice) return
    setDraft((old) => old.fragmentIds.includes(fragmentChoice) ? old : { ...old, fragmentIds: [...old.fragmentIds, fragmentChoice] })
  }
  const loadInterpretation = (value: string) => {
    const item = interpretations.find((entry) => entry.proposalKey === value)
    if (!item) return
    setDraft((old) => ({
      ...old,
      title: old.title || fragments.find((fragment) => fragment.id === item.fragmentId)?.text.slice(0, 72) || 'Интерпретация фрагмента',
      purpose: item.interpretation,
      regulatedDecision: old.regulatedDecision || 'Уточнить вручную по исходному фрагменту',
      conditions: item.scopeNote,
      expectedBehavior: old.expectedBehavior || 'Заполните ожидаемое поведение по исходному тексту',
      limitations: [item.alternatives.length ? `Альтернативы: ${item.alternatives.join('; ')}` : '', item.limitations].filter(Boolean).join('\n'),
      fragmentIds: old.fragmentIds.includes(item.fragmentId) ? old.fragmentIds : [...old.fragmentIds, item.fragmentId],
      analysisId: item.analysisId,
    }))
    setMessage(`Предложение Interpreter загружено как черновик. ${item.actualProvider || item.actualModel ? `Фактический маршрут: ${item.actualProvider ?? 'неизвестный провайдер'} / ${item.actualModel ?? item.requestedModel ?? 'неизвестная модель'}.` : 'Фактическая модель для этой исторической записи неизвестна.'}`)
  }
  const savePosition = async () => {
    setBusy(true); setMessage('')
    try {
      const body = { ...draft, projectId, versionId, provenance: draft.analysisId ? 'model-interpret' : 'user', provenanceRef: draft.analysisId || null }
      if (editingId) await api.updateSemanticPosition(editingId, body)
      else await api.createSemanticPosition(body)
      setDraft(blankDraft); setEditingId(null); await reload(); setMessage('Смысловое положение сохранено как предложенное. Принятие осталось ручным.')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const editPosition = (position: Position) => {
    setEditingId(position.id)
    setDraft({ title: position.title, purpose: position.purpose, regulatedDecision: position.regulatedDecision, conditions: position.conditions, expectedBehavior: position.expectedBehavior, limitations: position.limitations, fragmentIds: position.fragments.map((link) => link.fragment.id), analysisId: position.provenanceRef ?? '' })
  }
  const updateStatus = async (position: Position, status: 'accepted' | 'disputed') => {
    const basis = window.prompt(`Основание решения для «${position.title}»`)
    if (!basis?.trim()) { setMessage('Статус не изменён: требуется основание решения.'); return }
    await api.updateSemanticPosition(position.id, { status, decisionBasis: basis.trim() }); await reload()
  }
  const updateRelationStatus = async (relation: Relation, status: 'accepted' | 'disputed') => {
    const basis = window.prompt('Основание решения по связи')
    if (!basis?.trim()) { setMessage('Статус связи не изменён: требуется основание решения.'); return }
    await api.updateSemanticRelation(relation.id, status, basis.trim()); await reload()
    setMessage(`Статус связи изменён на «${status === 'accepted' ? 'принята' : 'оспорена'}».`)
  }
  const indexPosition = async (position: Position) => {
    setBusy(true); setMessage('Индексация выбранного положения…')
    try {
      const items = [
        { representation: 'functional' as const, entityId: position.id },
        ...position.fragments.map(({ fragment }) => ({ representation: 'source' as const, entityId: fragment.id })),
        ...position.observations.map((observation) => ({ representation: 'observation' as const, entityId: observation.id })),
      ]
      const result = await api.indexSemantic({ projectId, versionId, items })
      const failed = result.results.filter((item) => item.status === 'failed')
      setMessage(`Индексировано/актуально: ${result.results.length - failed.length}; ошибок: ${failed.length}.${failed[0]?.error ? ` ${failed[0].error}` : ''}`)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const indexSource = async () => {
    if (!fragmentChoice) return
    setBusy(true); setMessage('Индексирование выбранного исходного фрагмента…')
    try {
      const result = await api.indexSemantic({ projectId, versionId, items: [{ representation: 'source', entityId: fragmentChoice }] })
      setMessage(result.results[0]?.status === 'failed' ? result.results[0].error ?? 'Индексация не удалась' : 'Исходный фрагмент добавлен в индекс.')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const runSearch = async () => {
    if (!query.trim()) return
    setBusy(true); setMessage(''); setSearchNote(''); setSearchError(''); setHits([]); setSelectedHitIndex(null); setSearched(true)
    try {
      const result = await api.searchSemantic({ projectId, versionId, query: query.trim(), representation: mode, includeDiagnostics, topK, threshold })
      if (result.error) throw new Error(result.error)
      setHits(result.results as SearchHit[]); setSearchNote(result.note ?? '')
      if (result.index) setSearchNote(`${result.note ?? ''} Индекс: актуально ${result.index.ready}, stale ${result.index.stale}, ошибок ${result.index.failed ?? 0}, без вектора ${result.index.missing}.`)
    } catch (error) { setSearchError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const saveRelation = async (targetId = relationTarget) => {
    setBusy(true)
    try {
      await api.createSemanticRelation({ sourcePositionId: selectedForRelation, targetPositionId: targetId, kind: relationKind, rationale: relationRationale })
      setRelationRationale(''); await reload(); setMessage('Предложенная связь сохранена; она не считается доказанной.')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const saveObservation = async () => {
    const [kind, id] = observationSource.split(':')
    setBusy(true)
    try {
      await api.createPositionObservation({ positionId: observationPosition, runId: kind === 'run' ? id : null, noteId: kind === 'note' ? id : null, observation: observationText, evidenceText, conditions: observationConditions, criterion, status: observationStatus })
      setObservationText(''); setEvidenceText(''); setObservationConditions(''); setCriterion(''); setObservationPosition(''); await reload(); setMessage('Наблюдение связано с выбранным Run или Note и сохранено без изменения источника.')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const updateFlow = async (flowId: string, flowPatch: unknown) => {
    if (!contourId) return
    setBusy(true)
    try {
      const result = await api.runSemanticContour({ action: 'decision-flow-update', projectId, versionId, analysisId: contourId, flowId, flowPatch })
      if (result.state) setContour(result.state as ContourState)
      setMessage('Codemap сохранён вручную и остаётся proposed, пока пользователь отдельно не изменит его статус.')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const changeFlowNodeStatus = (flow: DecisionFlow, nodeId: string, status: 'accepted' | 'disputed') => {
    const basis = flowDecisionBasis[`node:${nodeId}`]?.trim()
    if (!basis) { setMessage('Для пользовательского решения по узлу укажите основание.'); return }
    void updateFlow(flow.id, { nodes: flow.nodes.map((current) => {
      const currentId = current.nodeId ?? current.positionId
      return { ...current, nodeId: currentId, positionIds: current.positionIds ?? [current.positionId], provenance: currentId === nodeId ? 'user' : current.provenance ?? 'instruction-interpretation', status: currentId === nodeId ? status : current.status ?? 'proposed', basis: current.basis ?? current.applicableRule, ...(currentId === nodeId ? { decisionBasis: basis } : {}) }
    }) })
  }
  const changeFlowTransitionStatus = (flow: DecisionFlow, transition: DecisionFlowTransition, status: 'accepted' | 'disputed') => {
    const basis = flowDecisionBasis[`transition:${transition.id}`]?.trim()
    if (!basis) { setMessage('Для пользовательского решения по переходу укажите основание.'); return }
    void updateFlow(flow.id, { transitionDecision: { id: transition.id, status, basis } })
  }
  const createDiscrepancy = async () => {
    const executor = runs.find((run) => run.id === effectiveDiscrepancyRunIds.executor)
    const evaluator = runs.find((run) => run.id === effectiveDiscrepancyRunIds.evaluator)
    if (!executor || !evaluator || !effectiveDiscrepancyCriterion.trim() || !discrepancySummary.trim()) { setMessage('Выберите два Run и укажите сохранённый критерий и суть расхождения.'); return }
    const position = positions.find((item) => item.id === observationPosition) ?? positions[0]
    const observationRows = position?.observations.filter((item) => item.runId === executor.id) ?? []
    const localCheck = executor.programChecks.find((item) => item.scope === 'raw-response')
    const evidence = [
      { kind: 'scenario-criterion', id: evaluator.scenarioId ?? '', label: 'Критерий Evaluator', excerpt: effectiveDiscrepancyCriterion.trim() },
      { kind: 'run-output', id: executor.id, label: 'Исходный ответ Executor', excerpt: (executor.output ?? '').slice(0, 1200) },
      ...(localCheck ? [{ kind: 'local-check', id: executor.id, label: localCheck.name, excerpt: localCheck.detail }] : []),
      ...observationRows.map((item) => ({ kind: 'observation', id: item.id, label: 'Сохранённое наблюдение', excerpt: item.observation })),
      ...(position?.fragments ?? []).slice(0, 2).map(({ fragment }) => ({ kind: 'fragment', id: fragment.id, path: fragment.path, label: `Исходный Fragment ${fragment.path}`, excerpt: fragment.text.slice(0, 600) })),
    ]
    setBusy(true)
    try {
      await api.createResearchDiscrepancy({ projectId, versionId, assessment: discrepancyAssessment, criterion: effectiveDiscrepancyCriterion.trim(), summary: discrepancySummary.trim(), runIds: [executor.id, evaluator.id], observationIds: observationRows.map((item) => item.id), positionIds: position ? [position.id] : [], fragmentIds: position?.fragments.map((item) => item.fragment.id) ?? [], evidence, limitations: ['Предложение сопоставляет сохранённый verdict с локальной проверкой/Observation; оно не является Finding и не изменяет verdict.', 'Фактическая последовательность внутренних действий модели неизвестна.'] })
      setDiscrepancySummary(''); await reload(); setMessage('Расхождение сохранено как предложенное. Пользовательское решение не установлено.')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const decideDiscrepancy = async (id: string, decision: 'confirmed' | 'rejected') => {
    const note = decisionReason[id]?.trim() ?? ''
    if (!note) { setMessage('Для пользовательского решения укажите основание.'); return }
    setBusy(true)
    try { await api.decideResearchDiscrepancy(id, { decision, note }); await reload(); setMessage(decision === 'confirmed' ? 'Пользователь подтвердил предложенную интерпретацию.' : 'Пользователь отклонил предложенную интерпретацию; источники и оценки сохранены.') }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }

  return <div className="space-y-4 py-2">
    <div className="rounded-lg border bg-card p-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><Workflow className="size-4" />Смысловая карта</h2>
      <p className="mt-1 text-sm">{projectName} · версия <span className="font-mono text-xs">{versionId}</span></p>
      {codemapReturnCampaignId && <Button size="sm" variant="outline" className="mt-2" onClick={() => setStudio('research')}>Вернуться к кампании</Button>}
      {navigationNotice && <p role="status" className="mt-2 text-xs text-muted-foreground">{navigationNotice}</p>}
      <p className="mt-2 text-xs text-muted-foreground">{researchState ? `Положения: ${researchState.interpretations.total} · функциональный индекс: ${researchState.index.ready}/${researchState.interpretations.total} готово${researchState.index.stale ? ` · устарело ${researchState.index.stale}` : ''}${researchState.index.failed ? ` · ошибок ${researchState.index.failed}` : ''}${researchState.index.missing ? ` · отсутствует ${researchState.index.missing}` : ''} · открытые расхождения: ${researchState.discrepancies.open}` : 'Загружается краткая сводка состояния…'}</p>
      <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">О состоянии поиска</summary><p className="mt-2">Близость помогает найти кандидатов и не является вероятностью правильности или доказательством смысла. Длинный Fragment T — контейнер; его содержание ищется через индексированные исходные фрагменты по разделам.</p></details>
    </div>
    <nav aria-label="Режимы смысловой карты" className="flex gap-2 overflow-x-auto border-b pb-2">
      {([['search', 'Поиск'], ['positions', 'Положения и связи'], ['flows', 'Потоки решений'], ['research', 'Исследование'], ['campaign', 'Автоматическое исследование'], ['processing', 'Обработка и индекс']] as [MapTab, string][]).map(([tab, title]) => <Button key={tab} size="sm" variant={activeTab === tab ? 'default' : 'outline'} aria-pressed={activeTab === tab} onClick={() => { setActiveTab(tab); setSelectedHitIndex(null) }}>{title}</Button>)}
    </nav>
    {activeTab === 'campaign' && <ResearchCampaignPanel projectId={projectId} versionId={versionId} />}
    {activeTab === 'search' && <section aria-labelledby="semantic-search-heading" className="space-y-4 rounded-lg border bg-card p-4">
      <div><h3 id="semantic-search-heading" className="text-base font-semibold">Какое правило или решение вы хотите найти?</h3><p className="mt-1 text-xs text-muted-foreground">Введите вопрос. Поиск использует только выбранный режим и не запускает пакетную обработку.</p></div>
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void runSearch() }}>
        <div className="flex flex-col gap-2 sm:flex-row"><Input className="min-h-11 flex-1" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Почему нельзя восстанавливать отсутствующие исторические сообщения догадкой?" aria-label="Запрос к смысловой карте" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void runSearch() } }} /><Button type="submit" size="lg" disabled={busy || !query.trim()}><Search className="mr-2 size-4" />{busy ? 'Поиск…' : 'Найти'}</Button></div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Режим поиска">{modes.map(([value, label]) => <Button key={value} type="button" size="sm" variant={mode === value ? 'secondary' : 'outline'} aria-pressed={mode === value} onClick={() => { setMode(value); setSearched(false); setHits([]); setSelectedHitIndex(null) }}>{label}</Button>)}</div>
        <details className="text-xs"><summary className="cursor-pointer font-medium">Параметры поиска</summary><div className="mt-3 flex flex-wrap items-center gap-4 rounded border p-3"><label className="flex items-center gap-2">Количество результатов (Top-K)<Input className="h-8 w-20" type="number" min={1} max={20} value={topK} onChange={(event) => setTopK(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /></label><label className="flex items-center gap-2">Минимальная близость<Input className="h-8 w-24" type="number" min={-1} max={1} step={0.05} value={threshold} onChange={(event) => setThreshold(Math.max(-1, Math.min(1, Number(event.target.value) || 0)))} /></label><label className="flex items-center gap-2"><input type="checkbox" checked={includeDiagnostics} onChange={(event) => setIncludeDiagnostics(event.target.checked)} />Включать записи [SMOKE]/[DIAGNOSTIC]</label></div></details>
      </form>
      {searchError && <p role="alert" className="rounded border border-destructive/50 p-3 text-sm">Поиск не выполнен: {searchError}</p>}
      {busy && <p role="status" className="rounded border border-dashed p-3 text-sm">Ищем в режиме «{modes.find(([value]) => value === mode)?.[1]}»…</p>}
      {searched && !busy && hits.length === 0 && !searchError && <p role="status" className="rounded border border-dashed p-4 text-sm">В режиме «{modes.find(([value]) => value === mode)?.[1]}» совпадений выше заданного порога нет. Это не означает, что правила нет в тексте.{researchState && researchState.index.ready === 0 && <> Для этой версии функциональный индекс не готов; проверьте вкладку «Обработка и индекс».</>}</p>}
      {searchNote && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Сведения о запросе и индексе</summary><p className="mt-2">{searchNote}</p></details>}
      {hits.length > 0 && <div className="grid gap-3 lg:grid-cols-[minmax(260px,0.75fr)_minmax(0,1.25fr)]">
        <h4 className="font-semibold lg:col-span-2">Результаты — {hits.length}</h4>
        <ol aria-label="Результаты поиска" className={`space-y-2 ${selectedHitIndex !== null ? 'hidden lg:block' : ''}`}>{hits.map((hit, index) => <li key={`${hit.representation}-${hit.position?.id ?? hit.fragment?.id ?? hit.observation?.id}-${index}`}><button type="button" className={`w-full rounded-md border p-3 text-left text-sm hover:bg-muted/50 ${selectedHitIndex === index ? 'border-primary bg-muted/50' : ''}`} onClick={() => setSelectedHitIndex(index)}><span className="mb-1 flex flex-wrap items-center gap-2"><ObjectTypeBadge kind={hit.position ? 'position' : hit.observation ? 'observation' : 'source'}/><strong className="font-medium">{hit.position?.title ?? hit.observation?.position.title ?? `Фрагмент ${hit.fragment?.path}`}</strong></span><span className="mt-1 block text-xs text-muted-foreground">{hit.position?.purpose ?? hit.observation?.observation ?? hit.fragment?.text?.slice(0, 180)}</span><span className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">{hit.position ? <StatusBadge status={hit.position.status}/> : hit.observation ? <StatusBadge status={hit.observation.status}/> : <span>Исходный текст</span>} · {hit.position?.fragments[0]?.fragment.path ?? hit.fragment?.path ?? 'источник неизвестен'} · косинусная близость {hit.similarity.toFixed(3)}</span></button></li>)}</ol>
        <aside aria-label="Детали выбранного результата" className={selectedHitIndex !== null ? 'space-y-3' : 'hidden space-y-3 lg:block'}>{selectedHitIndex === null ? <p className="rounded border border-dashed p-4 text-sm text-muted-foreground">Выберите результат, чтобы посмотреть детали.</p> : (() => { const hit = hits[selectedHitIndex]; if (!hit) return null; const position = hit.position; const positionState = position ? researchState?.positions.find((item) => item.positionId === position.id) : undefined; const decisionNotes = position ? notes.filter((note) => { if (note.kind !== 'user-verdict') return false; try { const body = JSON.parse(note.body) as { type?: string; objectType?: string; objectId?: string }; return body.type === 's2-user-decision-history' && body.objectType === 'semantic-position' && body.objectId === position.id } catch { return false } }) : []; return <article className="space-y-3 rounded-lg border p-4 text-sm"><div className="flex items-center justify-between gap-2"><h4 className="font-semibold">{position?.title ?? hit.observation?.position.title ?? `Фрагмент ${hit.fragment?.path}`}</h4><Button type="button" size="sm" variant="outline" className="lg:hidden" onClick={() => setSelectedHitIndex(null)}>К результатам</Button></div>
          <details open><summary className="cursor-pointer font-medium">Что делает</summary><div className="mt-2 space-y-1 text-xs">{position ? <><p>{position.purpose || 'Назначение не указано.'}</p><p><b>Регулируемое решение:</b> {position.regulatedDecision || 'не указано'}</p><p><b>Условия:</b> {position.conditions || 'не указаны'}</p><p><b>Ожидаемое поведение:</b> {position.expectedBehavior || 'не указано'}</p><p><b>Статус:</b> {position.status}</p></> : <p>{hit.observation?.observation ?? hit.fragment?.text ?? 'Содержание отсутствует.'}</p>}<p className="text-muted-foreground">Косинусная близость: {hit.similarity.toFixed(3)} · не является вероятностью правильности. Индекс {hit.model}, {hit.dimensions} измерений.</p></div></details>
          <details><summary className="cursor-pointer font-medium">Исходный текст ({position?.fragments.length ?? (hit.fragment ? 1 : 0)})</summary><div className="mt-2 space-y-2">{position?.fragments.map(({ fragment }) => <details key={fragment.id}><summary className="cursor-pointer text-xs">{fragment.path}</summary><p className="mt-2 whitespace-pre-wrap text-xs">{fragment.text}</p></details>)}{hit.fragment && <details><summary className="cursor-pointer text-xs">{hit.fragment.path}</summary><p className="mt-2 whitespace-pre-wrap text-xs">{hit.fragment.text}</p></details>}{!position?.fragments.length && !hit.fragment && <p className="text-xs text-muted-foreground">Исходный фрагмент не связан.</p>}</div></details>
          <details><summary className="cursor-pointer font-medium">Связи</summary><div className="mt-2 space-y-2 text-xs">{position && [...position.outgoingRelations.map((item) => ({ ...item, direction: 'исходящая' })), ...position.incomingRelations.map((item) => ({ ...item, direction: 'входящая' }))].map((relation) => <div key={relation.id}><p>{relation.direction}: {relation.direction === 'исходящая' ? position.title : relation.sourcePosition?.title} → {relation.direction === 'исходящая' ? relation.targetPosition?.title : position.title} · {relation.kind} · {relation.status}</p>{notes.filter((note) => { if (note.kind !== 'user-verdict') return false; try { const body = JSON.parse(note.body) as { objectType?: string; objectId?: string; previousStatus?: string; newStatus?: string; basis?: string; decidedAt?: string }; return body.objectType === 'semantic-relation' && body.objectId === relation.id } catch { return false } }).map((note) => { const body = JSON.parse(note.body) as { previousStatus?: string; newStatus?: string; basis?: string; decidedAt?: string }; return <p key={note.id} className="text-muted-foreground">История решения: {body.previousStatus ?? 'статус неизвестен'} → {body.newStatus ?? 'статус неизвестен'} · {body.decidedAt ?? 'дата неизвестна'} · основание: {body.basis ?? 'не сохранено'}</p> })}</div>)}{hit.fragment?.semanticLinks.map(({ semanticPosition }) => <p key={semanticPosition.id}>{semanticPosition.title} · {semanticPosition.status}</p>)}{(!position || (!position.outgoingRelations.length && !position.incomingRelations.length)) && !hit.fragment?.semanticLinks.length && <p className="text-muted-foreground">Связанные положения отсутствуют.</p>}{position && <div className="space-y-2 rounded border p-2"><p className="font-medium">Предложить связь от другого положения</p><select className="h-8 w-full rounded border bg-background px-2" value={selectedForRelation} onChange={(event) => setSelectedForRelation(event.target.value)} aria-label="Исходное положение"><option value="">Выберите исходное положение</option>{positions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>{selectedForRelation && selectedForRelation !== position.id && <><select className="h-8 w-full rounded border bg-background px-2" value={relationKind} onChange={(event) => setRelationKind(event.target.value)} aria-label="Тип связи">{relationKinds.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select><Input className="h-8" value={relationRationale} onChange={(event) => setRelationRationale(event.target.value)} placeholder="Основание связи" /><Button size="sm" variant="outline" disabled={busy || !relationRationale.trim()} onClick={() => { setRelationTarget(position.id); void saveRelation(position.id) }}><ArrowRight className="mr-1 size-3" />Предложить связь</Button></>}</div>}</div></details>
          <details><summary className="cursor-pointer font-medium">Сценарии и результаты</summary><div className="mt-2 flex flex-wrap gap-2 text-xs">{positionState?.scenarioIds.map((id) => <Button key={id} size="sm" variant="outline" onClick={() => openRelated('scenario', id)}><ObjectTypeBadge kind="scenario"/> Открыть сценарий {id.slice(0, 10)}…</Button>)}{positionState?.runIds.map((id) => <Button key={id} size="sm" variant="outline" onClick={() => openRelated('run', id)}><ObjectTypeBadge kind="run"/> Открыть Run {id.slice(0, 10)}…</Button>)}{!positionState?.scenarioIds.length && !positionState?.runIds.length && <p className="text-muted-foreground">Связанные сценарии и Run не найдены.</p>}</div></details>
          <details><summary className="cursor-pointer font-medium">Наблюдения и расхождения</summary><div className="mt-2 space-y-2 text-xs">{position?.observations.map((item) => <p key={item.id} className="flex flex-wrap items-center gap-2"><ObjectTypeBadge kind="observation"/><StatusBadge status={item.status}/>{item.observation}</p>)}{positionState?.openDiscrepancyNoteIds.map((id) => <Button key={id} size="sm" variant="outline" onClick={() => { setActiveTab('research'); requestAnimationFrame(() => document.getElementById(`research-discrepancy-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })) }}><ObjectTypeBadge kind="discrepancy"/> Открыть расхождение {id.slice(0, 10)}…</Button>)}{!position?.observations.length && !positionState?.openDiscrepancyNoteIds.length && <p className="text-muted-foreground">Наблюдений и расхождений для этого положения нет.</p>}</div></details>
          <details><summary className="cursor-pointer font-medium">История решений</summary><div className="mt-2 space-y-1 text-xs">{decisionNotes.map((note) => { const entry = JSON.parse(note.body) as { previousStatus: string; newStatus: string; basis: string; decidedAt: string }; return <p key={note.id}>{entry.previousStatus} → {entry.newStatus} · {entry.decidedAt} · {entry.basis}</p> })}{!decisionNotes.length && <p className="text-muted-foreground">Сохранённая история решений для этого положения отсутствует.</p>}</div></details>
        </article> })()}</aside>
      </div>}
    </section>}
      <section hidden={activeTab !== 'processing' && activeTab !== 'flows'} className="mt-3 rounded-md border border-dashed p-3">
        <div hidden={activeTab !== 'processing'} className="flex flex-wrap items-center gap-2">
          <strong className="text-xs">Пакетный контур инструкции</strong>
          {!contourId && <Button size="sm" variant="outline" disabled={busy} onClick={() => void contourAction('start')}>Создать операцию</Button>}
          {contourId && contour?.status !== 'completed' && contour?.status !== 'cancelled' && <Button size="sm" disabled={busy} onClick={() => void contourAction('step')}>Обработать один блок</Button>}
          {contourId && contour?.status !== 'completed' && contour?.status !== 'cancelled' && <Button size="sm" variant="outline" disabled={busy} onClick={() => void contourAction('cancel')}>Отменить</Button>}
          {contourId && <span className="text-xs text-muted-foreground">Analysis {contourId} · состояние {contour?.status ?? 'загрузка'} · блоки {contour?.blocks.filter((block) => block.status === 'completed').length ?? 0}/{contour?.blocks.length ?? 0} · предложений положений {contour?.proposals.positions.length ?? 0} · связей {contour?.proposals.relations.length ?? 0}</span>}
        </div>
        {activeTab === 'processing' && contour?.diagnostics && <>
          <p className="mt-1 text-xs text-muted-foreground">Покрытие Fragment: {contour.coverage.length} · причины/состояния сохраняются отдельно от смысловой индексации. Для разбора результатов статусы остаются proposed.</p>
          <details className="rounded border p-3 text-xs"><summary className="cursor-pointer font-medium">Полный coverage · {filteredCoverage.length} из {coverageRows.length}</summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-3"><Input aria-label="Поиск coverage" className="h-8" value={coverageQuery} onChange={(event) => { setCoverageQuery(event.target.value); setCoveragePage(0) }} placeholder="Поиск по тексту, причине или path" />
              <select aria-label="Фильтр coverage по разделу" className="h-8 rounded border bg-background px-2" value={coverageSection} onChange={(event) => { setCoverageSection(event.target.value); setCoveragePage(0) }}><option value="all">Все разделы</option>{coverageSections.map((section) => <option key={section} value={section}>Раздел {section}</option>)}</select>
              <select aria-label="Фильтр coverage по статусу" className="h-8 rounded border bg-background px-2" value={coverageStatus} onChange={(event) => { setCoverageStatus(event.target.value); setCoveragePage(0) }}><option value="all">Все статусы</option>{[...new Set(coverageRows.map((row) => row.status))].sort().map((status) => <option key={status} value={status}>{status}</option>)}</select>
            </div>
            <p className="mt-2 text-muted-foreground">Показано {visibleCoverage.length} из {filteredCoverage.length} · страница {coveragePage + 1}/{coveragePageCount} · coverage — учёт обработки источников, не утверждение о полноте смысловой модели.</p>
            <ol className="mt-2 space-y-1">{visibleCoverage.map((row) => <li key={row.fragmentId} className="rounded border p-2"><p><b>{row.path}</b> · {row.status}{row.classification ? ` · ${row.classification}` : ''}</p><p className="whitespace-pre-wrap text-muted-foreground">{row.reason ?? 'Причина не сохранена.'}</p><details className="mt-1"><summary className="cursor-pointer">Технические ссылки</summary><p className="mt-1 select-text">Fragment {row.fragmentId}{row.linkedFragmentId ? ` · связанный Fragment ${row.linkedFragmentId}` : ''}{row.positionIds.length ? ` · положения ${row.positionIds.join(', ')}` : ''}</p></details></li>)}</ol>
            <div className="mt-3 flex items-center gap-2"><Button size="sm" variant="outline" disabled={coveragePage === 0} onClick={() => setCoveragePage((page) => Math.max(0, page - 1))}>Назад</Button><Button size="sm" variant="outline" disabled={coveragePage + 1 >= coveragePageCount} onClick={() => setCoveragePage((page) => Math.min(coveragePageCount - 1, page + 1))}>Далее</Button></div>
          </details>
          {contour.status !== 'completed' && <div className="mt-2 flex flex-wrap gap-2">
            {contour.stage === 'relations' && <Button size="sm" variant="outline" disabled={busy || contour.blocks.some((block) => block.status !== 'completed')} onClick={() => void contourAction('relations')}>Предложить направленные связи</Button>}
            <SourcePicker label="Пилотные исходные фрагменты" fragments={fragments.filter((fragment) => fragment.kind === 'list_item' || fragment.kind === 'sentence')} selectedIds={pilotFragmentIds} onChange={setPilotFragmentIds} multiple />
            <label className="flex items-center gap-1 text-xs">Пилотные положения <select multiple className="h-16 min-w-48 rounded border bg-background px-1" value={pilotPositionIds} onChange={(event) => setPilotPositionIds(Array.from(event.target.selectedOptions, (option) => option.value))}>{positions.filter((position) => position.provenanceRef === contourId && position.status === 'proposed').map((position) => <option key={position.id} value={position.id}>{position.title}</option>)}</select></label>
            <Button size="sm" variant="outline" disabled={busy || !pilotFragmentIds.length} onClick={() => void contourAction('index-init')}>Подготовить embedding индексацию</Button>
            {contour.stage === 'scenarios' && (contour.validation?.items.length ?? 0) === 0 && <Button size="sm" variant="outline" disabled={busy || !pilotPositionIds.length} onClick={() => void contourAction('validation-init')}>Подготовить [VALIDATION] сценарии</Button>}
            {contour.stage === 'indexing' && <Button size="sm" disabled={busy} onClick={() => void contourAction('index-step')}>Индексировать batch</Button>}
            {contour.stage === 'scenarios' && (contour.validation?.items.length ?? 0) > 0 && <Button size="sm" disabled={busy || contour.validation?.status === 'completed'} onClick={() => void contourAction('validation-step')}>Выполнить следующий Executor/Evaluator</Button>}
            {contour.indexState && <span className="text-xs text-muted-foreground">Embedding: {contour.indexState.next}/{contour.indexState.entries.length} · {contour.indexState.status}</span>}
            {contour.validation && <span className="text-xs text-muted-foreground">Validation: {contour.validation.items.filter((item) => item.status === 'evaluator-done').length}/{contour.validation.items.length}</span>}
          </div>}
        </>}
        {activeTab === 'flows' && <>
          <h3 className="font-semibold">Потоки решений</h3>
          {!contour?.decisionFlows?.length && <p className="rounded border border-dashed p-4 text-sm text-muted-foreground">Сохранённых потоков пока нет. Создайте outline вручную; он не станет выполненной трассой автоматически.</p>}
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded border p-2">
            <label className="min-w-64 flex-1 space-y-1 text-xs">Ситуация для codemap<Input className="h-8 text-xs" value={flowCaseLabel} onChange={(event) => setFlowCaseLabel(event.target.value)} /></label>
            <label className="space-y-1 text-xs">Опорные положения<select multiple className="h-16 min-w-56 rounded border bg-background px-1" value={pilotPositionIds} onChange={(event) => setPilotPositionIds(Array.from(event.target.selectedOptions, (option) => option.value))}>{positions.filter((position) => position.provenanceRef === contourId && position.status === 'proposed').map((position) => <option key={position.id} value={position.id}>{position.title}</option>)}</select></label>
            <Button size="sm" variant="outline" disabled={busy || !pilotPositionIds.length || !flowCaseLabel.trim()} onClick={() => void contourAction('decision-flow')}>Сохранить предложенный outline</Button>
          </div>
          {contour?.decisionFlows?.map((flow, flowIndex) => <article key={`${flow.caseLabel}-${flowIndex}`} className="mt-3 space-y-2 rounded border p-3">
            <div className="flex flex-wrap items-center gap-2"><strong className="text-xs">Предложенный outline · {flow.status}</strong><span className="text-xs">{flow.caseLabel}</span><span className="text-[10px] text-muted-foreground">узлов: {flow.nodes.length} · предложенных переходов: {(flow.transitions ?? []).length} · не является трассой Run · исполнение не проверено</span></div>
            {flow.nodes.map((node) => {
              const nodeId = node.nodeId ?? node.positionId
              const draft = { ...node, ...nodeDrafts[nodeId] }
              return <div key={nodeId} className="space-y-2 rounded bg-muted/40 p-2 text-xs">
                <div className="flex flex-wrap items-center gap-2"><strong>{node.order}. {node.title}</strong><span>тип: {node.kind ?? 'не задан (старый формат)'}</span><span>статус: {node.status ?? 'proposed'}</span><span>происхождение: {node.provenance ?? 'интерпретация'}</span></div>
                <p>Условие: {node.condition || 'не установлено'}</p><p>Применимое правило: {node.applicableRule}</p><p>Проверка решения: {node.check}</p><p>Ожидаемое действие: {node.expectedAction}</p><p>Исключение/ограничение: {node.exceptionOrLimit || 'не указано'}</p><p>Допустимый результат: {node.allowedResult ?? 'не задан в положении'}</p><p>Неопределённость: {node.uncertainty}</p>
                <p className="text-muted-foreground">Источники: {node.sourceFragmentIds.map((id) => fragments.find((fragment) => fragment.id === id)?.path ?? id).join(', ') || 'источник не указан'}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label>Тип узла<select className="ml-2 rounded border bg-background p-1" value={draft.kind ?? 'condition'} onChange={(event) => setNodeDrafts((old) => ({ ...old, [nodeId]: { ...old[nodeId], kind: event.target.value as DecisionFlowNode['kind'] } }))}><option value="condition">Условие</option><option value="action">Действие / проверка</option><option value="expected-result">Ожидаемый результат</option><option value="gap">Явный пробел</option></select></label>
                  <label>Название<Input className="mt-1 h-8" value={draft.title} onChange={(event) => setNodeDrafts((old) => ({ ...old, [nodeId]: { ...old[nodeId], title: event.target.value } }))} /></label>
                  <label>Условие<Input className="mt-1 h-8" value={draft.condition} onChange={(event) => setNodeDrafts((old) => ({ ...old, [nodeId]: { ...old[nodeId], condition: event.target.value } }))} /></label>
                  <label>Ожидаемое действие / результат<Input className="mt-1 h-8" value={draft.expectedAction} onChange={(event) => setNodeDrafts((old) => ({ ...old, [nodeId]: { ...old[nodeId], expectedAction: event.target.value } }))} /></label>
                  <label className="sm:col-span-2">Основание<Textarea className="mt-1 min-h-16" value={draft.basis ?? node.applicableRule} onChange={(event) => setNodeDrafts((old) => ({ ...old, [nodeId]: { ...old[nodeId], basis: event.target.value, applicableRule: event.target.value } }))} /></label>
                </div>
                <Input className="h-8 max-w-lg" placeholder="Основание решения по статусу узла" value={flowDecisionBasis[`node:${nodeId}`] ?? ""} onChange={(event) => setFlowDecisionBasis((old) => ({ ...old, [`node:${nodeId}`]: event.target.value }))} />
                {node.decisionHistory?.map((entry, index) => <p key={`${entry.decidedAt}-${index}`}>Решение: {entry.previousStatus} → {entry.newStatus}; {entry.actorType}; {entry.decidedAt}; основание: {entry.basis}</p>)}
                <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void updateFlow(flow.id, { nodes: flow.nodes.map((current) => { const currentId = current.nodeId ?? current.positionId; return currentId === nodeId ? { ...current, ...draft, nodeId, positionIds: current.positionIds ?? [current.positionId], provenance: current.provenance ?? 'user', status: current.status ?? 'proposed' } : { ...current, nodeId: currentId, positionIds: current.positionIds ?? [current.positionId], provenance: current.provenance ?? 'instruction-interpretation', status: current.status ?? 'proposed', basis: current.basis ?? current.applicableRule } }) })}>Сохранить ручную правку</Button>{node.status !== 'accepted' && <Button size="sm" variant="outline" disabled={busy} onClick={() => changeFlowNodeStatus(flow, nodeId, 'accepted')}>Принять узел</Button>}{node.status !== 'disputed' && <Button size="sm" variant="outline" disabled={busy} onClick={() => changeFlowNodeStatus(flow, nodeId, 'disputed')}>Оспорить узел</Button>}</div>
              </div>
            })}
            <div className="space-y-2 rounded border p-2 text-xs">
              <strong>Направленные переходы</strong>
              {(flow.transitions ?? []).map((transition) => <div key={transition.id} className="flex flex-wrap items-center gap-2 rounded border p-2"><span>{flow.nodes.find((node) => (node.nodeId ?? node.positionId) === transition.fromNodeId)?.title} → {flow.nodes.find((node) => (node.nodeId ?? node.positionId) === transition.toNodeId)?.title}; условие: {transition.conditionLabel}; статус: {transition.status}</span><span>Основание: {transition.basis}</span><span>источники: {transition.sourceFragmentIds.map((id) => fragments.find((fragment) => fragment.id === id)?.path ?? id).join(', ')}</span><Input className="h-8 max-w-sm" placeholder="Основание решения по переходу" value={flowDecisionBasis[`transition:${transition.id}`] ?? ""} onChange={(event) => setFlowDecisionBasis((old) => ({ ...old, [`transition:${transition.id}`]: event.target.value }))} />{transition.decisionHistory?.map((entry, index) => <span key={`${entry.decidedAt}-${index}`}>Решение: {entry.previousStatus} → {entry.newStatus}; {entry.actorType}; {entry.decidedAt}; {entry.basis}</span>)}{transition.status !== 'accepted' && <Button size="sm" variant="outline" onClick={() => changeFlowTransitionStatus(flow, transition, 'accepted')}>Принять переход</Button>}{transition.status !== 'disputed' && <Button size="sm" variant="outline" onClick={() => changeFlowTransitionStatus(flow, transition, 'disputed')}>Оспорить переход</Button>}</div>)}
              {(flow.transitions ?? []).length === 0 && <p className="text-muted-foreground">Переходы не заданы: подтверждаемого source-backed основания пока нет. Интерпретация не соединена с этим outline.</p>}
              {flow.nodes.length > 1 && <div className="grid gap-2 sm:grid-cols-2">
                <label>Из узла<select className="mt-1 w-full rounded border bg-background p-1" value={transitionFrom} onChange={(event) => setTransitionFrom(event.target.value)}><option value="">Выберите начальный узел</option>{flow.nodes.map((node) => <option key={node.nodeId ?? node.positionId} value={node.nodeId ?? node.positionId}>{node.title}</option>)}</select></label>
                <label>В узел<select className="mt-1 w-full rounded border bg-background p-1" value={transitionTo} onChange={(event) => setTransitionTo(event.target.value)}><option value="">Выберите целевой узел</option>{flow.nodes.map((node) => <option key={node.nodeId ?? node.positionId} value={node.nodeId ?? node.positionId}>{node.title}</option>)}</select></label>
                <label>Подпись условия перехода<Input className="mt-1 h-8" value={transitionLabel} onChange={(event) => setTransitionLabel(event.target.value)} /></label>
                <label>Положение-основание<select className="mt-1 w-full rounded border bg-background p-1" value={transitionPositionId} onChange={(event) => { setTransitionPositionId(event.target.value); setTransitionFragmentId(positions.find((position) => position.id === event.target.value)?.fragments[0]?.fragment.id ?? '') }}><option value="">Выберите положение</option>{positions.filter((position) => flow.nodes.some((node) => (node.positionIds ?? [node.positionId]).includes(position.id))).map((position) => <option key={position.id} value={position.id}>{position.title}</option>)}</select></label>
                <label>Исходный Fragment<select className="mt-1 w-full rounded border bg-background p-1" value={transitionFragmentId} onChange={(event) => setTransitionFragmentId(event.target.value)}><option value="">Выберите источник</option>{positions.find((position) => position.id === transitionPositionId)?.fragments.map(({ fragment }) => <option key={fragment.id} value={fragment.id}>{fragment.path}</option>)}</select></label>
                <label>Основание перехода<Textarea className="mt-1 min-h-16" value={transitionBasis} onChange={(event) => setTransitionBasis(event.target.value)} /></label>
                <Button size="sm" variant="outline" className="sm:col-span-2" disabled={busy || !transitionFrom || !transitionTo || !transitionLabel.trim() || !transitionBasis.trim() || !transitionPositionId || !transitionFragmentId} onClick={() => void updateFlow(flow.id, { appendTransition: { fromNodeId: transitionFrom, toNodeId: transitionTo, conditionLabel: transitionLabel, basis: transitionBasis, positionIds: [transitionPositionId], sourceFragmentIds: [transitionFragmentId], limitations: 'Создано вручную; требуется содержательное рассмотрение.' } })}>Добавить предложенный переход</Button>
              </div>}
            </div>
            <div className="grid gap-2 rounded border border-dashed p-2 text-xs sm:grid-cols-2">
              <strong className="sm:col-span-2">Добавить узел вручную</strong>
              <label>Тип<select className="ml-2 rounded border bg-background p-1" value={newNode.kind} onChange={(event) => setNewNode((old) => ({ ...old, kind: event.target.value as NonNullable<DecisionFlowNode['kind']> }))}><option value="condition">Условие</option><option value="action">Действие / проверка</option><option value="expected-result">Ожидаемый результат</option><option value="gap">Явный пробел</option></select></label>
              <label>Связанное положение<select className="mt-1 w-full rounded border bg-background p-1" value={newNode.positionId} onChange={(event) => { const positionId = event.target.value; setNewNode((old) => ({ ...old, positionId, fragmentId: positions.find((position) => position.id === positionId)?.fragments[0]?.fragment.id ?? '' })) }}><option value="">Выберите положение</option>{positions.map((position) => <option key={position.id} value={position.id}>{position.title}</option>)}</select></label>
              <label>Исходный Fragment<select className="mt-1 w-full rounded border bg-background p-1" value={newNode.fragmentId} onChange={(event) => setNewNode((old) => ({ ...old, fragmentId: event.target.value }))}><option value="">Выберите источник</option>{positions.find((position) => position.id === newNode.positionId)?.fragments.map(({ fragment }) => <option key={fragment.id} value={fragment.id}>{fragment.path}</option>)}</select></label>
              <label>Название<Input className="mt-1 h-8" value={newNode.title} onChange={(event) => setNewNode((old) => ({ ...old, title: event.target.value }))} /></label>
              <label>Условие<Input className="mt-1 h-8" value={newNode.condition} onChange={(event) => setNewNode((old) => ({ ...old, condition: event.target.value }))} /></label>
              <label>Ожидаемое действие/результат<Input className="mt-1 h-8" value={newNode.expectedAction} onChange={(event) => setNewNode((old) => ({ ...old, expectedAction: event.target.value }))} /></label>
              <label className="sm:col-span-2">Основание<Textarea className="mt-1 min-h-14" value={newNode.basis} onChange={(event) => setNewNode((old) => ({ ...old, basis: event.target.value }))} /></label>
              <label className="sm:col-span-2">Ограничение / неизвестное<Input className="mt-1 h-8" value={newNode.limitation} onChange={(event) => setNewNode((old) => ({ ...old, limitation: event.target.value }))} /></label>
              <Button size="sm" variant="outline" disabled={busy || !newNode.positionId || !newNode.fragmentId || !newNode.title.trim() || !newNode.basis.trim()} onClick={() => {
                const nodeId = `manual-${crypto.randomUUID()}`
                const nextNode: DecisionFlowNode = { nodeId, kind: newNode.kind, provenance: 'user', status: 'proposed', basis: newNode.basis, positionId: newNode.positionId, positionIds: [newNode.positionId], order: flow.nodes.length + 1, title: newNode.title.trim(), condition: newNode.condition, applicableRule: newNode.basis, check: 'Уточняется вручную.', expectedAction: newNode.expectedAction, exceptionOrLimit: newNode.limitation, allowedResult: newNode.kind === 'gap' ? 'Не установлен' : null, uncertainty: newNode.limitation || 'Требует содержательной проверки.', sourceFragmentIds: [newNode.fragmentId] }
                const nodes = [...flow.nodes.map((current) => ({ ...current, nodeId: current.nodeId ?? current.positionId, positionIds: current.positionIds ?? [current.positionId], provenance: current.provenance ?? 'instruction-interpretation', status: current.status ?? 'proposed', basis: current.basis ?? current.applicableRule })), nextNode]
                void updateFlow(flow.id, { nodes })
              }}>Добавить proposed-узел</Button>
            </div>
            <p className="text-[10px] text-muted-foreground">{flow.limitation}</p>
          </article>)}
        </>}
      </section>
      <section hidden={activeTab !== 'research'} className="space-y-3 rounded-lg border bg-card p-4">
        <header><h3 className="font-semibold">Исследовательское состояние версии</h3><p className="text-xs text-muted-foreground">Сводка отдельных записей; не единый балл доказанности. Сценарии помечаются по существующему заголовку и не переименовываются.</p></header>
        {researchState && <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <p>Интерпретации: всего {researchState.interpretations.total}; предложено {researchState.interpretations.proposed}; принято {researchState.interpretations.accepted}; оспорено {researchState.interpretations.disputed}.</p>
          <p>Индекс функциональных описаний: ready {researchState.index.ready}; stale {researchState.index.stale}; failed {researchState.index.failed}; missing {researchState.index.missing}.</p>
          <p>Связи: proposed {researchState.relations.proposed}; accepted {researchState.relations.accepted}; disputed {researchState.relations.disputed}.</p>
          <p>Сценарии: всего {researchState.scenarios.total}; статусы unexplored {researchState.scenarios.unexplored}, explored {researchState.scenarios.explored}, run-verified {researchState.scenarios.runVerified}. Маркеры: {Object.entries(researchState.scenarios.byKind).map(([kind, count]) => `${kind} ${count}`).join('; ') || 'нет'}.</p>
          <p>Run: попыток {researchState.runs.attempts}; completed {researchState.runs.completed}; failed {researchState.runs.failed}; cancelled {researchState.runs.cancelled}; локальные ошибки/неуспешные проверки {researchState.runs.technicalErrors}; Evaluator {researchState.runs.evaluations} ({Object.entries(researchState.runs.evaluationVerdicts).map(([verdict, count]) => `${verdict} ${count}`).join(', ') || 'без verdict'}).</p>
          <p>Наблюдения: всего {researchState.observations.total}; unverified {researchState.observations.unverified}; прочие {researchState.observations.other}.</p>
          <p>Расхождения: открытые {researchState.discrepancies.open}; принятые пользователем {researchState.discrepancies.accepted}; оспоренные пользователем {researchState.discrepancies.disputed}.</p>
          <p>Findings: всего {researchState.findings.total}; hypothesis {researchState.findings.hypotheses}; supported {researchState.findings.supported}; disputed {researchState.findings.disputed}; rejected {researchState.findings.rejected}. Неподтверждённые выводы: proposed положения {researchState.unverifiedConclusions.proposedPositions}, unverified Observation {researchState.unverifiedConclusions.unverifiedObservations}.</p>
          <p>Пробелы покрытия исходных фрагментов: {researchState.gaps.contourCoverage?.gap ?? 'нет данных'}; unknown причины не преобразуются в «непредставленное положение».</p>
        </div>}
        <div className="space-y-2 rounded border p-3">
          <strong className="text-sm">Предложения следующего действия · без автозапуска</strong>
          {(researchState?.recommendations ?? []).slice(0, 12).map((recommendation) => <div key={recommendation.key} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-xs"><span><b>{recommendation.gap}.</b> {recommendation.action}. {recommendation.rationale} Ограничение: {recommendation.limitations.join(' ')}</span><div className="flex gap-1">{recommendation.linkedIds.map((id) => <button key={id} type="button" className="rounded border px-1 font-mono text-[10px] hover:bg-muted" onClick={() => { const run = runs.find((item) => item.id === id); if (run) { openRelated('run', run.id); return } const scenario = researchState?.positions.flatMap((item) => item.scenarioIds).find((item) => item === id); if (scenario) { openRelated('scenario', scenario); return } const target = recommendation.target; const anchor = target?.kind === 'discrepancy' ? `research-discrepancy-${target.id}` : target?.kind === 'position' ? `research-position-${target.id}` : target?.kind === 'observation' ? `research-position-${recommendation.key.split(':').at(-1)}` : null; if (anchor) document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); else setStudio('atlas') }}>{id.slice(0, 14)}…</button>)}</div></div>)}
          {researchState?.recommendations.length === 0 && <p className="text-xs text-muted-foreground">Локальные правила не нашли рекомендаций для выбранных положений.</p>}
        </div>
        <div className="space-y-2 rounded border p-3">
          <strong className="text-sm">Зафиксировать расхождение вручную</strong>
          <p className="text-xs text-muted-foreground">Сопоставьте минимум два сохранённых Run. Регистрируется proposed Note с отдельными ссылками и свидетельствами. Это не меняет Run, verdict, Observation или Finding и не требует LLM.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs">Executor Run<select className="mt-1 w-full rounded border bg-background p-2" value={effectiveDiscrepancyRunIds.executor} onChange={(event) => setDiscrepancyRunIds((old) => ({ ...old, executor: event.target.value }))}><option value="">Выберите Run</option>{runs.filter((run) => run.role === 'executor' && run.versionId === versionId && run.origin !== 'demo').map((run) => <option key={run.id} value={run.id}>{run.id} · {run.status}</option>)}</select></label>
            <label className="text-xs">Evaluator Run<select className="mt-1 w-full rounded border bg-background p-2" value={effectiveDiscrepancyRunIds.evaluator} onChange={(event) => { const id = event.target.value; setDiscrepancyRunIds((old) => ({ ...old, evaluator: id })); const evaluator = runs.find((run) => run.id === id); if (evaluator?.input?.taskContext?.criterion) setDiscrepancyCriterion(evaluator.input.taskContext.criterion) }}><option value="">Выберите Run</option>{runs.filter((run) => run.role === 'evaluator' && run.versionId === versionId && run.origin !== 'demo').map((run) => <option key={run.id} value={run.id}>{run.id} · {run.verdict ?? 'без verdict'}</option>)}</select></label>
            <label className="text-xs">Классификация<select className="mt-1 w-full rounded border bg-background p-2" value={discrepancyAssessment} onChange={(event) => setDiscrepancyAssessment(event.target.value as typeof discrepancyAssessment)}><option value="different-criteria">Результаты относятся к разным критериям</option><option value="potential-contradiction">Предполагаемое противоречие</option><option value="insufficient-basis">Оснований недостаточно</option></select></label>
            <label className="text-xs">Положение для связи<select className="mt-1 w-full rounded border bg-background p-2" value={observationPosition} onChange={(event) => setObservationPosition(event.target.value)}><option value="">Выберите положение (необязательно)</option>{positions.map((position) => <option key={position.id} value={position.id}>{position.title}</option>)}</select></label>
            <label className="text-xs sm:col-span-2">Сохранённый критерий Evaluator<Textarea className="mt-1 min-h-16" value={effectiveDiscrepancyCriterion} onChange={(event) => setDiscrepancyCriterion(event.target.value)} /></label>
            <label className="text-xs sm:col-span-2">В чём различаются результаты<Textarea className="mt-1 min-h-16" value={discrepancySummary} onChange={(event) => setDiscrepancySummary(event.target.value)} /></label>
          </div>
          <Button size="sm" variant="outline" disabled={busy || !effectiveDiscrepancyRunIds.executor || !effectiveDiscrepancyRunIds.evaluator || !effectiveDiscrepancyCriterion.trim() || !discrepancySummary.trim()} onClick={() => void createDiscrepancy()}>Сохранить как proposed</Button>
          {discrepancies.map(({ noteId, payload }) => <article id={`research-discrepancy-${noteId}`} key={noteId} className="space-y-1 rounded border border-amber-500/40 p-2 text-xs"><p><b>{payload.assessment}</b> · статус: {payload.status}</p><p>Критерий: {payload.criterion}</p><p>{payload.summary}</p><details><summary className="cursor-pointer">Технические ссылки</summary><p className="mt-1 select-text">Note {noteId} · Run: {payload.runIds.join(', ')} · Observation: {payload.observationIds.join(', ') || 'нет'} · положения: {payload.positionIds.join(', ') || 'не связаны'} · fragments: {payload.fragmentIds.join(', ') || 'нет'}</p></details><p>Пользовательское решение: {payload.userDecision?.decision ?? 'отсутствует'}{payload.userDecision?.note ? ` — ${payload.userDecision.note}` : ''}</p>{payload.decisionHistory?.map((entry, index) => <p key={`${entry.decidedAt}-${index}`}>История: {entry.previousStatus} → {entry.newStatus}; {entry.actorType}; {entry.decidedAt}; основание: {entry.basis}</p>)}{payload.evidence.map((item, index) => <details key={`${item.kind}-${item.id}-${index}`}><summary>{item.label} · {item.kind} · {item.path ?? item.id}</summary><p className="whitespace-pre-wrap">{item.excerpt ?? 'Фрагмент/цитата не сохранены.'}</p></details>)}{payload.status === 'proposed' && <div className="flex flex-wrap gap-2"><Input className="h-8 max-w-md" placeholder="Основание пользовательского решения" value={decisionReason[noteId] ?? ''} onChange={(event) => setDecisionReason((old) => ({ ...old, [noteId]: event.target.value }))} /><Button size="sm" variant="outline" disabled={busy || !decisionReason[noteId]?.trim()} onClick={() => void decideDiscrepancy(noteId, 'confirmed')}>Подтвердить интерпретацию</Button><Button size="sm" variant="outline" disabled={busy || !decisionReason[noteId]?.trim()} onClick={() => void decideDiscrepancy(noteId, 'rejected')}>Отклонить интерпретацию</Button></div>}</article>)}
        </div>
      </section>

    <div hidden={activeTab !== 'positions'} className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{editingId ? 'Правка смыслового положения' : 'Новое смысловое положение'}</h3><span className="text-xs text-muted-foreground">Сохраняется как «предложено»; принятие выполняется отдельно.</span></div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Короткое название" value={draft.title} set={(title) => setDraft((old) => ({ ...old, title }))} />
          <label className="space-y-1 text-xs"><Label>Взять предложение Interpreter</Label><select className="h-9 w-full rounded-md border bg-background px-2" value="" onChange={(event) => loadInterpretation(event.target.value)}><option value="">Выбрать фрагмент и анализ…</option>{interpretations.map((item) => <option key={item.proposalKey} value={item.proposalKey}>{fragments.find((f) => f.id === item.fragmentId)?.path ?? item.fragmentId} · {item.requestedModel ?? 'модель неизвестна'} · {item.interpretation.slice(0, 70)}</option>)}</select></label>
          <Area label="Назначение / интерпретация" value={draft.purpose} set={(purpose) => setDraft((old) => ({ ...old, purpose }))} />
          <Area label="Регулируемое решение" value={draft.regulatedDecision} set={(regulatedDecision) => setDraft((old) => ({ ...old, regulatedDecision }))} />
          <Area label="Условия применения" value={draft.conditions} set={(conditions) => setDraft((old) => ({ ...old, conditions }))} />
          <Area label="Ожидаемое поведение" value={draft.expectedBehavior} set={(expectedBehavior) => setDraft((old) => ({ ...old, expectedBehavior }))} />
          <Area label="Ограничения или неизвестные" value={draft.limitations} set={(limitations) => setDraft((old) => ({ ...old, limitations }))} />
        </div>
        <div className="flex flex-wrap items-end gap-2"><SourcePicker label="Исходный фрагмент" fragments={fragments} selectedIds={fragmentChoice ? [fragmentChoice] : []} onChange={(ids) => setFragmentChoice(ids[0] ?? '')} /><Button size="sm" variant="outline" onClick={addFragment} disabled={!fragmentChoice}><Plus className="mr-1 size-3" />Привязать</Button><Button size="sm" variant="outline" onClick={() => void indexSource()} disabled={busy || !fragmentChoice}>Индексировать исходный текст</Button></div>
        {draft.fragmentIds.length > 0 && <p className="text-xs text-muted-foreground">Источники: {draft.fragmentIds.map((id) => fragments.find((f) => f.id === id)?.path ?? id).join(', ')}</p>}
        <div className="flex gap-2"><Button size="sm" onClick={() => void savePosition()} disabled={busy || !draft.title.trim() || !draft.purpose.trim() || !draft.regulatedDecision.trim() || !draft.conditions.trim() || !draft.expectedBehavior.trim()}>{editingId ? 'Сохранить изменения' : 'Сохранить предложенное положение'}</Button>{editingId && <Button size="sm" variant="outline" onClick={() => { setEditingId(null); setDraft(blankDraft) }}>Отмена правки</Button>}</div>
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-4">
        <h3 className="font-semibold">Привязать наблюдение</h3>
        <p className="text-xs text-muted-foreground">Выберите существующий Run или Note. Создание Finding и изменение истории не выполняются.</p>
        <select className="h-9 w-full rounded-md border bg-background px-2 text-xs" value={observationPosition} onChange={(event) => setObservationPosition(event.target.value)}><option value="">Смысловое положение</option>{positions.map((position) => <option key={position.id} value={position.id}>{position.title}</option>)}</select>
        <select className="h-9 w-full rounded-md border bg-background px-2 text-xs" value={observationSource} onChange={(event) => setObservationSource(event.target.value)}><option value="">Run или Note источника</option>{runs.filter((run) => includeDiagnostics || !hasDiagnosticMarker(run.input, run.output)).map((run) => <option key={run.id} value={`run:${run.id}`}>{run.origin === 'demo' ? '[DEMO] ' : ''}Run · {run.role} · {run.createdAt.slice(0, 10)} · {run.status}</option>)}{notes.filter((note) => includeDiagnostics || !hasDiagnosticMarker(note.body, note.kind, note.origin)).map((note) => <option key={note.id} value={`note:${note.id}`}>Note · {note.kind} · {note.body.slice(0, 80)}</option>)}</select>
        <Area label="Что проверяли и что произошло" value={observationText} set={setObservationText} />
        <Area label="Подтверждающий фрагмент ответа/заметки" value={evidenceText} set={setEvidenceText} />
        <div className="grid gap-2 sm:grid-cols-2"><Area label="Условия" value={observationConditions} set={setObservationConditions} /> <Area label="Критерий" value={criterion} set={setCriterion} /></div>
        <select className="h-9 w-full rounded-md border bg-background px-2 text-xs" value={observationStatus} onChange={(event) => setObservationStatus(event.target.value)}><option value="unverified">Не проверено</option><option value="error">Ошибка ответа</option><option value="suspected">Предположение о проблеме инструкции</option><option value="confirmed-instruction-issue">Подтверждённая проблема инструкции</option><option value="supported">Поддержано имеющимся свидетельством</option><option value="app-or-check-error">Ошибка приложения или проверки</option></select>
        <Button size="sm" disabled={busy || !observationPosition || !observationSource || !observationText.trim()} onClick={() => void saveObservation()}>Сохранить привязку к источнику</Button>
      </section>
    </div>

    <section hidden={activeTab !== 'positions'} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Слои карты · положения ({positions.length})</h3><span className="text-xs text-muted-foreground">Версия фиксирована; связь с похожим текстом не означает эквивалентность.</span></div>
      <div className="flex flex-wrap gap-4 rounded-md border bg-card p-3 text-xs">{([
        ['positions', 'Функциональные положения'], ['sources', 'Исходные фрагменты'], ['relations', 'Направленные связи'], ['observations', 'Наблюдения'],
      ] as const).map(([key, title]) => <label className="flex items-center gap-2" key={key}><input type="checkbox" checked={layers[key]} onChange={(event) => setLayers((old) => ({ ...old, [key]: event.target.checked }))} />{title}</label>)}</div>
      {positions.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Для этой версии положений пока нет. Можно создать вручную или загрузить Interpreter-предложение в черновик.</p> : positions.map((position) => <article id={`research-position-${position.id}`} key={position.id} className="space-y-2 rounded-lg border bg-card p-4">
        <header className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="font-semibold">{position.title}</h4><p className="text-[11px] text-muted-foreground">статус: {position.status} · происхождение: {position.provenance}{position.provenanceRef ? ` · ${position.provenanceRef}` : ''}</p></div><div className="flex flex-wrap gap-1"><Button size="sm" variant="outline" onClick={() => editPosition(position)}><Pencil className="mr-1 size-3" />Исправить</Button><Button size="sm" variant="outline" onClick={() => void indexPosition(position)} disabled={busy}><Sparkles className="mr-1 size-3" />Индексировать все представления</Button>{position.status !== 'accepted' && <Button size="sm" onClick={() => void updateStatus(position, 'accepted')}><Check className="mr-1 size-3" />Принять вручную</Button>}{position.status !== 'disputed' && <Button size="sm" variant="outline" onClick={() => void updateStatus(position, 'disputed')}>Оспорить</Button>}</div></header>
        {(() => { const state = researchState?.positions.find((item) => item.positionId === position.id); if (!state) return null; return <div className="rounded border border-dashed p-2 text-xs"><b>Сквозное состояние положения:</b> interpretation {state.interpretationStatus}; index {state.index.status}{state.index.model ? ` · ${state.index.model}` : ''}; связи proposed/accepted/disputed {state.relations.proposed}/{state.relations.accepted}/{state.relations.disputed}; сценарии {state.scenarioIds.length}; Run {state.runIds.length}; локальные ошибки {state.technicalErrorRunIds.length}; Evaluator {state.evaluations.map((item) => `${item.verdict ?? 'no verdict'} (${item.verdictBy ?? 'источник неизвестен'})`).join(', ') || 'нет'}; Observation {state.observationIds.length}, unverified {state.unverifiedObservationIds.length}; открытые расхождения {state.openDiscrepancyNoteIds.length}.<div className="mt-1 flex flex-wrap gap-1">{state.scenarioIds.map((id) => <Button key={id} size="sm" variant="ghost" onClick={() => openRelated('scenario', id)}>Открыть сценарий {id.slice(0, 10)}…</Button>)}{state.runIds.map((id) => <Button key={id} size="sm" variant="ghost" onClick={() => openRelated('run', id)}>Открыть Run {id.slice(0, 10)}…</Button>)}</div></div> })()}
        {layers.positions && <div className="grid gap-x-4 gap-y-1 text-xs md:grid-cols-2"><p><b>Назначение:</b> {position.purpose}</p><p><b>Решение:</b> {position.regulatedDecision}</p><p><b>Условия:</b> {position.conditions}</p><p><b>Ожидаемое поведение:</b> {position.expectedBehavior}</p>{position.limitations && <p><b>Ограничения:</b> {position.limitations}</p>}</div>}
        {layers.sources && position.fragments.map(({ fragment }) => <details key={fragment.id} className="rounded border p-2 text-xs"><summary className="cursor-pointer">Исходный фрагмент {fragment.path}</summary><p className="mt-2 whitespace-pre-wrap">{fragment.text}</p></details>)}
        {layers.sources && historicalFragmentRefs(position.sourceFragmentRefs).map((ref, index) => <p className="rounded border border-dashed p-2 text-xs text-muted-foreground" key={`${ref.id ?? 'historic'}-${index}`}>Историческая ссылка, без совпадения в этой версии: {ref.path ?? ref.id ?? 'источник неизвестен'}{ref.textHash ? ` · SHA-256 ${ref.textHash}` : ''}</p>)}
        {layers.relations && [...position.outgoingRelations.map((relation) => ({ ...relation, direction: 'исходящая' })), ...position.incomingRelations.map((relation) => ({ ...relation, direction: 'входящая' }))].map((relation) => <div className="flex flex-wrap items-center gap-2 rounded border p-2 text-xs" key={relation.id}><span>Связь ({relation.direction}): {relation.direction === 'исходящая' ? position.title : relation.sourcePosition?.title} → {relation.direction === 'исходящая' ? relation.targetPosition?.title : position.title} · {relation.kind} · {relation.status} · {relation.rationale} · источник: {relation.provenance}</span>{relation.status !== 'accepted' && <Button size="sm" variant="outline" onClick={() => void updateRelationStatus(relation, 'accepted')}>Принять связь</Button>}{relation.status !== 'disputed' && <Button size="sm" variant="outline" onClick={() => void updateRelationStatus(relation, 'disputed')}>Оспорить связь</Button>}</div>)}
        {layers.observations && position.observations.map((observation) => <div id={`research-observation-${observation.id}`} key={observation.id} className="rounded border border-muted p-2 text-xs"><b>Наблюдение — {observation.status}:</b> {observation.observation}<p>Источник: {observation.run ? `Run ${observation.run.role} ${observation.run.status}` : `Note ${observation.note?.kind ?? ''}`}. Критерий: {observation.criterion || 'не указан'}.</p>{observation.evidenceText && <p>Свидетельство: {observation.evidenceText}</p>}</div>)}
      </article>)}
    </section>
    {message && <p role="status" className="rounded-md border bg-muted/40 p-3 text-xs">{message}</p>}
  </div>
}

function SourcePicker({ label, fragments, selectedIds, onChange, multiple = false }: { label: string; fragments: FragmentDTO[]; selectedIds: string[]; onChange: (ids: string[]) => void; multiple?: boolean }) {
  const [query, setQuery] = React.useState('')
  const [section, setSection] = React.useState('all')
  const [page, setPage] = React.useState(0)
  const sections = [...new Set(fragments.map((fragment) => fragment.path.split('.')[0]).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const filtered = fragments.filter((fragment) => {
    const sectionMatches = section === 'all' || fragment.path === section || fragment.path.startsWith(`${section}.`)
    const textMatches = !query.trim() || `${fragment.path} ${fragment.title ?? ''} ${fragment.text}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    return sectionMatches && textMatches
  })
  const pageSize = 50
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const visible = filtered.slice(page * pageSize, (page + 1) * pageSize)
  const selected = fragments.filter((fragment) => selectedIds.includes(fragment.id))
  const toggle = (id: string) => onChange(multiple ? selectedIds.includes(id) ? selectedIds.filter((selectedId) => selectedId !== id) : [...selectedIds, id] : selectedIds.includes(id) ? [] : [id])
  return <div className="min-w-64 flex-1 space-y-2 text-xs">
    <span className="font-medium">{label}</span>
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]"><Input className="h-8" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} placeholder="Найти по тексту или пути" aria-label={`${label}: поиск`} /><select className="h-8 rounded border bg-background px-2" value={section} onChange={(event) => { setSection(event.target.value); setPage(0) }} aria-label={`${label}: раздел`}><option value="all">Все разделы</option>{sections.map((item) => <option key={item} value={item}>Раздел {item}</option>)}</select></div>
    <div className="max-h-40 space-y-1 overflow-y-auto rounded border p-1" role={multiple ? 'group' : 'listbox'} aria-label={`${label}: результаты`}>
      {visible.map((fragment) => <button key={fragment.id} type="button" aria-pressed={selectedIds.includes(fragment.id)} className={`block w-full rounded px-2 py-1 text-left hover:bg-muted/60 ${selectedIds.includes(fragment.id) ? 'bg-muted font-medium' : ''}`} onClick={() => toggle(fragment.id)}><span className="font-mono">{fragment.path}</span><span className="ml-2">{fragment.title ?? fragment.text.slice(0, 110)}</span></button>)}
      {!visible.length && <p className="p-2 text-muted-foreground">Фрагменты не найдены.</p>}
    </div>
    <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Показано {visible.length} из {filtered.length}; страница {page + 1}/{pageCount}. Выбрано: {selected.length}.</span><span className="flex gap-1"><Button type="button" size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Назад</Button><Button type="button" size="sm" variant="ghost" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>Далее</Button></span></div>
    {selected.length > 0 && <div className="flex flex-wrap gap-1" aria-label="Выбранные фрагменты">{selected.slice(0, 8).map((fragment) => <button key={fragment.id} type="button" className="rounded bg-muted px-2 py-1" title={fragment.text} onClick={() => toggle(fragment.id)}>{fragment.path} ×</button>)}{selected.length > 8 && <span className="self-center text-muted-foreground">и ещё {selected.length - 8}</span>}</div>}
  </div>
}

function Field({ label, value, set }: { label: string; value: string; set: (value: string) => void }) {
  return <label className="space-y-1 text-xs"><Label>{label}</Label><Input value={value} onChange={(event) => set(event.target.value)} /></label>
}
function Area({ label, value, set, disabled = false }: { label: string; value: string; set: (value: string) => void; disabled?: boolean }) {
  return <label className="space-y-1 text-xs"><Label>{label}</Label><Textarea className="min-h-20" value={value} onChange={(event) => set(event.target.value)} disabled={disabled} /></label>
}

function historicalFragmentRefs(value?: string) {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is { id?: string; path?: string; textHash?: string } => Boolean(item && typeof item === 'object')) : []
  } catch { return [] }
}
