import type { NextResearchActionDTO, ResearchPositionStateDTO, ResearchStateDTO } from '@/lib/types'
import type { ResearchDiscrepancy } from '@/lib/research-discrepancy'

type PositionRow = { id: string; title: string; status: string; fragmentIds: string[] }
type RelationRow = { id: string; sourcePositionId: string; targetPositionId: string; status: string }
type ScenarioRow = { id: string; title: string; status: string; origin: string; fragmentId: string | null }
type RunRow = { id: string; role: string; status: string; scenarioId: string | null; parentRunId: string | null; verdict: string | null; verdictBy: string | null; programChecks: { passed: boolean; status?: string }[] }
type ObservationRow = { id: string; positionId: string; runId: string | null; status: string }
type VectorRow = { representation: string; positionId: string | null; status: string; model: string }
type FindingRow = { status: string }

export function buildResearchState(input: {
  projectId: string; versionId: string; positions: PositionRow[]; relations: RelationRow[]; scenarios: ScenarioRow[]
  runs: RunRow[]; observations: ObservationRow[]; vectors: VectorRow[]; findings: FindingRow[]; discrepancies: { noteId: string; payload: ResearchDiscrepancy }[]
  contourCoverage?: Record<string, number> | null
}): ResearchStateDTO {
  const positionIds = new Set(input.positions.map((position) => position.id))
  const scenarioById = new Map(input.scenarios.map((scenario) => [scenario.id, scenario]))
  const runsById = new Map(input.runs.map((run) => [run.id, run]))
  const fragmentToPositions = new Map<string, Set<string>>()
  for (const position of input.positions) for (const fragmentId of position.fragmentIds) {
    const current = fragmentToPositions.get(fragmentId) ?? new Set<string>()
    current.add(position.id); fragmentToPositions.set(fragmentId, current)
  }
  const scenarioPositions = new Map<string, Set<string>>()
  for (const scenario of input.scenarios) {
    if (!scenario.fragmentId) continue
    for (const positionId of fragmentToPositions.get(scenario.fragmentId) ?? []) {
      const current = scenarioPositions.get(positionId) ?? new Set<string>()
      current.add(scenario.id); scenarioPositions.set(positionId, current)
    }
  }
  const runPositions = new Map<string, Set<string>>()
  for (const run of input.runs) {
    const scenario = run.scenarioId ? scenarioById.get(run.scenarioId) : undefined
    if (!scenario?.fragmentId) continue
    for (const positionId of fragmentToPositions.get(scenario.fragmentId) ?? []) {
      const current = runPositions.get(positionId) ?? new Set<string>()
      current.add(run.id); runPositions.set(positionId, current)
    }
  }
  const observationByPosition = new Map<string, ObservationRow[]>()
  for (const observation of input.observations) if (positionIds.has(observation.positionId)) {
    const current = observationByPosition.get(observation.positionId) ?? []
    current.push(observation); observationByPosition.set(observation.positionId, current)
  }

  const positionStates: ResearchPositionStateDTO[] = input.positions.map((position) => {
    const relatedRelations = input.relations.filter((relation) => relation.sourcePositionId === position.id || relation.targetPositionId === position.id)
    const scenarioIds = [...(scenarioPositions.get(position.id) ?? [])]
    const runIds = [...(runPositions.get(position.id) ?? [])]
    const observations = observationByPosition.get(position.id) ?? []
    const evaluatorRunIds = input.runs.filter((run) => run.role === 'evaluator' && run.parentRunId && runIds.includes(run.parentRunId)).map((run) => run.id)
    const linkedDiscrepancies = input.discrepancies.filter(({ payload }) => payload.positionIds.includes(position.id))
    const vector = input.vectors.find((row) => row.representation === 'functional' && row.positionId === position.id)
    const indexStatus: ResearchPositionStateDTO['index'] = !vector ? { status: 'missing' } : vector.status === 'ready' ? { status: 'ready', model: vector.model } : vector.status === 'stale' ? { status: 'stale', model: vector.model } : { status: 'failed', model: vector.model }
    const recommendations: NextResearchActionDTO[] = []
    if (scenarioIds.length === 0) recommendations.push({ key: `scenario:${position.id}`, gap: 'Для положения не найден сценарий', linkedIds: [position.id], action: 'Подготовить сценарий вручную', rationale: 'Положение пока не связано со сценарием по исходному Fragment.', limitations: ['Создание сценария не запускает его.'], target: { kind: 'position', id: position.id } })
    else if (runIds.length === 0) recommendations.push({ key: `run:${position.id}`, gap: 'Есть сценарий, но нет Run', linkedIds: [position.id, ...scenarioIds], action: 'Рассмотреть запуск выбранного сценария', rationale: 'Сценарий не имеет сохранённых попыток исполнения.', limitations: ['Запуск требует отдельного действия пользователя и доступного подключения.'], target: { kind: 'scenario', id: scenarioIds[0] } })
    else if (evaluatorRunIds.length === 0 && input.runs.some((run) => runIds.includes(run.id) && run.status === 'completed')) recommendations.push({ key: `evaluation:${position.id}`, gap: 'Есть завершённый ответ без связанной оценки', linkedIds: [...runIds], action: 'Рассмотреть оценку существующего Run', rationale: 'Найден завершённый Run, но не найден дочерний Evaluator Run.', limitations: ['Оценка может быть недоступна для некоторых ролей/входов.'], target: { kind: 'run', id: runIds[0] } })
    if (observations.some((observation) => observation.status === 'unverified')) { const observationId = observations.find((observation) => observation.status === 'unverified')!.id; recommendations.push({ key: `observation:${position.id}`, gap: 'Есть неподтверждённое наблюдение', linkedIds: observations.filter((observation) => observation.status === 'unverified').map((observation) => observation.id), action: 'Проверить основание наблюдения', rationale: 'Сохранённое Observation имеет статус unverified.', limitations: ['Не менять статус без исследовательского или пользовательского решения.'], target: { kind: 'observation', id: observationId } }) }
    if (linkedDiscrepancies.some(({ payload }) => payload.status === 'proposed')) { const discrepancyId = linkedDiscrepancies.find(({ payload }) => payload.status === 'proposed')!.noteId; recommendations.push({ key: `discrepancy:${position.id}`, gap: 'Открыто предложенное расхождение', linkedIds: linkedDiscrepancies.filter(({ payload }) => payload.status === 'proposed').map(({ noteId }) => noteId), action: 'Рассмотреть расхождение между сохранёнными оценками', rationale: 'Evaluator verdict и Observation имеют разные основания/статусы; обе записи сохранены отдельно. Рекомендация предлагает рассмотреть свидетельства и не выбирает заранее одну сторону.', limitations: ['Не считать verdict ошибочным до проверки исходного критерия и свидетельств.'], target: { kind: 'discrepancy', id: discrepancyId } }) }
    if (indexStatus.status === 'failed' || indexStatus.status === 'stale') recommendations.push({ key: `index:${position.id}`, gap: `Индекс положения ${indexStatus.status === 'failed' ? 'содержит ошибку' : 'устарел'}`, linkedIds: [position.id], action: 'Проверить индекс для выбранной записи', rationale: 'Состояние индекса не ready.', limitations: ['Не запускается автоматическая переиндексация.'], target: { kind: 'index', id: position.id } })
    return {
      positionId: position.id, title: position.title, interpretationStatus: position.status, index: indexStatus,
      relations: { proposed: relatedRelations.filter((row) => row.status === 'proposed').length, accepted: relatedRelations.filter((row) => row.status === 'accepted').length, disputed: relatedRelations.filter((row) => row.status === 'disputed').length },
      scenarioIds, runIds, technicalErrorRunIds: runIds.filter((id) => { const run = runsById.get(id); return run?.status === 'failed' || run?.programChecks.some((check) => !check.passed || check.status === 'unverified') }),
      evaluatorRunIds, observationIds: observations.map((row) => row.id), unverifiedObservationIds: observations.filter((row) => row.status === 'unverified').map((row) => row.id),
      evaluations: input.runs.filter((run) => run.role === 'evaluator' && run.parentRunId && runIds.includes(run.parentRunId)).map((run) => ({ runId: run.id, runStatus: run.status, verdict: run.verdict, verdictBy: run.verdictBy })),
      openDiscrepancyNoteIds: linkedDiscrepancies.filter(({ payload }) => payload.status === 'proposed').map(({ noteId }) => noteId), recommendations,
    }
  })
  const scenarios = input.scenarios.filter((scenario) => scenario.origin !== 'demo')
  const realRuns = input.runs.filter((run) => run.role !== 'embedding')
  const allRecommendations = positionStates.flatMap((position) => position.recommendations)
  const functionalVectors = input.vectors.filter((vector) => vector.representation === 'functional')
  const vectorState = (status: string) => functionalVectors.filter((vector) => vector.status === status).length
  const indexedPositionIds = new Set(functionalVectors.map((vector) => vector.positionId).filter((id): id is string => Boolean(id)))
  const allDiscrepancies = input.discrepancies.map(({ payload }) => payload)
  const evaluators = realRuns.filter((row) => row.role === 'evaluator')
  const linkedRunIds = new Set(positionStates.flatMap((row) => row.runIds))
  const technicalErrors = input.runs.filter((run) => run.status === 'failed' || (linkedRunIds.has(run.id) && run.programChecks.some((check) => !check.passed || check.status === 'unverified')))
  return {
    projectId: input.projectId, versionId: input.versionId, scope: 'version',
    interpretations: { total: input.positions.length, proposed: input.positions.filter((row) => row.status === 'proposed').length, accepted: input.positions.filter((row) => row.status === 'accepted').length, disputed: input.positions.filter((row) => row.status === 'disputed').length },
    index: { ready: vectorState('ready'), stale: vectorState('stale'), failed: vectorState('failed'), missing: Math.max(0, input.positions.length - indexedPositionIds.size) },
    relations: { proposed: input.relations.filter((row) => row.status === 'proposed').length, accepted: input.relations.filter((row) => row.status === 'accepted').length, disputed: input.relations.filter((row) => row.status === 'disputed').length },
    scenarios: { total: scenarios.length, unexplored: scenarios.filter((row) => row.status === 'unexplored').length, explored: scenarios.filter((row) => row.status === 'explored').length, runVerified: scenarios.filter((row) => row.status === 'run-verified').length, byKind: countScenarioKinds(scenarios) },
    runs: { attempts: realRuns.length, completed: realRuns.filter((row) => row.status === 'completed').length, failed: realRuns.filter((row) => row.status === 'failed').length, cancelled: realRuns.filter((row) => row.status === 'cancelled').length, technicalErrors: technicalErrors.length, evaluations: evaluators.length, evaluationVerdicts: evaluators.reduce<Record<string, number>>((counts, run) => { const key = run.verdict ?? 'no-verdict'; counts[key] = (counts[key] ?? 0) + 1; return counts }, {}), localCheckFailures: input.runs.reduce((sum, run) => sum + run.programChecks.filter((check) => !check.passed && check.status !== 'unverified').length, 0), localChecksUnverified: input.runs.reduce((sum, run) => sum + run.programChecks.filter((check) => check.status === 'unverified').length, 0) },
    observations: { total: input.observations.length, unverified: input.observations.filter((row) => row.status === 'unverified').length, other: input.observations.filter((row) => row.status !== 'unverified').length },
    discrepancies: { open: allDiscrepancies.filter((row) => row.status === 'proposed').length, accepted: allDiscrepancies.filter((row) => row.status === 'accepted').length, disputed: allDiscrepancies.filter((row) => row.status === 'disputed').length },
    findings: { total: input.findings.length, hypotheses: input.findings.filter((row) => row.status === 'hypothesis').length, supported: input.findings.filter((row) => row.status === 'supported').length, disputed: input.findings.filter((row) => row.status === 'disputed').length, rejected: input.findings.filter((row) => row.status === 'rejected').length },
    unverifiedConclusions: { proposedPositions: input.positions.filter((row) => row.status === 'proposed').length, unverifiedObservations: input.observations.filter((row) => row.status === 'unverified').length },
    gaps: { unrepresentedFragmentCount: null, contourCoverage: input.contourCoverage ?? null }, positions: positionStates, recommendations: allRecommendations,
    limitations: ['Сводка ограничена выбранными проектом и версией.', 'Связь Run с положением выводится через Scenario.fragmentId и source Fragment; прямое отношение не предполагается.', 'Техническая ошибка, локальная проверка, модельная оценка, Observation и пользовательское решение показываются раздельно.', 'Наличие локального пробела не доказывает отсутствие материала вне проекта.'],
  }
}

function countScenarioKinds(scenarios: ScenarioRow[]) {
  const counts: Record<string, number> = {}
  for (const scenario of scenarios) {
    const title = scenario.title.trim()
    const marker = /^\[(SMOKE|DIAGNOSTIC|VALIDATION)\]/i.exec(title)?.[1]?.toUpperCase() ?? 'unmarked'
    counts[marker] = (counts[marker] ?? 0) + 1
  }
  return counts
}
