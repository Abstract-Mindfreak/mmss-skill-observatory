'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { campaignResumeBlock, classifyResearchStop } from '@/lib/research-ui-state'

type PreviewPosition = { id: string; title: string; status: string; sourceCount: number; paths: string[] }
type Preview = { projectId: string; versionId: string; versionLabel: string; contentHash: string; sections: string[]; positions: PreviewPosition[] }
type RoleAssignment = { role: string; backend: string | null; connectionId: string | null; connectionName: string | null; model: string | null }
type ActionRow = { id: string; actionType: string; role: string; attempt: number; status: string; error: string | null; run: null | { id: string; status: string; role: string; verdict: string | null; error: string | null; backend: string; connectionName: string | null; model: string | null; actualProvider: string | null; actualModel: string | null; output: string | null } }
type CampaignItem = { id: string; status: string; stage: string; conclusion: string; conclusionSummary: string | null; limitations: string | null; position: { id: string; title: string; path: string; sourceCount: number }; notApplicableChecks?: { id: string; checkType: string; rationale: string }[]; scenarios: { id: string; title: string; status: string; campaignCheck: null | { objective: string; input: string; expectedBehavior: string; criterion: string; sources: { id: string; path: string }[] } }[]; actions: ActionRow[] }
type Campaign = { id: string; contentHash: string; scopeType: string; depth: string; maxModelActions: number | null; modelActionsUsed: number; maxScenariosPerPosition: number; maxRetriesPerAction: number; maxAdditionalChecksPerPosition: number; maxConcurrent?: number; budgetHistory: { changedAt: string; before: { mode: 'limited' | 'unlimited'; maxModelActions: number | null }; after: { mode: 'limited' | 'unlimited'; maxModelActions: number | null }; modelActionsUsed: number }[]; unmappedFragmentsCount: number; status: string; stage: string; pauseReason: string | null; lastError: string | null; versionState: string; roles: { role: string; backend: string; connectionName: string; model: string }[]; items: CampaignItem[] }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
  return body
}

const depthLabels: Record<string, string> = {
  interpretation: 'Точность интерпретации', interactions: 'Интерпретация + взаимодействия',
  scenarios: 'До плана сценариев', full: 'Полный ограниченный цикл',
}
const conclusionLabels: Record<string, string> = {
  'no-issue-in-checked-cases': 'Проблем не обнаружено в выполненных проверках',
  'likely-revision': 'Вероятно требуется правка — нужна ручная проверка',
  'insufficient-data': 'Недостаточно данных', blocked: 'Заблокировано',
  'in-progress': 'Проверяется', 'not-explored': 'Ещё не исследовалось',
}
const stopCauseLabels: Record<string, string> = {
  'policy-budget-exhausted': 'Исчерпан предел действий политики',
  'provider-quota': 'Провайдер сообщил об исчерпании квоты или rate limit',
  'temporary-upstream-error': 'Timeout или временная ошибка upstream',
  'imported-needs-reconciliation': 'Импортированная кампания требует сверки',
  'application-error': 'Ошибка приложения',
  'user-pause': 'Пауза пользователя',
  'user-cancellation': 'Кампания отменена пользователем',
  'version-changed': 'Версия инструкции изменилась',
  unknown: 'Причина остановки не установлена',
}

