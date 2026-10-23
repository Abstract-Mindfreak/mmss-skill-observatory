import { db } from '@/lib/db'
import { activeRunIds } from '@/lib/run-registry'
import { activeModelOperationIds } from '@/lib/model-operation-registry'
import { contourOperationIsActive } from '@/lib/contour-operations'
import { safeParse } from '@/lib/serialize'

export type ProcessStatus = 'active' | 'waiting' | 'paused' | 'blocked' | 'needs-reconciliation' | 'completed' | 'stopped' | 'failed' | 'prepared'
export type ProcessType = 'campaign' | 'run' | 'assistant-call' | 'interpreter-operation' | 'explorer-operation' | 'contour' | 'analysis'
export type ProcessChild = { id: string; type: string; title: string; status: ProcessStatus; role?: string | null; runId?: string | null; modelCallId?: string | null; route?: string | null; error?: string | null; createdAt?: string; updatedAt?: string; children?: ProcessChild[] }
export type ProcessEntry = {
  id: string; type: ProcessType; title: string; status: ProcessStatus; projectId: string; projectName: string; versionId: string | null; versionLabel: string | null;
  direction: string; stage: string; createdAt: string; updatedAt: string; progress: string | null; waitingReason: string | null;
  route: string | null; routeLabel?: string | null; runId?: string | null; campaignId?: string | null; analysisId?: string | null; modelCallId?: string | null;
  controls: string[]; error: string | null; rawError: string | null; children: ProcessChild[]; predecessorCampaignId?: string | null; archived?: boolean
}

const iso = (date: Date) => date.toISOString()
const jsonObject = (value: string | null | undefined) => safeParse<Record<string, unknown>>(value ?? '{}', {})
const statusOfRun = (status: string, live: boolean): ProcessStatus => status === 'running' ? live ? 'active' : 'needs-reconciliation' : status === 'queued' || status === 'planned' ? 'waiting' : status === 'completed' ? 'completed' : status === 'cancelled' ? 'stopped' : 'failed'

