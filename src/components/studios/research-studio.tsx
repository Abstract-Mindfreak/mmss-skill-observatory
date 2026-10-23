'use client'

import * as React from 'react'
import { ArrowLeft, ArrowRight, BookOpen, ChevronRight, FlaskConical, GitBranch, RefreshCw, Search, Settings2, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState, ErrorState } from '@/components/shared/states'
import { ObjectTypeBadge, StatusBadge } from '@/components/shared/semantic-badge'
import { activeVersion, useStore, type StudioId } from '@/lib/store'
import type { ResearchStateDTO, AssignmentDTO, RoleId } from '@/lib/types'
import { campaignRequiredStages, campaignResumeBlock, classifyResearchStop, requiredStagesCompletion, type ResearchStopCause } from '@/lib/research-ui-state'

type PreviewPosition = { id: string; title: string; status: string; sourceCount: number; paths: string[] }
type CampaignPreview = { projectId: string; versionId: string; versionLabel: string; contentHash: string; sections: string[]; positions: PreviewPosition[] }
type ActionRow = {
  id: string; actionType: string; role: string; attempt: number; status: string; error: string | null
  sources: { fragmentId: string }[]
  run: null | { id: string; status: string; role: string; verdict: string | null; backend: string | null; connectionName: string | null; model: string | null; actualProvider: string | null; actualModel: string | null; modelCallId: string | null; error: string | null; output: string | null }
}
type CampaignItem = {
  id: string; status: string; stage: string; conclusion: string; conclusionSummary: string | null; limitations: string | null
  interpretationStatus: string; interactionStatus: string; scenarioStatus: string; executionStatus: string; reviewStatus: string
  position: { id: string; title: string; status: string; purpose: string; path: string; sourceCount: number }
  scenarios: { id: string; title: string; status: string; campaignCheck: null | { objective: string; input: string; expectedBehavior: string; criterion: string; sources: { id: string; path: string }[] } }[]
  actions: ActionRow[]
}
type Campaign = {
  id: string; contentHash: string; scopeType: string; scopeSnapshot: string; depth: string; maxModelActions: number | null; modelActionsUsed: number
  budgetHistory: { changedAt: string; before: { mode: 'limited' | 'unlimited'; maxModelActions: number | null }; after: { mode: 'limited' | 'unlimited'; maxModelActions: number | null }; modelActionsUsed: number }[]
  maxScenariosPerPosition: number; maxRetriesPerAction: number; maxAdditionalChecksPerPosition: number; maxConcurrent: number; unmappedFragmentsCount: number
  status: string; stage: string; pauseReason: string | null; lastError: string | null; versionState: string; roles: { role: string; backend: string; connectionId: string; connectionName: string; model: string }[]; items: CampaignItem[]
}
type WorkspaceData = { preview: CampaignPreview; campaigns: Campaign[]; version: { id: string; label: string; contentHash: string; currentHashValid: boolean } }
type SetupDraft = {
  step: number; scopeType: 'positions' | 'sections' | 'version'; selectedPositions: string[]; selectedSections: string[]; query: string
  depth: 'interpretation' | 'interactions' | 'scenarios' | 'full'; maxScenarios: number; budgetMode: 'limited' | 'unlimited'; maxActions: string; maxAdditional: number; maxRetries: number; stopOnTechError: boolean; idempotencyKey: string
}