export function ResearchCampaignPanel({ projectId, versionId }: { projectId: string; versionId: string }) {
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [assignments, setAssignments] = React.useState<RoleAssignment[]>([])
  const [campaigns, setCampaigns] = React.useState<Campaign[]>([])
  const [scopeType, setScopeType] = React.useState<'positions' | 'sections' | 'version'>('positions')
  const [selectedPositions, setSelectedPositions] = React.useState<string[]>([])
  const [selectedSections, setSelectedSections] = React.useState<string[]>([])
  const [positionQuery, setPositionQuery] = React.useState('')
  const [depth, setDepth] = React.useState('full')
  const [maxScenarios, setMaxScenarios] = React.useState(2)
  const [budgetMode, setBudgetMode] = React.useState<'limited' | 'unlimited'>('limited')
  const [maxActions, setMaxActions] = React.useState('20')
  const [maxAdditional, setMaxAdditional] = React.useState(1)
  const [maxRetries, setMaxRetries] = React.useState(3)
  const [stopOnTechError, setStopOnTechError] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [driving, setDriving] = React.useState(false)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [expandedActions, setExpandedActions] = React.useState<Record<string, boolean>>({})
  const driveLock = React.useRef(false)
  const createKey = React.useRef('')

  const refresh = React.useCallback(async () => {
    const [state, roleRows] = await Promise.all([
      request<{ preview: Preview; campaigns: Campaign[] }>(`/api/research-campaign?projectId=${encodeURIComponent(projectId)}&versionId=${encodeURIComponent(versionId)}`),
      request<RoleAssignment[]>(`/api/assignments?projectId=${encodeURIComponent(projectId)}`),
    ])
    setPreview(state.preview)
    setCampaigns(state.campaigns)
    setAssignments(roleRows)
    return state.campaigns
  }, [projectId, versionId])

  React.useEffect(() => {
    let active = true
    void Promise.all([
      request<{ preview: Preview; campaigns: Campaign[] }>(`/api/research-campaign?projectId=${encodeURIComponent(projectId)}&versionId=${encodeURIComponent(versionId)}`),
      request<RoleAssignment[]>(`/api/assignments?projectId=${encodeURIComponent(projectId)}`),
    ]).then(([state, roleRows]) => {
      if (!active) return
      setPreview(state.preview)
      setCampaigns(state.campaigns)
      setAssignments(roleRows)
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { active = false }
  }, [projectId, versionId])

  const selectedRoleNames = React.useMemo(() => {
    const roles = depth === 'full' ? ['interpreter', 'challenger', 'explorer', 'executor', 'evaluator']
      : depth === 'scenarios' ? ['interpreter', 'challenger', 'explorer']
        : depth === 'interactions' ? ['interpreter', 'challenger'] : ['interpreter']
    return roles.map((role) => {
      const row = assignments.find((assignment) => assignment.role === role)
      return { role, text: row?.backend && row.connectionName && row.model ? `${row.backend} · ${row.connectionName} · ${row.model}` : 'назначение отсутствует' }
    })
  }, [assignments, depth])

  const visiblePositions = (preview?.positions ?? []).filter((position) => `${position.title} ${position.paths.join(' ')}`.toLocaleLowerCase().includes(positionQuery.trim().toLocaleLowerCase()))
  const scopeItems = scopeType === 'positions' ? selectedPositions.length : scopeType === 'sections' ? selectedSections.length : preview?.positions.length ?? 0
  const missingRoles = selectedRoleNames.filter(({ role }) => {
    const row = assignments.find((item) => item.role === role)
    return !row?.backend || !row.connectionId || !row.model
  })

  const postAction = React.useCallback(async (campaignId: string, action: string) => request<{ campaign?: Campaign; kind?: string; error?: string }>(
    '/api/research-campaign',
    { method: 'POST', body: JSON.stringify({ projectId, versionId, campaignId, action }) },
  ), [projectId, versionId])

  const drive = React.useCallback(async (campaignId: string) => {
    if (driveLock.current) return
    driveLock.current = true
    setDriving(true)
    setError('')
    try {
      for (;;) {
        const result = await postAction(campaignId, 'advance')
        if (result.campaign) setCampaigns((current) => [result.campaign!, ...current.filter((row) => row.id !== campaignId)])
        if (result.kind === 'waiting') {
          await new Promise((resolve) => window.setTimeout(resolve, 1200))
          continue
        }
        const latest = result.campaign
        if (!latest || latest.status !== 'running') break
      }
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      await refresh().catch(() => undefined)
    } finally {
      driveLock.current = false
      setDriving(false)
    }
  }, [postAction, refresh])

  const startCampaign = async () => {
    if (!preview || busy || driveLock.current) return
    if (!createKey.current) createKey.current = window.crypto.randomUUID().replaceAll('-', '')
    setBusy(true); setError(''); setNotice('')
    try {
      await request<{ campaign: { id: string } }>('/api/research-campaign', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create', projectId, versionId, expectedHash: preview.contentHash, idempotencyKey: createKey.current,
          scope: { type: scopeType, positionIds: selectedPositions, sectionPaths: selectedSections },
          policy: {
            depth, maxScenariosPerPosition: maxScenarios, maxModelActions: budgetMode === 'unlimited' ? null : Number(maxActions),
            maxAdditionalChecksPerPosition: maxAdditional, maxRetriesPerAction: maxRetries,
            maxConcurrent: 1, stopOnQuota: true, stopOnTechnicalError: stopOnTechError,
            allowRewriteExperiment: false,
          },
        }),
      })
      const current = await refresh()
      setNotice('Кампания подготовлена. Модельные действия не запускались; нажмите «Начать выполнение» у этой кампании, чтобы запустить их явно.')
      void current
      createKey.current = ''
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  const control = async (campaign: Campaign, action: 'start' | 'pause' | 'resume' | 'cancel') => {
    setBusy(true); setError('')
    try {
      if (action === 'start' || action === 'resume') {
        await postAction(campaign.id, action)
        await refresh()
        setBusy(false)
        void drive(campaign.id)
      } else {
        await postAction(campaign.id, action)
        await refresh()
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  const toggle = (value: string, values: string[], update: (next: string[]) => void) => update(values.includes(value) ? values.filter((item) => item !== value) : [...values, value])

  return <section className="space-y-5 rounded-lg border bg-card p-4" aria-labelledby="research-campaign-heading">
    <header>
      <h3 id="research-campaign-heading" className="text-lg font-semibold">Автоматическое исследование</h3>
      <p className="mt-1 text-sm text-muted-foreground">Задайте область и пределы один раз. Кампания последовательно проверяет положения, сохраняет каждый Run и останавливается при квоте, ошибке или лимите политики.</p>
    </header>
    {!preview && !error && <p role="status" className="text-sm text-muted-foreground">Загружаю версию и состав области…</p>}
    {preview && <>
      <div className="rounded-md border p-3 text-sm">
        <p><strong>Проект:</strong> {projectId} · <strong>версия:</strong> {preview.versionId} ({preview.versionLabel})</p>
        <p className="mt-1 break-all text-xs text-muted-foreground"><strong>SHA-256:</strong> {preview.contentHash}</p>
        <p className="mt-1 text-xs text-muted-foreground">Положений в версии: {preview.positions.length} · исходных Fragment: {preview.sections.length ? 'размечены по разделам' : '0'}. Просмотр этого блока не создаёт Scenario, Run или ModelCall.</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-2 rounded-md border p-3">
          <h4 className="font-medium">1. Область исследования</h4>
          <div className="flex flex-wrap gap-2">
            {([['positions', 'Конкретные положения'], ['sections', 'Разделы'], ['version', 'Вся версия']] as const).map(([value, label]) => <Button key={value} type="button" size="sm" variant={scopeType === value ? 'default' : 'outline'} onClick={() => setScopeType(value)}>{label}</Button>)}
          </div>
          {scopeType === 'positions' && <>
            <Input aria-label="Поиск положения в области кампании" value={positionQuery} onChange={(event) => setPositionQuery(event.target.value)} placeholder="Фильтр по названию или path" />
            <div className="max-h-64 space-y-1 overflow-auto rounded border p-2">
              {visiblePositions.map((position) => <label key={position.id} className="flex cursor-pointer gap-2 border-b py-1.5 text-sm last:border-0">
                <input type="checkbox" checked={selectedPositions.includes(position.id)} onChange={() => toggle(position.id, selectedPositions, setSelectedPositions)} />
                <span><strong>{position.title}</strong><span className="block text-xs text-muted-foreground">{position.paths.join(', ') || 'без источника'} · {position.sourceCount} Fragment · {position.id}</span></span>
              </label>)}
            </div>
            <p className="text-xs text-muted-foreground">Выбрано: {selectedPositions.length}. В кампанию войдут только показанные положения и их источники.</p>
          </>}
          {scopeType === 'sections' && <div className="max-h-56 space-y-1 overflow-auto rounded border p-2">
            {preview.sections.map((path) => <label key={path} className="flex gap-2 py-1 text-sm"><input type="checkbox" checked={selectedSections.includes(path)} onChange={() => toggle(path, selectedSections, setSelectedSections)} /><span>Раздел {path}</span></label>)}
          </div>}
          {scopeType === 'version' && <p className="text-sm text-muted-foreground">В область войдут все {preview.positions.length} положений версии. Неразобранные содержательные Fragment останутся видимым пробелом покрытия.</p>}
          {scopeItems > 0 && <p className="rounded bg-muted p-2 text-xs">{budgetMode === 'unlimited' ? 'Общий предел текстовых действий не задан. Работа продолжится до завершения выбранной конечной области, паузы, отмены или блокировки.' : `Ограниченный бюджет: не более ${maxActions || '—'} текстовых действий. Фактическое число зависит от результатов и адаптивных проверок.`} Отдельные лимиты этапов и число будущих действий заранее неизвестны.</p>}
        </div>

        <div className="space-y-3 rounded-md border p-3">
          <h4 className="font-medium">2. Политика запуска</h4>
          <label className="block space-y-1 text-sm">Глубина проверки
            <select className="h-9 w-full rounded-md border bg-background px-2" value={depth} onChange={(event) => setDepth(event.target.value)}>
              {Object.entries(depthLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {depth === 'full' && <label className="block space-y-1 text-sm">Максимум сценариев на положение
            <select className="h-9 w-full rounded-md border bg-background px-2" value={maxScenarios} onChange={(event) => setMaxScenarios(Number(event.target.value))}><option value={1}>1</option><option value={2}>2</option></select>
          </label>}
          <label className="block space-y-1 text-sm">Общий предел действий
            <select className="h-9 w-full rounded-md border bg-background px-2" value={budgetMode} onChange={(event) => setBudgetMode(event.target.value as 'limited' | 'unlimited')}><option value="limited">Ограниченный</option><option value="unlimited">Без общего предела</option></select>
          </label>
          {budgetMode === 'limited' ? <label className="block space-y-1 text-sm">Предел текстовых действий кампании
            <input className="h-9 w-full rounded-md border bg-background px-2" type="number" inputMode="numeric" min={1} step={1} value={maxActions} onChange={(event) => setMaxActions(event.target.value)} aria-invalid={!Number.isSafeInteger(Number(maxActions)) || Number(maxActions) < 1} />
            <span className="block text-xs text-muted-foreground">Положительное безопасное целое число до {Number.MAX_SAFE_INTEGER}; 20 остаётся исходным значением.</span>
          </label> : <p className="rounded border border-amber-500/50 bg-amber-500/10 p-2 text-sm">Без общего предела кампания идёт до завершения выбранной области, паузы, отмены или блокировки. Отдельные пределы, до 3 попыток на действие и конкурентность 1 сохраняются.</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">Дополнительных проверок на положение
              <select className="h-9 w-full rounded-md border bg-background px-2" value={maxAdditional} onChange={(event) => setMaxAdditional(Number(event.target.value))}><option value={0}>0</option><option value={1}>1</option></select>
            </label>
            <label className="block space-y-1 text-sm">Попыток на действие, всего
              <select className="h-9 w-full rounded-md border bg-background px-2" value={maxRetries} onChange={(event) => setMaxRetries(Number(event.target.value))}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select>
            </label>
          </div>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked readOnly /> Дневная квота: поставить кампанию на паузу</label>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={stopOnTechError} onChange={(event) => setStopOnTechError(event.target.checked)} /> Остановиться при технической ошибке</label>
          <p className="text-xs text-muted-foreground">Конкурентность — 1. Экспериментальная правка запрещена. Подключения фиксируются в снимке политики.</p>
          <div className="rounded border p-2 text-xs"><strong>Назначения кампании:</strong>
            <ul className="mt-1 space-y-1">{selectedRoleNames.map(({ role, text }) => <li key={role}>{role}: {text}</li>)}</ul>
          </div>
          {missingRoles.length > 0 && <p className="text-sm text-destructive">Не назначены необходимые роли: {missingRoles.map(({ role }) => role).join(', ')}. Настройте их в «Подключениях».</p>}
          <Button type="button" disabled={busy || driving || !scopeItems || missingRoles.length > 0 || !preview.contentHash || budgetMode === 'limited' && (!Number.isSafeInteger(Number(maxActions)) || Number(maxActions) < 1)} onClick={() => void startCampaign()}>
            {busy ? 'Сохраняю настройку…' : 'Проверить и создать кампанию'}
          </Button>
        </div>
      </div>

      {notice && <p role="status" className="rounded border border-emerald-700/40 p-3 text-sm">{notice}</p>}
      {error && <p role="alert" className="rounded border border-destructive/50 p-3 text-sm">{error}</p>}
      <div className="space-y-3">
        <h4 className="font-medium">Сохранённые кампании</h4>
        {!campaigns.length && <p className="rounded border border-dashed p-3 text-sm text-muted-foreground">Кампаний для этой версии пока нет. Загрузка списка не запускает исследовательские действия.</p>}
        {campaigns.map((campaign) => <article key={campaign.id} className="space-y-3 rounded-md border p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h5 className="font-medium">{campaign.id} · {campaign.status}</h5><p className="text-xs text-muted-foreground">{depthLabels[campaign.depth] ?? campaign.depth} · {campaign.items.length} положений · {campaign.maxModelActions == null ? `Выполнено ${campaign.modelActionsUsed} действий · общий предел не задан` : `Выполнено ${campaign.modelActionsUsed} из ${campaign.maxModelActions} текстовых действий`} · {campaign.unmappedFragmentsCount} не сопоставленных Fragment</p></div>
            <div className="flex gap-2">
              {campaign.status === 'prepared' && <Button size="sm" disabled={busy || Boolean(campaignResumeBlock({ ...campaign, latestFailedAttempt: null }))} onClick={() => void control(campaign, 'start')}>Начать выполнение</Button>}
              {campaign.status === 'running' && <Button size="sm" variant="outline" disabled={busy || driving} onClick={() => void control(campaign, 'pause')}>Пауза</Button>}
              {campaign.status === 'paused' && <Button size="sm" disabled={busy || Boolean(campaignResumeBlock({ ...campaign, latestFailedAttempt: Math.max(-1, ...campaign.items.flatMap((item) => item.actions.filter((row) => row.status === 'failed').map((row) => row.attempt))) }))} onClick={() => void control(campaign, 'resume')}>Возобновить</Button>}
              {['running', 'paused'].includes(campaign.status) && <Button size="sm" variant="outline" disabled={busy || driving} onClick={() => void control(campaign, 'cancel')}>Отменить</Button>}
            </div>
          </div>
          {campaign.versionState === 'stale' && <p role="alert" className="text-sm text-destructive">SHA-256 версии изменился; продолжение запрещено.</p>}
          {campaign.pauseReason && <div className="rounded bg-amber-500/10 p-2 text-sm"><p><strong>Причина:</strong> {stopCauseLabels[classifyResearchStop(campaign.pauseReason, campaign.lastError)] ?? 'Причина не установлена'}</p>{campaign.lastError && <p className="mt-1 break-words">Исходная ошибка: {campaign.lastError}</p>}<p className="mt-1 text-xs">{campaign.maxModelActions == null ? `Выполнено ${campaign.modelActionsUsed} действий; общий предел не задан.` : `Выполнено ${campaign.modelActionsUsed} из ${campaign.maxModelActions} текстовых действий.`} Возобновление не сбрасывает использованный бюджет.</p></div>}
          {campaign.budgetHistory.length > 0 && <details className="rounded border p-2"><summary className="cursor-pointer text-xs font-medium">История изменений бюджета ({campaign.budgetHistory.length})</summary><ul className="mt-2 space-y-1 text-xs">{campaign.budgetHistory.map((entry, index) => <li key={`${entry.changedAt}:${index}`}>{new Date(entry.changedAt).toLocaleString()} · {entry.before.mode === 'unlimited' ? 'без общего предела' : `лимит ${entry.before.maxModelActions}`} → {entry.after.mode === 'unlimited' ? 'без общего предела' : `лимит ${entry.after.maxModelActions}`} · использовано: {entry.modelActionsUsed}</li>)}</ul></details>}
          <div className="space-y-2">
            {campaign.items.map((item) => <details key={item.id} className="rounded border p-3">
              <summary className="cursor-pointer text-sm font-medium">{item.position.title} · {conclusionLabels[item.conclusion] ?? item.conclusion} · {item.status}</summary>
              <p className="mt-2 text-sm">{item.conclusionSummary ?? item.limitations ?? 'Основания ещё не сохранены.'}</p>
              <p className="text-xs text-muted-foreground">Источники: {item.position.path || 'нет'} · статусные решения SemanticPosition не меняются.</p>
              {item.notApplicableChecks?.map((entry) => <p key={entry.id} className="mt-1 text-xs text-muted-foreground">Не применимо — {entry.checkType}: {entry.rationale}</p>)}
              <div className="mt-3 space-y-2">
                {item.scenarios.map((scenario) => <div key={scenario.id} className="rounded bg-muted p-2 text-xs">
                  <strong>{scenario.title}</strong> · {scenario.status}
                  {scenario.campaignCheck && <><p>Цель: {scenario.campaignCheck.objective}</p><p>Вход: {scenario.campaignCheck.input}</p><p>Критерий: {scenario.campaignCheck.criterion}</p><p>Ожидание: {scenario.campaignCheck.expectedBehavior}</p><p>Источники: {scenario.campaignCheck.sources.map((source) => source.path).join(', ')}</p></>}
                </div>)}
                {item.actions.map((action) => <div key={action.id} className="rounded border bg-background p-2 text-xs">
                  <div><strong>{action.actionType}</strong> · {action.role} · попытка {action.attempt} · {action.status}
                    {action.run && <> · {action.run.backend} / {action.run.connectionName} · requested {action.run.model} · actual {action.run.actualProvider ?? 'unknown'} / {action.run.actualModel ?? 'unknown'} · verdict {action.run.verdict ?? '—'}</>}
                  </div>
                  {action.error && <p className="mt-1 text-destructive">{action.error}</p>}
                  {action.run?.output && <><Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => setExpandedActions((current) => ({ ...current, [action.id]: !current[action.id] }))}>{expandedActions[action.id] ? 'Скрыть ответ' : 'Показать ответ'}</Button>{expandedActions[action.id] && <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2">{action.run.output}</pre>}</>}
                </div>)}
              </div>
            </details>)}
          </div>
        </article>)}
      </div>
    </>}
  </section>
}