export async function listProcesses(input: { projectId?: string | null; allProjects?: boolean }) {
  const projectWhere = input.allProjects ? {} : input.projectId ? { projectId: input.projectId } : null
  if (!projectWhere) throw new Error('Укажите проект или включите режим всех проектов.')
  const projects = await db.project.findMany({ where: input.allProjects ? {} : { id: input.projectId! }, select: { id: true, name: true } })
  const projectNames = new Map(projects.map((project) => [project.id, project.name]))
  const where = input.allProjects ? {} : { projectId: input.projectId! }
  const [campaigns, runs, modelCalls, analyses] = await Promise.all([
    db.researchCampaign.findMany({ where, include: { project: { select: { name: true } }, version: { select: { label: true } }, items: { orderBy: { order: 'asc' }, include: { position: { select: { id: true, title: true } }, actions: { orderBy: { createdAt: 'asc' }, include: { run: { select: { id: true, status: true, role: true, backend: true, connectionName: true, model: true, versionId: true, scenarioId: true, error: true, createdAt: true, updatedAt: true } } } } } }, roles: true }, orderBy: { updatedAt: 'desc' }, take: 100 }),
    db.run.findMany({ where, orderBy: { createdAt: 'desc' }, take: 250 }),
    db.modelCall.findMany({ where, orderBy: { createdAt: 'desc' }, take: 350 }),
    db.analysis.findMany({ where: { ...where, type: { in: ['functional-semantic-contour', 'model-interpret'] } }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ])
  const liveRuns = new Set(activeRunIds()), liveCalls = new Set(activeModelOperationIds())
  const callsByRun = new Map<string, typeof modelCalls>()
  for (const call of modelCalls) if (call.runId) callsByRun.set(call.runId, [...(callsByRun.get(call.runId) ?? []), call])
  const processRows: ProcessEntry[] = []
  const childCall = (call: (typeof modelCalls)[number]): ProcessChild => ({ id: call.id, type: 'model-call', title: `${call.role} · ${call.action}`, status: call.status === 'running' ? liveCalls.has(call.id) ? 'active' : 'needs-reconciliation' : call.status === 'completed' ? 'completed' : call.status === 'cancelled' ? 'stopped' : 'failed', role: call.role, modelCallId: call.id, route: call.actualProvider || call.actualModel ? `Фактически: ${call.actualProvider ?? 'провайдер неизвестен'} / ${call.actualModel ?? call.requestedModel ?? 'модель неизвестна'}` : `Запрошено: ${call.backend} · ${call.connectionName ?? 'подключение неизвестно'} · ${call.requestedModel ?? 'модель неизвестна'}`, createdAt: iso(call.createdAt), updatedAt: iso(call.createdAt) })
  const runChild = (run: { id: string; status: string; role: string; backend: string; connectionName: string | null; model: string | null; versionId: string | null; scenarioId: string | null; error: string | null; createdAt: Date; updatedAt: Date }, label?: string): ProcessChild => {
    const nestedCalls = callsByRun.get(run.id) ?? []
    return { id: run.id, type: 'run', title: label ?? `${run.role} · ${run.status}`, status: statusOfRun(run.status, liveRuns.has(run.id)), role: run.role, runId: run.id, route: nestedCalls[0]?.actualProvider || nestedCalls[0]?.actualModel ? `Фактически: ${nestedCalls[0].actualProvider ?? 'провайдер неизвестен'} / ${nestedCalls[0].actualModel ?? nestedCalls[0].requestedModel ?? 'модель неизвестна'}` : `Запрошено: ${run.backend} · ${run.connectionName ?? 'подключение неизвестно'} · ${run.model ?? 'модель неизвестна'}`, error: run.error, createdAt: iso(run.createdAt), updatedAt: iso(run.updatedAt), children: nestedCalls.map(childCall) }
  }

  for (const campaign of campaigns) {
    const actions = campaign.items.flatMap((item) => item.actions.map((action) => {
      const run = action.run
      const status: ProcessStatus = action.status === 'running' ? run ? statusOfRun(run.status, liveRuns.has(run.id)) : 'needs-reconciliation' : action.status === 'planned' ? 'waiting' : action.status === 'completed' ? 'completed' : action.status === 'cancelled' ? 'stopped' : action.status === 'blocked' ? 'blocked' : 'failed'
      const runNode = run ? runChild(run) : null
      return { id: action.id, type: 'campaign-action', title: `${action.role} · ${action.actionType} · ${item.position.title}`, status, role: action.role, runId: run?.id ?? null, route: run ? `${run.backend} · ${run.connectionName ?? 'подключение неизвестно'} · ${run.model ?? 'модель неизвестна'}` : null, error: action.error ?? run?.error ?? null, createdAt: iso(action.createdAt), updatedAt: iso(action.updatedAt), children: runNode ? [runNode] : [] } satisfies ProcessChild
    }))
    const childActive = actions.some((action) => action.status === 'active')
    const childNeedsReview = actions.some((action) => action.status === 'needs-reconciliation')
    let status: ProcessStatus = campaign.status === 'running' ? childNeedsReview ? 'needs-reconciliation' : childActive || (campaign.workerLeaseUntil && campaign.workerLeaseUntil > new Date()) ? 'active' : 'waiting' : campaign.status === 'prepared' ? 'prepared' : campaign.status === 'paused' ? 'paused' : campaign.status === 'blocked' ? 'blocked' : campaign.status === 'completed' ? 'completed' : campaign.status === 'cancelled' ? 'stopped' : 'failed'
    const positions = campaign.items.map((item) => item.position.title)
    const completedPositions = campaign.items.filter((item) => item.status === 'completed' || item.status === 'blocked').length
    processRows.push({ id: `campaign:${campaign.id}`, type: 'campaign', title: `Исследовательская кампания · ${positions.slice(0, 2).join(', ') || campaign.scopeType}`, status, projectId: campaign.projectId, projectName: campaign.project.name, versionId: campaign.versionId, versionLabel: campaign.version.label, direction: positions.join(' · ') || campaign.scopeType, stage: campaign.stage, createdAt: iso(campaign.createdAt), updatedAt: iso(campaign.updatedAt), progress: `${completedPositions}/${campaign.items.length} положений · ${campaign.modelActionsUsed}${campaign.maxModelActions == null ? ' действий' : `/${campaign.maxModelActions} действий`}`, waitingReason: status === 'needs-reconciliation' ? 'Статус Run остаётся running, но активный локальный владелец не найден. Результат провайдера неизвестен.' : campaign.pauseReason ?? null, route: campaign.roles.map((role) => `${role.role}: ${role.backend} / ${role.connectionName} / ${role.model}`).join('; '), routeLabel: 'Снимки назначений ролей', campaignId: campaign.id, predecessorCampaignId: campaign.predecessorCampaignId, controls: status === 'active' ? ['pause', 'stop'] : status === 'waiting' ? ['continue', 'pause', 'stop'] : status === 'needs-reconciliation' ? ['reconcile'] : status === 'prepared' ? ['continue'] : status === 'paused' ? ['continue', 'restart'] : status === 'completed' || status === 'stopped' || status === 'failed' || status === 'blocked' ? ['restart'] : [], error: campaign.lastError, rawError: campaign.lastError, children: actions })
  }

  const analysisRunIds = new Set<string>(), analysisCallIds = new Set<string>()
  for (const analysis of analyses) {
    const projectName = projectNames.get(analysis.projectId) ?? 'Проект недоступен'
    const data = jsonObject(analysis.result)
    const state = data as Record<string, unknown>
    const contour = analysis.type === 'functional-semantic-contour'
    const children: ProcessChild[] = []
    let direction = 'Интерпретация фрагментов'
    let stage = analysis.type
    let progress: string | null = null
    let status: ProcessStatus = analysis.status === 'completed' ? 'completed' : analysis.status === 'failed' ? 'failed' : 'needs-reconciliation'
    let error = analysis.error
    if (contour) {
      const blocks = Array.isArray(state.blocks) ? state.blocks as Record<string, unknown>[] : []
      const validation = state.validation && typeof state.validation === 'object' ? state.validation as Record<string, unknown> : {}
      const validationItems = Array.isArray(validation.items) ? validation.items as Record<string, unknown>[] : []
      const runningBlock = blocks.some((block) => block.status === 'running')
      const active = contourOperationIsActive(analysis.id)
      status = state.status === 'completed' ? 'completed' : state.status === 'cancelled' ? 'stopped' : state.status === 'failed' ? 'failed' : state.status === 'paused' ? 'paused' : active ? 'active' : runningBlock ? 'needs-reconciliation' : 'waiting'
      direction = typeof data.operationId === 'string' ? `Contour ${String(state.stage ?? '')}` : 'Contour'
      stage = String(state.stage ?? analysis.type)
      const done = blocks.filter((block) => block.status === 'completed').length
      progress = blocks.length ? `${done}/${blocks.length} блоков` : null
      for (const block of blocks) {
        const callId = typeof block.modelCallId === 'string' ? block.modelCallId : null
        if (callId) analysisCallIds.add(callId)
        children.push({ id: String(block.id ?? `block:${children.length}`), type: 'contour-block', title: String(block.sectionPath ?? block.id ?? 'Блок обработки'), status: block.status === 'completed' ? 'completed' : block.status === 'running' ? active ? 'active' : 'needs-reconciliation' : block.status === 'error' ? 'failed' : 'waiting', modelCallId: callId, error: typeof block.error === 'string' ? block.error : null })
      }
      for (const item of validationItems) for (const runId of [item.executorRunId, item.evaluatorRunId]) if (typeof runId === 'string') { analysisRunIds.add(runId); children.push({ id: `validation:${runId}`, type: 'run-reference', title: `VALIDATION · ${String(item.status ?? '')}`, status: item.status === 'error' ? 'failed' : item.status === 'evaluator-done' ? 'completed' : item.status === 'executor-running' ? 'active' : 'waiting', runId }) }
      const index = state.indexState && typeof state.indexState === 'object' ? state.indexState as Record<string, unknown> : null
      if (index) {
        const entries = Array.isArray(index.entries) ? index.entries : []
        progress = `${String(index.next ?? 0)}/${entries.length} embedding-записей`
        if (index.status === 'running') children.push({ id: `${analysis.id}:index`, type: 'embedding-index', title: 'Пакет индексации embedding', status: 'waiting', error: typeof index.error === 'string' ? index.error : null })
      }
      const diagnostics = state.diagnostics && typeof state.diagnostics === 'object' ? state.diagnostics as Record<string, unknown> : {}
      error = typeof diagnostics.lastError === 'string' ? diagnostics.lastError : error
    } else {
      const items = Array.isArray(data.items) ? data.items as Record<string, unknown>[] : []
      direction = `Интерпретация ${items.length} фрагментов`
      const calls = items.map((item) => typeof item.modelCallId === 'string' ? item.modelCallId : null).filter((id): id is string => Boolean(id))
      for (const callId of calls) analysisCallIds.add(callId)
      children.push(...calls.map((callId) => ({ id: callId, type: 'model-call', title: 'Interpreter · Fragment', status: 'completed' as ProcessStatus, modelCallId: callId })))
      progress = `${items.filter((item) => !item.error).length}/${items.length} фрагментов без ошибки`
    }
    const analysisVersion = await db.documentVersion.findFirst({ where: { id: analysis.versionId, projectId: analysis.projectId }, select: { label: true } })
    processRows.push({ id: `analysis:${analysis.id}`, type: contour ? 'contour' : 'interpreter-operation', title: contour ? 'Пакетная обработка contour' : 'Интерпретация Atlas · Interpreter', status, projectId: analysis.projectId, projectName, versionId: analysis.versionId, versionLabel: analysisVersion?.label ?? null, direction, stage, createdAt: iso(analysis.createdAt), updatedAt: iso(analysis.createdAt), progress, waitingReason: status === 'needs-reconciliation' ? 'После перезапуска S2 нет подтверждённого владельца шага. Нужна явная сверка.' : status === 'waiting' ? 'Следующий блок запускается отдельным явным действием в Atlas.' : null, route: `${analysis.backend} · ${analysis.model ?? 'модель неизвестна'}`, routeLabel: 'Сохранённое назначение операции', analysisId: analysis.id, controls: status === 'active' ? ['stop'] : status === 'needs-reconciliation' ? ['reconcile'] : [], error, rawError: error, children })
  }

  const runRows = runs.filter((run) => !run.campaignActionId && !analysisRunIds.has(run.id))
  const runMap = new Map(runRows.map((run) => [run.id, run]))
  const childIds = new Set(runRows.map((run) => run.parentRunId).filter((id): id is string => Boolean(id)))
  for (const run of runRows) {
    if (childIds.has(run.id) || (run.parentRunId && runMap.has(run.parentRunId))) continue
    const children = runRows.filter((child) => child.parentRunId === run.id).map((child) => runChild(child))
    const calls = callsByRun.get(run.id) ?? []
    const actualCall = calls.find((call) => call.actualProvider || call.actualModel)
    processRows.push({ id: `run:${run.id}`, type: 'run', title: `${run.role} · ${run.status}`, status: statusOfRun(run.status, liveRuns.has(run.id)), projectId: run.projectId, projectName: projectNames.get(run.projectId) ?? 'Проект недоступен', versionId: run.versionId, versionLabel: null, direction: run.scenarioId ? `Scenario ${run.scenarioId}` : run.versionId ? 'Версия документа' : 'Ролевой запуск', stage: run.status, createdAt: iso(run.createdAt), updatedAt: iso(run.updatedAt), progress: null, waitingReason: run.status === 'running' && !liveRuns.has(run.id) ? 'Run хранится как running, но локальный исполнитель не зарегистрирован; внешний итог неизвестен.' : null, route: actualCall ? `${actualCall.actualProvider ?? 'провайдер неизвестен'} / ${actualCall.actualModel ?? actualCall.requestedModel ?? 'модель неизвестна'}` : `${run.backend} · ${run.connectionName ?? 'подключение неизвестно'} · ${run.model ?? 'модель неизвестна'}`, routeLabel: actualCall ? 'Фактический provider/model по ModelCall' : 'Запрошенное подключение и модель', runId: run.id, controls: run.status === 'running' ? liveRuns.has(run.id) ? ['stop'] : ['reconcile'] : run.status === 'failed' ? ['retry'] : [], error: run.error, rawError: run.error, children: [...children, ...calls.map((call) => childCall(call))] })
  }

  const directCalls = modelCalls.filter((call) => !call.runId && !analysisCallIds.has(call.id))
  for (const call of directCalls) {
    const active = call.status === 'running' && liveCalls.has(call.id)
    const status: ProcessStatus = call.status === 'running' ? active ? 'active' : 'needs-reconciliation' : call.status === 'completed' ? 'completed' : call.status === 'cancelled' ? 'stopped' : 'failed'
    const type: ProcessType = call.role === 'assistant' ? 'assistant-call' : call.role === 'explorer' ? 'explorer-operation' : call.role === 'interpreter' ? 'interpreter-operation' : 'analysis'
    const hasActualRoute = Boolean(call.actualProvider || call.actualModel)
    processRows.push({ id: `model-call:${call.id}`, type, title: call.role === 'assistant' ? 'Помощник · ответ в чате' : `${call.role} · ${call.action}`, status, projectId: call.projectId, projectName: projectNames.get(call.projectId) ?? 'Проект недоступен', versionId: call.versionId, versionLabel: null, direction: call.action, stage: call.status, createdAt: iso(call.createdAt), updatedAt: iso(call.createdAt), progress: null, waitingReason: status === 'needs-reconciliation' ? 'Вызов сохранён как running, активного локального владельца нет. Фактический ответ провайдера неизвестен.' : null, route: hasActualRoute ? `${call.actualProvider ?? 'провайдер неизвестен'} / ${call.actualModel ?? call.requestedModel ?? 'модель неизвестна'}` : `${call.backend} · ${call.connectionName ?? 'подключение неизвестно'} · ${call.requestedModel ?? 'модель неизвестна'}`, routeLabel: hasActualRoute ? 'Фактический provider/model' : 'Запрошенное подключение и модель', modelCallId: call.id, controls: status === 'active' ? ['stop'] : status === 'needs-reconciliation' ? ['reconcile'] : [], error: status === 'failed' ? 'ModelCall завершился с ошибкой; подробность см. в technical metadata.' : null, rawError: null, children: [] })
  }

  processRows.sort((a, b) => {
    const priority = (status: ProcessStatus) => status === 'active' ? 0 : status === 'needs-reconciliation' ? 1 : status === 'waiting' ? 2 : status === 'paused' ? 3 : status === 'blocked' ? 4 : 5
    return priority(a.status) - priority(b.status) || b.updatedAt.localeCompare(a.updatedAt)
  })
  return processRows
}