const DEFAULT_DRAFT: SetupDraft = { step: 0, scopeType: 'positions', selectedPositions: [], selectedSections: [], query: '', depth: 'full', maxScenarios: 2, budgetMode: 'limited', maxActions: '20', maxAdditional: 1, maxRetries: 3, stopOnTechError: false, idempotencyKey: '' }
const ROLE_NAMES: Record<string, string> = { interpreter: 'Интерпретатор', challenger: 'Challenger', explorer: 'Explorer', executor: 'Executor', evaluator: 'Evaluator' }
const BACKEND_NAMES: Record<string, string> = { freellmapi: 'FreeLLMAPI', ollama: 'Ollama', 'session-cloud': 'session-cloud' }
const DEPTH_NAMES: Record<string, string> = { interpretation: 'Интерпретация', interactions: 'Интерпретация и взаимодействия', scenarios: 'До сценариев', full: 'Полный ограниченный цикл' }
const STOP_NAMES: Record<ResearchStopCause, string> = {
  'policy-budget-exhausted': 'Исчерпан предел действий политики',
  'provider-quota': 'Квота или rate limit провайдера',
  'temporary-upstream-error': 'Timeout или временная ошибка upstream',
  'imported-needs-reconciliation': 'Импортированная кампания требует сверки',
  'application-error': 'Ошибка приложения',
  'user-pause': 'Пауза пользователя',
  'user-cancellation': 'Отмена пользователем',
  'version-changed': 'Изменилась версия инструкции',
  unknown: 'Причина остановки не установлена',
  none: 'Нет причины остановки',
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  const payload = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`)
  return payload
}

function labelStatus(value: string | null | undefined) {
  const labels: Record<string, string> = {
    prepared: 'Подготовлена', running: 'Выполняется', paused: 'Приостановлена', completed: 'Очередь завершена', cancelled: 'Отменена', blocked: 'Заблокирована',
    supported: 'Поддержано источником', concern: 'Есть замечание', inconclusive: 'Недостаточно данных', pending: 'Ожидает', skipped: 'Пропущено по политике', compatible: 'Совместимо в выполненной проверке', empty: 'Сценарий не сформирован',
    'no-issue-in-checked-cases': 'Проблем не обнаружено в проверенных случаях', 'likely-revision': 'Вероятно нужна правка · требуется ручное решение', 'insufficient-data': 'Недостаточно данных', 'in-progress': 'Выполняется', 'not-explored': 'Не исследовалось', pass: 'Pass', fail: 'Fail', unexplored: 'Не исследовалось', proposed: 'Предложено', accepted: 'Принято пользователем', disputed: 'Оспорено пользователем',
  }
  return value ? labels[value] ?? value : 'Не сохранено'
}

function budgetLabel(campaign: Pick<Campaign, 'modelActionsUsed' | 'maxModelActions'>) {
  return campaign.maxModelActions === null
    ? `Выполнено ${campaign.modelActionsUsed} действий · общий предел не задан`
    : `Выполнено ${campaign.modelActionsUsed} из ${campaign.maxModelActions} текстовых действий`
}

function useResearchData(projectId: string, versionId: string) {
  const [data, setData] = React.useState<WorkspaceData | null>(null)
  const [assignments, setAssignments] = React.useState<AssignmentDTO[]>([])
  const [research, setResearch] = React.useState<ResearchStateDTO | null>(null)
  const [loadedKey, setLoadedKey] = React.useState('')
  const [refreshKey, setRefreshKey] = React.useState(0)
  const [loadError, setLoadError] = React.useState<{ key: string; message: string } | null>(null)
  const requestKey = `${projectId}:${versionId}:${refreshKey}`
  React.useEffect(() => {
    let current = true
    void Promise.all([
      request<WorkspaceData>(`/api/research-campaign?projectId=${encodeURIComponent(projectId)}&versionId=${encodeURIComponent(versionId)}`),
      request<AssignmentDTO[]>(`/api/assignments?projectId=${encodeURIComponent(projectId)}`),
      request<ResearchStateDTO>(`/api/semantic/research-state?projectId=${encodeURIComponent(projectId)}&versionId=${encodeURIComponent(versionId)}`),
    ]).then(([workspace, roles, state]) => {
      if (!current) return
      setData(workspace); setAssignments(roles); setResearch(state)
      setLoadedKey(requestKey)
    }).catch((cause: unknown) => {
      if (current) {
        setLoadError({ key: requestKey, message: cause instanceof Error ? cause.message : String(cause) })
        setLoadedKey(requestKey)
      }
    })
    return () => { current = false }
  }, [projectId, versionId, refreshKey])
  return { data, assignments, research, loading: loadedKey !== requestKey, error: loadError?.key === requestKey ? loadError.message : '', refresh: () => setRefreshKey((value) => value + 1) }
}

export default function ResearchStudio() {
  const appState = useStore((state) => state.appState)
  const selectedVersionId = useStore((state) => state.selectedVersionId)
  const version = useStore(activeVersion)
  const project = appState?.project
  const versionId = selectedVersionId ?? version?.id ?? ''
  const [view, setView] = React.useState<'home' | 'setup' | 'campaign'>('home')
  const [campaignId, setCampaignId] = React.useState('')
  const [createdCampaign, setCreatedCampaign] = React.useState<{ scopeKey: string; campaign: Campaign } | null>(null)
  const [selectedItemId, setSelectedItemId] = React.useState('')
  const [draft, setDraft] = React.useState<SetupDraft>(DEFAULT_DRAFT)
  const [hydratedDraftKey, setHydratedDraftKey] = React.useState('')
  const [busyAction, setBusyAction] = React.useState(false)
  const [drivingCampaign, setDrivingCampaign] = React.useState(false)
  const [controlPending, setControlPending] = React.useState(false)
  const [actionError, setActionError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [showEvents, setShowEvents] = React.useState(false)
  const setStudio = useStore((state) => state.setStudio)
  const setSelectedRun = useStore((state) => state.selectRun)
  const setSelectedScenario = useStore((state) => state.selectScenario)
  const selectFragment = useStore((state) => state.selectFragment)
  const selectCodemapTarget = useStore((state) => state.selectCodemapTarget)
  const setCodemapReturnCampaign = useStore((state) => state.setCodemapReturnCampaign)
  const codemapReturnCampaignId = useStore((state) => state.codemapReturnCampaignId)
  const selectedProcessId = useStore((state) => state.selectedProcessId)
  const dataState = useResearchData(project?.id ?? '', versionId)
  const { data, assignments, research, loading, error, refresh } = dataState
  const storageKey = `s2-research-draft:${project?.id ?? ''}:${versionId}`
  const draftReady = hydratedDraftKey === storageKey
  const actionLock = React.useRef(false)

  React.useEffect(() => {
    if (!codemapReturnCampaignId || !data?.campaigns.some((campaign) => campaign.id === codemapReturnCampaignId)) return
    const frame = window.requestAnimationFrame(() => {
      setCampaignId(codemapReturnCampaignId)
      setView('campaign')
      setCodemapReturnCampaign(null)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [codemapReturnCampaignId, data, setCodemapReturnCampaign])

  React.useEffect(() => {
    const id = selectedProcessId?.startsWith('campaign:') ? selectedProcessId.slice('campaign:'.length) : ''
    if (!id || !data?.campaigns.some((campaign) => campaign.id === id)) return
    const frame = window.requestAnimationFrame(() => {
      setCampaignId(id)
      setView('campaign')
    })
    return () => window.cancelAnimationFrame(frame)
  }, [selectedProcessId, data?.campaigns])

  React.useEffect(() => {
    void Promise.resolve().then(() => {
      try {
        const stored = window.sessionStorage.getItem(storageKey)
        setDraft(stored ? { ...DEFAULT_DRAFT, ...JSON.parse(stored) as Partial<SetupDraft> } : DEFAULT_DRAFT)
      } catch { setDraft(DEFAULT_DRAFT) }
      setHydratedDraftKey(storageKey)
    })
  }, [storageKey])
  React.useEffect(() => {
    if (!draftReady || !storageKey) return
    window.sessionStorage.setItem(storageKey, JSON.stringify(draft))
  }, [draft, draftReady, storageKey])

  const setDraftField = <K extends keyof SetupDraft>(key: K, value: SetupDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const changeView = (next: 'home' | 'setup' | 'campaign') => { setActionError(''); setNotice(''); setView(next) }
  const postCampaign = async (action: string, id: string, extra: Record<string, unknown> = {}) => request<{ campaign?: Campaign; kind?: string; error?: string }>('/api/research-campaign', {
    method: 'POST', body: JSON.stringify({ projectId: project?.id, versionId, campaignId: id, action, ...extra }),
  })
  const campaigns = data?.campaigns ?? []
  const scopeKey = `${project?.id ?? ''}:${versionId}`
  const selectedCampaign = campaigns.find((campaign) => campaign.id === campaignId)
    ?? (createdCampaign?.scopeKey === scopeKey && createdCampaign.campaign.id === campaignId ? createdCampaign.campaign : null)
  const selectedItem = selectedCampaign?.items.find((item) => item.id === selectedItemId) ?? selectedCampaign?.items[0] ?? null
  const assignmentsByRole = new Map(assignments.map((assignment) => [assignment.role, assignment]))

  const createCampaign = async () => {
    if (!data || actionLock.current) return
    if (!draft.idempotencyKey) setDraftField('idempotencyKey', window.crypto.randomUUID().replaceAll('-', ''))
    const idempotencyKey = draft.idempotencyKey || window.crypto.randomUUID().replaceAll('-', '')
    actionLock.current = true; setBusyAction(true); setActionError(''); setNotice('')
    try {
      const result = await request<{ campaign: Campaign }>('/api/research-campaign', {
        method: 'POST', body: JSON.stringify({
          action: 'create', projectId: project?.id, versionId, expectedHash: data.preview.contentHash, idempotencyKey,
          scope: { type: draft.scopeType, positionIds: draft.selectedPositions, sectionPaths: draft.selectedSections },
          policy: { depth: draft.depth, maxScenariosPerPosition: draft.maxScenarios, maxModelActions: draft.budgetMode === 'unlimited' ? null : Number(draft.maxActions), maxAdditionalChecksPerPosition: draft.maxAdditional, maxRetriesPerAction: draft.maxRetries, maxConcurrent: 1, stopOnQuota: true, stopOnTechnicalError: draft.stopOnTechError, allowRewriteExperiment: false },
        }),
      })
      setCampaignId(result.campaign.id); setCreatedCampaign({ scopeKey, campaign: result.campaign }); setView('campaign')
      setNotice('Кампания сохранена как «Подготовлена». Модельные действия не запускались.')
      setDraft(DEFAULT_DRAFT)
      refresh()
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)) }
    finally { actionLock.current = false; setBusyAction(false) }
  }

  const driveCampaign = async (id: string) => {
    if (actionLock.current) return
    actionLock.current = true
    setDrivingCampaign(true)
    setBusyAction(true); setActionError('')
    try {
      for (;;) {
        const result = await postCampaign('advance', id)
        if (result.kind === 'waiting') { await new Promise((resolve) => window.setTimeout(resolve, 1200)); continue }
        if (!result.campaign || result.campaign.status !== 'running') break
      }
      refresh()
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)); refresh() }
    finally { actionLock.current = false; setBusyAction(false); setDrivingCampaign(false) }
  }

  const startOrResume = async (campaign: Campaign, action: 'start' | 'resume') => {
    if (actionLock.current) return
    const actionWord = action === 'start' ? 'запуск' : 'возобновление'
    if (!window.confirm(`Подтвердите ${actionWord}: будут выполнены текстовые действия по сохранённым назначениям и политике кампании. Использованный бюджет не обнуляется.`)) return
    actionLock.current = true; setBusyAction(true); setActionError('')
    try {
      await postCampaign(action, campaign.id)
      refresh()
      actionLock.current = false; setBusyAction(false)
      void driveCampaign(campaign.id)
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)); actionLock.current = false; setBusyAction(false) }
  }

  const pauseCampaign = async (campaign: Campaign) => {
    if (controlPending) return
    if (!window.confirm('Поставить кампанию на паузу? Текущая операция будет отменена, если поддерживает отмену. Уже сохранённые действия останутся в истории.')) return
    setControlPending(true)
    setBusyAction(true); setActionError('')
    try { await postCampaign('pause', campaign.id); refresh() }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setControlPending(false); if (!drivingCampaign) setBusyAction(false) }
  }

  const cancelCampaign = async (campaign: Campaign) => {
    if (controlPending) return
    if (!window.confirm('Отменить кампанию? Незавершённые положения получат заключение «Недостаточно данных»; сохранённые записи не удаляются.')) return
    setControlPending(true)
    setBusyAction(true); setActionError('')
    try { await postCampaign('cancel', campaign.id); refresh() }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setControlPending(false); if (!drivingCampaign) setBusyAction(false) }
  }

  const increaseBudget = async (campaign: Campaign, nextLimit: number | null) => {
    setBusyAction(true); setActionError('')
    try { await postCampaign('update-budget', campaign.id, { maxModelActions: nextLimit }); refresh() }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusyAction(false) }
  }

  if (!project || !versionId) return <EmptyState title="Нет активного проекта или версии" hint="Выберите проект и версию в верхней панели, затем откройте «Исследование»." />

  if (loading && !data) return <div role="status" className="rounded-xl border bg-card p-8 text-sm text-muted-foreground">Загружаю кампании, состояния и область версии…</div>
  if (error && !data) return <ErrorState title="Не удалось загрузить исследование" error={error} onRetry={refresh} />
  if (!data) return <EmptyState title="Нет данных об исследовании" hint="Обновите экран или проверьте выбранную версию." action={<Button onClick={refresh}>Обновить данные</Button>} />

  const openDiscrepancies = research?.discrepancies.open ?? 0
  const uncertain = research ? research.unverifiedConclusions.proposedPositions + research.observations.unverified : 0
  const blockedCampaigns = campaigns.filter((campaign) => campaign.status === 'blocked' || campaign.status === 'paused' && Boolean(campaign.pauseReason)).length
  const filteredPositions = data.preview.positions.filter((position) => `${position.title} ${position.paths.join(' ')}`.toLocaleLowerCase().includes(draft.query.trim().toLocaleLowerCase()))
  const selectedByType = draft.scopeType === 'positions' ? draft.selectedPositions.length : draft.scopeType === 'sections' ? draft.selectedSections.length : data.preview.positions.length
  const scopedPositions = draft.scopeType === 'positions'
    ? data.preview.positions.filter((position) => draft.selectedPositions.includes(position.id))
    : draft.scopeType === 'sections'
      ? data.preview.positions.filter((position) => position.paths.some((path) => draft.selectedSections.some((section) => path === section || path.startsWith(`${section}.`))))
      : data.preview.positions
  const roleNames: RoleId[] = draft.depth === 'full' ? ['interpreter', 'challenger', 'explorer', 'executor', 'evaluator'] : draft.depth === 'scenarios' ? ['interpreter', 'challenger', 'explorer'] : draft.depth === 'interactions' ? ['interpreter', 'challenger'] : ['interpreter']
  const missingRoles = roleNames.filter((role) => { const row = assignmentsByRole.get(role); return !row?.backend || !row.connectionId || !row.model })
  const currentCampaignSummary = campaigns[0] ? campaignSummary(campaigns[0]) : null
  const limitedBudgetValue = Number(draft.maxActions)
  const validLimitedBudget = Number.isSafeInteger(limitedBudgetValue) && limitedBudgetValue > 0
  const hasDraft = draft.step > 0 || Boolean(draft.query || draft.selectedPositions.length || draft.selectedSections.length)

  const goTo = (studio: StudioId) => setStudio(studio)

  return <main className="mx-auto max-w-7xl space-y-5 py-2" aria-labelledby="research-title">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-medium uppercase tracking-wide text-primary">Рабочая область</p><h1 id="research-title" className="mt-1 text-2xl font-semibold">Исследование</h1><p className="mt-1 text-sm text-muted-foreground">{project.name} · версия {data.preview.versionLabel} · <span className="font-mono">{data.preview.contentHash.slice(0, 12)}…</span></p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={refresh}><RefreshCw className="mr-2 size-4" aria-hidden />Обновить</Button>{view !== 'home' && <Button variant="ghost" onClick={() => changeView('home')}><ArrowLeft className="mr-2 size-4" aria-hidden />К исследованию</Button>}</div>
    </header>

    {actionError && <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">{actionError}</div>}
    {notice && <div role="status" className="rounded-lg border border-emerald-600/40 bg-emerald-600/5 p-3 text-sm">{notice}</div>}

    {view === 'home' && <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Состояние исследования">
        <SummaryCard label="Положения этой версии" value={research?.interpretations.total ?? data.preview.positions.length} detail={`${research?.interpretations.proposed ?? 0} предложены · ${research?.interpretations.accepted ?? 0} приняты`} />
        <SummaryCard label="Открытые расхождения" value={openDiscrepancies} detail={openDiscrepancies ? 'Ожидают пользовательского решения' : 'Открытых записей нет'} />
        <SummaryCard label="Неопределённость" value={uncertain} detail="Предложенные положения + непроверенные наблюдения" />
        <SummaryCard label="Кампании с блокировкой/паузой" value={blockedCampaigns} detail={`${campaigns.length} сохранено для этой версии`} />
      </section>

      {currentCampaignSummary && <Card className="border-primary/40"><CardHeader className="pb-3"><CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base"><span>Текущее исследование</span><Badge variant="outline">{currentCampaignSummary.execution}</Badge></CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm">{currentCampaignSummary.message}</p><div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4"><span>Проверки: {currentCampaignSummary.checks}</span><span>Автозаключения: {currentCampaignSummary.conclusions}</span><span>Решения пользователя: {currentCampaignSummary.decisions}</span><span>{budgetLabel(campaigns[0])}</span></div><Button onClick={() => { setCampaignId(campaigns[0].id); setSelectedItemId(campaigns[0].items[0]?.id ?? ''); changeView('campaign') }}>Открыть кампанию <ArrowRight className="ml-2 size-4" aria-hidden /></Button></CardContent></Card>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
        <section className="space-y-3" aria-labelledby="campaign-list-title"><div className="flex items-center justify-between gap-2"><h2 id="campaign-list-title" className="text-lg font-semibold">Сохранённые кампании</h2><Button onClick={() => setView('setup')}>{hasDraft ? 'Продолжить черновик' : 'Начать новое исследование'}</Button></div>
          {!campaigns.length ? <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">Кампаний для этой версии пока нет. Настройка сохранится только после явного подтверждения; открытие этого экрана ничего не запускает.</div> : <div className="space-y-2">{campaigns.map((campaign) => <CampaignListCard key={campaign.id} campaign={campaign} onOpen={() => { setCampaignId(campaign.id); setSelectedItemId(campaign.items[0]?.id ?? ''); changeView('campaign') }} />)}</div>}
        </section>
        <aside className="space-y-3" aria-label="Дополнительные рабочие инструменты"><h2 className="text-lg font-semibold">Связанные инструменты</h2><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1"><ToolLink icon={BookOpen} title="Instruction Atlas" text="Поиск, исходный текст, положения и связи" onClick={() => goTo('atlas')} /><ToolLink icon={FlaskConical} title="Behavior Lab" text="Ручной запуск ролей и просмотр результатов" onClick={() => goTo('lab')} /><ToolLink icon={GitBranch} title="Сценарии" text="Подготовить и открыть validation-сценарии" onClick={() => goTo('scenario')} /><ToolLink icon={Settings2} title="Расширенная диагностика" text="Индекс, coverage, Analysis и ошибки" onClick={() => goTo('atlas')} /><ToolLink icon={Share2} title="Экспорт и передача" text="Handoff и полный архив" onClick={() => goTo('export')} /></div></aside>
      </div>
      <details className="rounded-lg border bg-card/60 p-3"><summary className="cursor-pointer text-sm font-medium">Что означают эти состояния</summary><p className="mt-2 text-sm text-muted-foreground">Статус очереди не говорит, что проверки завершены. Машинное заключение не является решением пользователя. Провайдер и модель показываются только по сохранённым фактическим метаданным; неизвестное не выводится из запрошенной модели.</p></details>
    </>}

    {view === 'setup' && <section className="space-y-4" aria-labelledby="setup-title">
      <div><h2 id="setup-title" className="text-xl font-semibold">Новое исследование</h2><p className="text-sm text-muted-foreground">Область → Политика → Проверка и запуск. Черновик хранится в этой вкладке браузера и не создаёт исследовательских записей.</p></div>
      <div className="flex flex-wrap gap-2" aria-label="Шаг настройки">{['Область', 'Политика', 'Проверка и запуск'].map((label, index) => <Badge key={label} variant={draft.step === index ? 'default' : 'outline'}>{index + 1}. {label}</Badge>)}</div>

      {draft.step === 0 && <Card><CardHeader><CardTitle>1. Выберите область и источники</CardTitle></CardHeader><CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">{([['positions', 'Положения'], ['sections', 'Разделы'], ['version', 'Вся версия']] as const).map(([value, label]) => <Button key={value} type="button" variant={draft.scopeType === value ? 'default' : 'outline'} onClick={() => setDraft((current) => ({ ...current, scopeType: value, selectedPositions: [], selectedSections: [] }))}>{label}</Button>)}</div>
        {draft.scopeType !== 'version' && <><label className="relative block"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden /><Input className="pl-9" aria-label="Поиск положения или раздела" placeholder="Найти по названию или пути раздела" value={draft.query} onChange={(event) => setDraftField('query', event.target.value)} /></label>
          {draft.scopeType === 'positions' ? <div className="max-h-[26rem] overflow-auto rounded-lg border" role="group" aria-label="Выбор положений">{filteredPositions.slice(0, 100).map((position) => <label key={position.id} className="flex cursor-pointer items-start gap-3 border-b px-3 py-2.5 last:border-0 hover:bg-muted/50"><input className="mt-1 size-4 accent-primary" type="checkbox" checked={draft.selectedPositions.includes(position.id)} onChange={(event) => setDraft((current) => ({ ...current, selectedPositions: event.target.checked ? [...current.selectedPositions, position.id] : current.selectedPositions.filter((id) => id !== position.id) }))} /><span className="min-w-0"><span className="block text-sm font-medium">{position.title}</span><span className="mt-0.5 block break-words text-xs text-muted-foreground">{position.paths.join(', ') || 'источник не привязан'} · {position.sourceCount} Fragment</span></span></label>)}{!filteredPositions.length && <p className="p-4 text-sm text-muted-foreground">Положения не найдены по этому фильтру.</p>}{filteredPositions.length > 100 && <p className="p-3 text-xs text-muted-foreground">Показаны первые 100 совпадений. Уточните название или путь.</p>}</div> : <div className="grid max-h-[26rem] gap-2 overflow-auto rounded-lg border p-3 sm:grid-cols-2">{data.preview.sections.filter((section) => `раздел ${section}`.includes(draft.query.toLocaleLowerCase()) || section.toLocaleLowerCase().includes(draft.query.toLocaleLowerCase())).map((section) => <label key={section} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.selectedSections.includes(section)} onChange={(event) => setDraft((current) => ({ ...current, selectedSections: event.target.checked ? [...current.selectedSections, section] : current.selectedSections.filter((path) => path !== section) }))} />Раздел {section}</label>)}</div>}</>}
        {draft.scopeType === 'version' && <p className="rounded-md border bg-muted/40 p-3 text-sm">Будут включены все {data.preview.positions.length} положения этой версии. Источники без положения будут показаны как пробелы покрытия.</p>}
        <p className="text-sm text-muted-foreground">Выбрано: {selectedByType} {draft.scopeType === 'sections' ? 'разделов' : 'положений'} · версия {data.preview.versionLabel} · hash <span className="font-mono">{data.preview.contentHash.slice(0, 12)}…</span></p>
        <div className="flex justify-end"><Button disabled={!selectedByType} onClick={() => setDraftField('step', 1)}>Далее: Политика <ChevronRight className="ml-2 size-4" aria-hidden /></Button></div>
      </CardContent></Card>}

      {draft.step === 1 && <Card><CardHeader><CardTitle>2. Политика и назначения</CardTitle></CardHeader><CardContent className="space-y-4">
        <label className="block space-y-1 text-sm">Глубина<select className="h-10 w-full rounded-md border bg-background px-3" value={draft.depth} onChange={(event) => setDraftField('depth', event.target.value as SetupDraft['depth'])}>{Object.entries(DEPTH_NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {draft.depth === 'full' && <label className="block space-y-1 text-sm">Максимум сценариев на положение<select className="h-10 w-full rounded-md border bg-background px-3" value={draft.maxScenarios} onChange={(event) => setDraftField('maxScenarios', Number(event.target.value))}><option value={1}>1</option><option value={2}>2</option></select></label>}
        <div className="grid gap-3 sm:grid-cols-3"><label className="block space-y-1 text-sm">Общий предел действий<select className="h-10 w-full rounded-md border bg-background px-3" value={draft.budgetMode} onChange={(event) => setDraftField('budgetMode', event.target.value as SetupDraft['budgetMode'])}><option value="limited">Ограниченный</option><option value="unlimited">Без общего предела</option></select></label>{draft.budgetMode === 'limited' ? <label className="block space-y-1 text-sm">Предел текстовых действий<input className="h-10 w-full rounded-md border bg-background px-3" type="number" inputMode="numeric" min={1} step={1} value={draft.maxActions} onChange={(event) => setDraftField('maxActions', event.target.value)} aria-invalid={!validLimitedBudget} /></label> : <p className="self-center rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm sm:col-span-2">Работа продолжается до завершения выбранной области, паузы, отмены или блокировки. Отдельные ограничения сохраняются.</p>}<label className="block space-y-1 text-sm">Доп. проверок на положение<select className="h-10 w-full rounded-md border bg-background px-3" value={draft.maxAdditional} onChange={(event) => setDraftField('maxAdditional', Number(event.target.value))}><option value={0}>0</option><option value={1}>1</option></select></label><label className="block space-y-1 text-sm">Попыток на действие, всего<select className="h-10 w-full rounded-md border bg-background px-3" value={draft.maxRetries} onChange={(event) => setDraftField('maxRetries', Number(event.target.value))}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked readOnly /> Поставить на паузу при квоте провайдера</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.stopOnTechError} onChange={(event) => setDraftField('stopOnTechError', event.target.checked)} /> Остановить при технической ошибке</label>
        <div className="rounded-lg border p-3"><h3 className="text-sm font-semibold">Снимок назначений нужных ролей</h3><ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">{roleNames.map((role) => { const assignment = assignmentsByRole.get(role); return <li key={role} className="break-words">{ROLE_NAMES[role]}: {assignment?.backend && assignment.connectionName && assignment.model ? `${BACKEND_NAMES[assignment.backend] ?? assignment.backend} · ${assignment.connectionName} · запрошено ${assignment.model}` : 'не назначена — выберите подключение'} </li> })}</ul><p className="mt-2 text-xs text-muted-foreground">Actual provider/model будут неизвестны до ответа и появятся только при сохранении сервером фактических метаданных. Embedding остаётся отдельным назначением.</p></div>
        {draft.budgetMode === 'limited' && !validLimitedBudget && <p role="alert" className="text-sm text-destructive">Введите положительное безопасное целое число. Максимальное значение: {Number.MAX_SAFE_INTEGER}.</p>}
        <div className="flex justify-between"><Button variant="outline" onClick={() => setDraftField('step', 0)}><ArrowLeft className="mr-2 size-4" aria-hidden />Назад</Button><Button disabled={missingRoles.length > 0 || draft.budgetMode === 'limited' && !validLimitedBudget} onClick={() => setDraftField('step', 2)}>Далее: Проверка <ChevronRight className="ml-2 size-4" aria-hidden /></Button></div>
      </CardContent></Card>}

      {draft.step === 2 && <Card><CardHeader><CardTitle>3. Проверка и создание кампании</CardTitle></CardHeader><CardContent className="space-y-4">
        <section className="rounded-lg border p-3 text-sm"><h3 className="font-semibold">Область и версия</h3><p className="mt-1">{project.name} · {data.preview.versionLabel} · {data.preview.versionId}</p><p className="break-all font-mono text-xs text-muted-foreground">SHA-256: {data.preview.contentHash}</p><p className="mt-2">{selectedByType} {draft.scopeType === 'version' ? 'положений всей версии' : draft.scopeType === 'sections' ? 'разделов' : 'положений'} · {scopedPositions.length} разрешённых положений · {scopedPositions.reduce((sum, position) => sum + position.sourceCount, 0)} связанных исходных фрагментов</p><ul className="mt-2 max-h-40 space-y-1 overflow-auto border-l pl-3 text-xs text-muted-foreground">{scopedPositions.slice(0, 30).map((position) => <li key={position.id}>{position.title} · {position.paths.join(', ') || 'без path'} · {position.sourceCount} Fragment</li>)}{scopedPositions.length > 30 && <li>… ещё {scopedPositions.length - 30}; полный список доступен в выбранной области</li>}</ul></section>
        <section className="rounded-lg border p-3 text-sm"><h3 className="font-semibold">Политика и разрешённые этапы</h3><p>{DEPTH_NAMES[draft.depth]} · {draft.budgetMode === 'unlimited' ? 'общий предел текстовых действий не задан' : `не более ${draft.maxActions || '—'} текстовых действий`} · до {draft.maxRetries} попыток на действие · параллельность 1 · переписывание запрещено</p><p className="mt-1 text-muted-foreground">Область конечна; сценариев не более {draft.maxScenarios} на положение, дополнительных содержательных проверок — не более {draft.maxAdditional} на положение. Квота и технические ошибки останавливают работу по выбранной политике. Разрешённые роли: {roleNames.map((role) => ROLE_NAMES[role]).join(', ')}.</p></section>
        <section className="rounded-lg border border-amber-600/40 bg-amber-600/5 p-3 text-sm"><h3 className="font-semibold">Известный отправляемый материал</h3><p className="mt-1">Каждое действие использует специализированную задачу роли и исходные фрагменты выбранного положения. Роли до Executor получают контекст инструкции `none` и явные выдержки/положения в тексте задачи; Executor получает полную выбранную версию и вход сценария. Дополнительные действия и фрагменты зависят от результатов; точный будущий набор сообщений и число вызовов заранее неизвестны. Ни preview, ни создание кампании не отправляют запрос модели.</p></section>
        <div className="rounded-lg border p-3 text-sm"><h3 className="font-semibold">Решение</h3><p className="mt-1">«Проверить и сохранить кампанию» создаст одну кампанию в состоянии «Подготовлена». Внешние модельные действия начнутся только после отдельного нажатия «Начать выполнение» и подтверждения.</p></div>
        {missingRoles.length > 0 && <p role="alert" className="text-sm text-destructive">Не назначены роли: {missingRoles.map((role) => ROLE_NAMES[role]).join(', ')}.</p>}
        <div className="flex flex-wrap justify-between gap-2"><Button variant="outline" onClick={() => setDraftField('step', 1)}><ArrowLeft className="mr-2 size-4" aria-hidden />Назад</Button><div className="flex gap-2"><Button variant="ghost" onClick={() => changeView('home')}>Закрыть настройку и сохранить черновик</Button><Button disabled={busyAction || missingRoles.length > 0 || !selectedByType || !data.version.currentHashValid || draft.budgetMode === 'limited' && !validLimitedBudget} onClick={() => void createCampaign()}>{busyAction ? 'Сохраняю…' : 'Проверить и сохранить кампанию'}</Button></div></div>
      </CardContent></Card>}
    </section>}

    {view === 'campaign' && selectedCampaign && <CampaignDetail key={`${selectedCampaign.id}:${selectedCampaign.maxModelActions}`} campaign={selectedCampaign} selectedItem={selectedItem} selectedItemId={selectedItemId} onSelectItem={setSelectedItemId} research={research} showEvents={showEvents} onToggleEvents={() => setShowEvents((value) => !value)} busy={busyAction && !drivingCampaign} controlPending={controlPending} onStart={() => void startOrResume(selectedCampaign, 'start')} onResume={() => void startOrResume(selectedCampaign, 'resume')} onPause={() => void pauseCampaign(selectedCampaign)} onCancel={() => void cancelCampaign(selectedCampaign)} onIncreaseBudget={(value) => void increaseBudget(selectedCampaign, value)} onAdvance={() => void driveCampaign(selectedCampaign.id)} onNavigate={goTo} onRun={(id) => { setCodemapReturnCampaign(selectedCampaign.id); setSelectedRun(id); goTo('lab') }} onScenario={(id) => { setSelectedScenario(id); goTo('scenario') }} onFragment={(id) => { setCodemapReturnCampaign(selectedCampaign.id); selectFragment(id); goTo('atlas') }} onResearchRecord={(kind, id, positionId) => { setCodemapReturnCampaign(selectedCampaign.id); selectCodemapTarget({ kind, id, positionId }); goTo('atlas') }} />}
    {view === 'campaign' && !selectedCampaign && <EmptyState title="Кампания не найдена в выбранной версии" hint="Обновите список и выберите кампанию из этой версии." action={<Button onClick={() => changeView('home')}>К сохранённым кампаниям</Button>} />}
  </main>
}

function SummaryCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value.toLocaleString('ru-RU')}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>
}

function ToolLink({ icon: Icon, title, text, onClick }: { icon: React.ComponentType<{ className?: string }>; title: string; text: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /><span><span className="block text-sm font-medium">{title}</span><span className="mt-0.5 block text-xs text-muted-foreground">{text}</span></span><ArrowRight className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden /></button>
}

function campaignSummary(campaign: Campaign) {
  const stages = campaign.items.flatMap((item) => campaignRequiredStages(campaign.depth, item))
  const completed = stages.filter((stage) => ['supported', 'concern', 'inconclusive', 'skipped', 'compatible', 'completed', 'empty'].includes(stage.status)).length
  const incomplete = stages.length - completed
  const conclusions = campaign.items.map((item) => item.conclusion).filter((value) => value !== 'not-explored' && value !== 'in-progress')
  const decisions = campaign.items.filter((item) => ['accepted', 'disputed'].includes(item.position.status)).length
  const execution = labelStatus(campaign.status)
  const message = `${campaign.items.length} положений · проверки ${completed}/${stages.length} завершены по сохранённым этапам${incomplete ? `, ${incomplete} ожидают или не сохранены` : ''}. Автозаключений: ${conclusions.length}; решений пользователя по положениям: ${decisions}.`
  return { execution, checks: `${completed}/${stages.length} этапов`, conclusions: `${conclusions.length} из ${campaign.items.length}`, decisions: `${decisions} из ${campaign.items.length}`, message }
}

function CampaignListCard({ campaign, onOpen }: { campaign: Campaign; onOpen: () => void }) {
  const cause = classifyResearchStop(campaign.pauseReason, campaign.lastError)
  const summary = campaignSummary(campaign)
  return <article className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><ObjectTypeBadge kind="campaign"/><StatusBadge status={campaign.status} label={summary.execution}/><h3 className="break-all text-sm font-semibold">{campaign.id}</h3></div><p className="mt-1 text-xs text-muted-foreground">{DEPTH_NAMES[campaign.depth] ?? campaign.depth} · {campaign.items.length} положений · {budgetLabel(campaign)}</p>{campaign.pauseReason && <p className="mt-1 text-sm">{STOP_NAMES[cause]}</p>}{campaign.lastError && <p className="mt-1 break-words text-xs text-destructive">Исходная ошибка: {campaign.lastError}</p>}</div><Button variant="outline" onClick={onOpen}>Открыть результаты <ArrowRight className="ml-2 size-4" aria-hidden /></Button></article>
}

function CampaignDetail({ campaign, selectedItem, selectedItemId, onSelectItem, research, showEvents, onToggleEvents, busy, controlPending, onStart, onResume, onPause, onCancel, onIncreaseBudget, onAdvance, onNavigate, onRun, onScenario, onFragment, onResearchRecord }: {
  campaign: Campaign; selectedItem: CampaignItem | null; selectedItemId: string; onSelectItem: (id: string) => void; research: ResearchStateDTO | null; showEvents: boolean; onToggleEvents: () => void; busy: boolean; controlPending: boolean
  onStart: () => void; onResume: () => void; onPause: () => void; onCancel: () => void; onIncreaseBudget: (value: number | null) => void; onAdvance: () => void; onNavigate: (studio: StudioId) => void
  onRun: (id: string) => void; onScenario: (id: string) => void; onFragment: (id: string) => void
  onResearchRecord: (kind: 'observation' | 'discrepancy', id: string, positionId: string) => void
}) {
  const stop = classifyResearchStop(campaign.pauseReason, campaign.lastError)
  const lastFailedAttempt = Math.max(-1, ...campaign.items.flatMap((item) => item.actions.filter((action) => action.status === 'failed').map((action) => action.attempt)))
  const resumeBlock = campaignResumeBlock({ ...campaign, latestFailedAttempt: lastFailedAttempt })
  const stageStates = selectedItem ? campaignRequiredStages(campaign.depth, selectedItem) : []
  const stageComplete = requiredStagesCompletion(stageStates)
  const positionState = selectedItem ? research?.positions.find((position) => position.positionId === selectedItem.position.id) : undefined
  const challengerIncomplete = campaign.status === 'completed'
    && selectedItem?.conclusion === 'insufficient-data'
    && selectedItem.interactionStatus === 'inconclusive'
    && selectedItem.actions.some((action) => action.actionType === 'interaction' && action.role === 'challenger' && ['failed', 'cancelled'].includes(action.status))
  const providerRoles = campaign.roles.map((role) => `${ROLE_NAMES[role.role] ?? role.role}: ${BACKEND_NAMES[role.backend] ?? role.backend} · ${role.connectionName} · запрошено ${role.model}`)
  const [budgetMode, setBudgetMode] = React.useState<'limited' | 'unlimited'>(campaign.maxModelActions === null ? 'unlimited' : 'limited')
  const [budgetInput, setBudgetInput] = React.useState(String(campaign.maxModelActions ?? Math.max(20, campaign.modelActionsUsed)))
  const nextBudget = budgetMode === 'unlimited' ? null : Number(budgetInput)
  const validNextBudget = nextBudget === null || Number.isSafeInteger(nextBudget) && nextBudget >= campaign.modelActionsUsed && nextBudget > 0
  const canEditBudget = campaign.status === 'paused' && campaign.pauseReason !== 'import-reconciliation' && campaign.versionState === 'current'

  return <section className="space-y-4" aria-labelledby="campaign-detail-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><ObjectTypeBadge kind="campaign"/><h2 id="campaign-detail-title" className="text-xl font-semibold">Кампания</h2><p className="break-all font-mono text-xs text-muted-foreground">{campaign.id}</p></div><StatusBadge status={campaign.status} label={labelStatus(campaign.status)}/></div>
    <div className="rounded-lg border bg-card p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Исполнение очереди</h3><p className="mt-1 flex flex-wrap items-center gap-2 text-sm">Статус: <StatusBadge status={campaign.status} label={labelStatus(campaign.status)}/> · этап: {campaign.stage} · версия: {campaign.versionState}</p><p className="mt-1 text-sm">{budgetLabel(campaign)}. Запуск и повтор не сбрасывают этот счётчик.</p>{campaign.pauseReason && <div className="mt-2 max-w-3xl rounded-md bg-amber-500/10 p-3 text-sm"><p><strong>Причина:</strong> {STOP_NAMES[stop]}</p>{campaign.lastError && <p className="mt-1 break-words"><strong>Исходная ошибка:</strong> {campaign.lastError}</p>}{stop === 'unknown' && <p className="mt-1">Причину нельзя надёжно классифицировать по сохранённым полям; UI не угадывает её.</p>}</div>}</div>
      <div className="flex flex-wrap gap-2">{campaign.status === 'prepared' && <Button disabled={busy || Boolean(resumeBlock)} onClick={onStart}>Начать выполнение</Button>}{campaign.status === 'running' && <Button variant="outline" disabled={busy || controlPending} onClick={onPause}>Пауза</Button>}{campaign.status === 'paused' && <Button disabled={busy || Boolean(resumeBlock)} onClick={onResume}>Возобновить</Button>}{['prepared', 'running', 'paused'].includes(campaign.status) && <Button variant="destructive" disabled={busy || controlPending} onClick={onCancel}>Отменить кампанию</Button>}</div></div>
      {resumeBlock && campaign.status === 'paused' && <p className="mt-2 text-sm text-muted-foreground">Продолжение недоступно: {resumeBlock}</p>}
      {stop === 'provider-quota' && !resumeBlock && <p className="mt-2 text-sm text-muted-foreground">Продолжение возможно при наличии бюджета после проверки подключения. Повтор может снова завершиться ошибкой провайдера.</p>}
      {canEditBudget && <div className="mt-3 space-y-2 rounded-md border p-3"><h4 className="text-sm font-medium">Изменить общий бюджет</h4><div className="flex flex-wrap items-end gap-2"><label className="space-y-1 text-xs">Режим<select className="block h-9 rounded border bg-background px-2 text-sm" value={budgetMode} onChange={(event) => setBudgetMode(event.target.value as 'limited' | 'unlimited')}><option value="limited">Ограниченный</option><option value="unlimited">Без общего предела</option></select></label>{budgetMode === 'limited' && <label className="space-y-1 text-xs">Новый предел<input className="block h-9 w-40 rounded border bg-background px-2 text-sm" type="number" min={campaign.modelActionsUsed} step={1} value={budgetInput} onChange={(event) => setBudgetInput(event.target.value)} aria-invalid={!validNextBudget} /></label>}<Button size="sm" variant="outline" disabled={busy || !validNextBudget || nextBudget === campaign.maxModelActions} onClick={() => onIncreaseBudget(nextBudget)}>Сохранить бюджет</Button></div><p className="max-w-3xl text-xs text-muted-foreground">Изменение сохраняет старое и новое значение и счётчик использованных действий. Оно не возобновляет кампанию; «Возобновить» остаётся отдельным действием. Для режима без общего предела работа идёт до завершения конечной области, паузы, отмены или блокировки. Сохраняются лимиты этапов, до {campaign.maxRetriesPerAction} попыток на действие, конкурентность {campaign.maxConcurrent ?? 1} и остановки по квоте/ошибкам.</p>{!validNextBudget && budgetMode === 'limited' && <p role="alert" className="text-xs text-destructive">Введите безопасное целое число не меньше уже использованных действий ({campaign.modelActionsUsed}).</p>}</div>}
      {campaign.budgetHistory.length > 0 && <details className="mt-3 rounded border p-3"><summary className="cursor-pointer text-sm font-medium">История изменений бюджета ({campaign.budgetHistory.length})</summary><ul className="mt-2 space-y-1 text-xs">{campaign.budgetHistory.map((entry, index) => <li key={`${entry.changedAt}:${index}`}>{new Date(entry.changedAt).toLocaleString()} · {entry.before.mode === 'unlimited' ? 'без общего предела' : `лимит ${entry.before.maxModelActions}`} → {entry.after.mode === 'unlimited' ? 'без общего предела' : `лимит ${entry.after.maxModelActions}`} · использовано: {entry.modelActionsUsed}</li>)}</ul></details>}
      {campaign.versionState === 'stale' && <p role="alert" className="mt-2 text-sm text-destructive">Хэш версии не совпадает. Эту кампанию нельзя продолжать; исторические записи сохранены.</p>}
    </div>

    <section className="grid gap-4 xl:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.2fr)]" aria-label="Проверки и положение">
      <div className="space-y-2"><h3 className="font-semibold">Положения кампании</h3>{campaign.items.map((item) => <button type="button" key={item.id} onClick={() => onSelectItem(item.id)} aria-pressed={selectedItemId === item.id} className={`block w-full rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedItemId === item.id ? 'border-primary bg-primary/5' : 'bg-card hover:bg-muted/50'}`}><span className="mb-1 flex flex-wrap items-center gap-2"><ObjectTypeBadge kind="position"/><strong className="text-sm font-medium">{item.position.title}</strong></span><span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{item.position.path || 'источник не указан'} <StatusBadge status={item.status} label={labelStatus(item.status)}/></span><span className="mt-1 flex flex-wrap items-center gap-2 text-xs">Автозаключение: <StatusBadge status={item.conclusion} label={labelStatus(item.conclusion)}/></span></button>)}</div>
      <div className="min-w-0 space-y-3">{selectedItem ? <>
        <Card><CardHeader className="pb-2"><CardTitle className="text-base">{selectedItem.position.title}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
          <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2"><div><p className="text-xs font-semibold uppercase text-muted-foreground">1. Исполнение очереди</p><p><StatusBadge status={campaign.status} label={labelStatus(campaign.status)}/> · элемент <StatusBadge status={selectedItem.status} label={labelStatus(selectedItem.status)}/></p></div><div><p className="text-xs font-semibold uppercase text-muted-foreground">2. Обязательные проверки</p><p><StatusBadge status={stageComplete ?? 'unknown'} label={stageComplete === 'complete' ? 'Этапы терминальны' : stageComplete === 'incomplete' ? 'Проверки выполнены не полностью' : 'Состояние не установлено'}/></p></div><div><p className="text-xs font-semibold uppercase text-muted-foreground">3. Автоматическое заключение</p><p><StatusBadge status={selectedItem.conclusion} label={labelStatus(selectedItem.conclusion)}/>{selectedItem.conclusionSummary ? ` · ${selectedItem.conclusionSummary}` : ''}</p></div><div><p className="text-xs font-semibold uppercase text-muted-foreground">4. Решение пользователя</p><p><StatusBadge status={selectedItem.position.status} label={labelStatus(selectedItem.position.status)}/> — статус положения, не автоматически установленный вывод кампании</p></div></div>
          {challengerIncomplete && <div role="status" className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3"><p className="font-semibold">Очередь завершена. Исследование неполное: Challenger не завершён.</p><p className="mt-1 text-sm">Сохранённая причина: {selectedItem.limitations || 'ответ Challenger не получен'}. Следующий шаг — открыть «Процессы и очередь» и создать новое исследование с теми же настройками. Завершённая кампания и её история останутся без изменений.</p><Button className="mt-2" size="sm" variant="outline" onClick={() => onNavigate('processes')}>Открыть «Процессы и очередь»</Button></div>}
          <div><h4 className="font-medium">Состояние каждого обязательного этапа</h4><ul className="mt-1 grid gap-1 text-xs sm:grid-cols-2">{stageStates.map((stage) => <li key={stage.id}>{stage.label}: {labelStatus(stage.status)}</li>)}</ul></div>
          {selectedItem.limitations && <p className="rounded-md border-l-2 border-amber-500 bg-amber-500/5 p-2"><strong>Ограничения:</strong> {selectedItem.limitations}</p>}
          <p className="flex flex-wrap items-center gap-2"><strong>Источники:</strong> <ObjectTypeBadge kind="source"/> {selectedItem.position.path || 'не указаны'} · {selectedItem.position.sourceCount} Fragment</p>
          {positionState && <div className="rounded-md border p-3"><p className="font-medium">Связанные записи</p><div className="mt-2 flex flex-wrap gap-2">{positionState.runIds.map((id) => <Button key={id} size="sm" variant="outline" onClick={() => onRun(id)}>Run {id.slice(0, 8)}</Button>)}{positionState.scenarioIds.map((id) => <Button key={id} size="sm" variant="outline" onClick={() => onScenario(id)}>Scenario {id.slice(0, 8)}</Button>)}{positionState.observationIds.map((id) => <Button key={id} size="sm" variant="outline" onClick={() => onResearchRecord('observation', id, selectedItem.position.id)}>Observation {id.slice(0, 8)}</Button>)}{positionState.openDiscrepancyNoteIds.map((id) => <Button key={id} size="sm" variant="outline" onClick={() => onResearchRecord('discrepancy', id, selectedItem.position.id)}>Расхождение {id.slice(0, 8)}</Button>)}{!positionState.runIds.length && !positionState.scenarioIds.length && !positionState.observationIds.length && !positionState.openDiscrepancyNoteIds.length && <p className="text-xs text-muted-foreground">Связанных Run, Scenario, Observation или расхождения нет.</p>}</div></div>}
          {selectedItem.actions.some((action) => action.sources.length) && <div className="flex flex-wrap gap-2">{[...new Set(selectedItem.actions.flatMap((action) => action.sources.map((source) => source.fragmentId)))].map((id) => <Button key={id} size="sm" variant="outline" onClick={() => onFragment(id)}>Исходный Fragment {id.slice(0, 8)}</Button>)}</div>}
          {selectedItem.scenarios.length > 0 && <div><h4 className="font-medium">Сценарии и критерии</h4><ul className="mt-1 space-y-2">{selectedItem.scenarios.map((scenario) => <li key={scenario.id} className="rounded-md border p-2"><div className="flex flex-wrap items-center justify-between gap-2"><span className="flex flex-wrap items-center gap-2 font-medium"><ObjectTypeBadge kind="scenario"/><StatusBadge status={scenario.status} label={labelStatus(scenario.status)}/>{scenario.title}</span><Button size="sm" variant="outline" onClick={() => onScenario(scenario.id)}>Открыть сценарий</Button></div>{scenario.campaignCheck && <p className="mt-1 text-xs text-muted-foreground">Критерий: {scenario.campaignCheck.criterion} · источники: {scenario.campaignCheck.sources.map((source) => source.path).join(', ') || 'нет'}</p>}</li>)}</ul></div>}
          <div><h4 className="font-medium">Роль и фактический маршрут</h4><ul className="mt-1 space-y-1 text-xs">{selectedItem.actions.map((action) => <li key={action.id} className="break-words rounded border p-2"><strong>{ROLE_NAMES[action.role] ?? action.role}</strong> · {action.actionType} · попытка {action.attempt} · <StatusBadge status={action.status} label={labelStatus(action.status)}/>{action.error && <span className="text-destructive"> · {action.error}</span>}{action.run && <span className="inline-flex flex-wrap items-center gap-1"> · <ObjectTypeBadge kind={action.role === 'evaluator' ? 'evaluation' : 'run'}/> {action.role === 'evaluator' && action.run.verdict && <StatusBadge status={action.run.verdict}/>} подключение {BACKEND_NAMES[action.run.backend ?? ''] ?? action.run.backend ?? 'неизвестно'} / {action.run.connectionName ?? 'неизвестно'} · запрошено {action.run.model ?? 'неизвестно'} · фактически {action.run.actualProvider ?? 'неизвестно'} / {action.run.actualModel ?? 'неизвестно'} · ModelCall {action.run.modelCallId ?? 'не сохранён'}</span>}{action.run && <Button size="sm" variant="link" className="ml-1 h-auto p-0" onClick={() => onRun(action.run!.id)}>Открыть Run и детали</Button>}</li>)}</ul></div>
          <details><summary className="cursor-pointer text-xs font-medium">Технические ID и исходный ответ</summary><div className="mt-2 space-y-2">{selectedItem.actions.map((action) => <div key={action.id} className="rounded border p-2 text-xs"><p className="break-all">Action {action.id} · {action.run?.id ?? 'Run отсутствует'} · ModelCall {action.run?.modelCallId ?? 'не сохранён'}</p>{action.run?.output && <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2">{action.run.output}</pre>}</div>)}</div></details>
        </CardContent></Card>
      </> : <EmptyState title="Выберите положение кампании" hint="Список элементов доступен слева." />}</div>
    </section>

    <section className="rounded-lg border bg-card p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">Назначения в снимке политики</h3><p className="text-xs text-muted-foreground">Это назначение и запрошенная модель, не фактический маршрут ответа.</p></div><Button variant="outline" onClick={() => onNavigate('connections')}>Подключения</Button></div><ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">{providerRoles.map((role) => <li key={role}>{role}</li>)}</ul></section>

    <section className="rounded-lg border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Заметки о ходе исследования</h3><Button variant="outline" aria-pressed={showEvents} onClick={onToggleEvents}>{showEvents ? 'Скрыть события' : 'Показать события'}</Button></div><p className="mt-1 text-xs text-muted-foreground">Opt-in отображение только существующих событий кампании. Дополнительные объяснения не генерируются; если отдельная заметка не сохранена, она не реконструируется.</p>{showEvents && <div className="mt-3 space-y-2">{campaign.items.flatMap((item) => item.actions.map((action) => ({ item, action }))).length ? campaign.items.flatMap((item) => item.actions.map((action) => ({ item, action }))).map(({ item, action }) => <article key={action.id} className="rounded border p-2 text-sm"><p><strong>Событие:</strong> {action.actionType} · {labelStatus(action.status)} · попытка {action.attempt} · {item.position.title}</p><p className="mt-1 text-xs text-muted-foreground">Основание следующего шага: отдельная объясняющая заметка в сохранённых данных отсутствует.</p>{action.error && <p className="mt-1 break-words text-xs text-destructive">Сохранённая ошибка: {action.error}</p>}</article>) : <p className="rounded border border-dashed p-3 text-sm text-muted-foreground">Сохранённых действий пока нет; события появятся после запуска. Это не изменяет кампанию.</p>}</div>}</section>
  </section>
}
