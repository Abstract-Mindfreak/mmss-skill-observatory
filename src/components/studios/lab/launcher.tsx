// Запуск роли (ТЗ п.9): форма с ролями, сценарием, задачей и
// расширенными параметрами. POST /api/runs выполняется синхронно —
// оверлей с таймером; ошибки честные (RU с бэкенда).
'use client'

import * as React from 'react'
import { ChevronRight, Loader2, Play, Settings2, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ErrorState } from '@/components/shared/states'
import { StatusBadge } from '@/components/shared/status-badges'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api-client'
import { useStore } from '@/lib/store'
import { ROLE_TITLES } from '@/lib/types'
import type { RoleId } from '@/lib/types'
import { BackendPicker, BACKEND_NONE, type PickerState } from './backend-picker'
import { cn } from '@/lib/utils'
import { InstructionContextSelector } from '@/components/shared/instruction-context-selector'
import { RolePromptPreview } from '@/components/shared/role-prompt-preview'
import type { InstructionContextSelection } from '@/lib/instruction-context'
import { TaskMaterialFragmentPicker } from '@/components/shared/task-material-fragment-picker'

const LAUNCH_ROLES: RoleId[] = ['executor', 'explorer', 'evaluator', 'challenger', 'editor']

const PROMPT_META: Record<string, { label: string; hint: string; placeholder: string }> = {
  executor: {
    label: 'Задача для исполнителя',
    hint: 'При выборе сценария подставляется его заголовок и описание — отредактируйте при необходимости.',
    placeholder: 'Сформулируйте задачу: что должен выполнить агент по скиллу…',
  },
  explorer: {
    label: 'Запрос исследователю',
    hint: 'Что исследовать. Для роста дерева сценариев есть отдельная кнопка в Scenario Tree.',
    placeholder: 'например: где инструкция позволяет подменить измерение значением unknown…',
  },
  challenger: {
    label: 'Цель критики',
    hint: 'Находка или вердикт, которые нужно попытаться опровергнуть.',
    placeholder: 'Вставьте находку/вердикт для опровержения…',
  },
  editor: {
    label: 'Проблема для правки',
    hint: 'Опишите проблему — Editor предложит минимальную правку текста.',
    placeholder: 'например: «known» в §6.2 не определено и мешает…',
  },
}

interface ResolvedBackend {
  backend: 'ollama' | 'freellmapi'
  connectionId: string | null
  model: string | null
  source: 'assignment' | 'override'
}

export function RunLauncher() {
  const { toast } = useToast()
  const appState = useStore((s) => s.appState)
  const activeDocVersion = appState?.activeVersion ?? null
  const sessionCloud = useStore((s) => s.sessionCloud)
  const refresh = useStore((s) => s.refresh)
  const selectRun = useStore((s) => s.selectRun)
  const selectScenario = useStore((s) => s.selectScenario)
  const storeScenarioId = useStore((s) => s.selectedScenarioId)

  const [role, setRole] = React.useState<RoleId>('executor')
  const [prompt, setPrompt] = React.useState('')
  const [skillContextMode, setSkillContextMode] = React.useState<'full' | 'relevant'>('full')
  const [criterion, setCriterion] = React.useState('')
  const [outputToEvaluate, setOutputToEvaluate] = React.useState('')
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const [temperature, setTemperature] = React.useState('0.3')
  const [numPredict, setNumPredict] = React.useState('')
  const [timeoutMs, setTimeoutMs] = React.useState('120000')
  const [programChecks, setProgramChecks] = React.useState(true)
  const [instructionContext, setInstructionContext] = React.useState<InstructionContextSelection>({ mode: 'full', versionId: null, fragmentIds: [], includeParentSections: false })
  const [taskFragmentId, setTaskFragmentId] = React.useState<string | null>(null)
  const [series, setSeries] = React.useState(1)
  const [override, setOverride] = React.useState<PickerState>({ none: BACKEND_NONE })
  const [busy, setBusy] = React.useState(false)
  const [elapsed, setElapsed] = React.useState(0)
  const [lastError, setLastError] = React.useState<string | null>(null)

  const scenarios = appState?.scenarios ?? []
  const storeScenarioOk = scenarios.some((s) => s.id === storeScenarioId)
  const scenario = storeScenarioOk ? scenarios.find((s) => s.id === storeScenarioId) ?? null : null
  const versions = (appState?.documents ?? []).flatMap((document) => document.versions.map((version) => ({ version, documentTitle: document.title })))

  React.useEffect(() => {
    const defaultMode = role === 'executor' ? 'full' : 'none'
    setInstructionContext((current) => ({ ...current, mode: defaultMode, versionId: current.versionId ?? activeDocVersion?.id ?? null, fragmentIds: [] }))
  }, [role, activeDocVersion?.id])

  // latest completed real executor output for the scenario (evaluator prefill)
  const latestExecutorOutput = React.useMemo(() => {
    if (!scenario) return null
    const r = (appState?.runs ?? []).find(
      (x) => x.scenarioId === scenario.id && x.role === 'executor' && x.status === 'completed' && x.origin === 'real'
    )
    return r?.output ?? null
  }, [appState?.runs, scenario])

  // auto-prefill without clobbering manual edits
  const lastAuto = React.useRef({ prompt: '', criterion: '', output: '' })
  React.useEffect(() => {
    if (!scenario) return
    const titleDesc = scenario.description ? `${scenario.title}\n\n${scenario.description}` : scenario.title
    if (role === 'executor' && (prompt === '' || prompt === lastAuto.current.prompt)) {
      setPrompt(titleDesc)
      lastAuto.current.prompt = titleDesc
    } else if (role === 'executor') {
      lastAuto.current.prompt = titleDesc
    }
    if (role === 'evaluator') {
      if (criterion === '' || criterion === lastAuto.current.criterion) {
        setCriterion(titleDesc)
        lastAuto.current.criterion = titleDesc
      } else {
        lastAuto.current.criterion = titleDesc
      }
      if (outputToEvaluate === '' || outputToEvaluate === lastAuto.current.output) {
        if (latestExecutorOutput) {
          setOutputToEvaluate(latestExecutorOutput)
          lastAuto.current.output = latestExecutorOutput
        }
      } else if (latestExecutorOutput) {
        lastAuto.current.output = latestExecutorOutput
      }
    }
  }, [scenario?.id, role, latestExecutorOutput])

  // elapsed timer
  React.useEffect(() => {
    if (!busy) return
    setElapsed(0)
    const t0 = performance.now()
    const iv = setInterval(() => setElapsed((performance.now() - t0) / 1000), 100)
    return () => clearInterval(iv)
  }, [busy])

  // ---------- backend resolution ----------
  const resolved: ResolvedBackend | null = React.useMemo(() => {
    if ('mode' in override) {
      return { backend: override.mode, connectionId: override.connectionId, model: override.model, source: 'override' }
    }
    const a = appState?.assignments.find((x) => x.role === role)
    if ((a?.backend === 'ollama' || a?.backend === 'freellmapi') && a.connectionId && a.model)
      return { backend: a.backend, connectionId: a.connectionId, model: a.model, source: 'assignment' }
    return null
  }, [override, appState?.assignments, role])

  // ---------- validation ----------
  const parsedTemp = Number(temperature)
  const tempOk = temperature.trim() !== '' && Number.isFinite(parsedTemp) && parsedTemp >= 0 && parsedTemp <= 1
  const parsedPredict = numPredict.trim() === '' ? null : Number(numPredict)
  const predictOk = parsedPredict === null || (Number.isInteger(parsedPredict) && parsedPredict > 0)
  const parsedTimeout = Number(timeoutMs)
  const timeoutOk = Number.isInteger(parsedTimeout) && parsedTimeout >= 1000 && parsedTimeout <= 600000

  const blockReasons: string[] = []
  if (!appState?.project) blockReasons.push('Нет активного проекта')
  if (!resolved) blockReasons.push('Для этой роли не назначено пригодное подключение. Выберите FreeLLMAPI или Ollama в «Подключениях» либо вручную.')
  else if (!resolved.connectionId || !resolved.model)
    blockReasons.push(`Для ${resolved.backend === 'freellmapi' ? 'FreeLLMAPI' : 'Ollama'} укажите подключение и модель`)
  if (role === 'executor' && !prompt.trim() && !scenario?.description)
    blockReasons.push('Для executor укажите задачу или выберите сценарий с описанием')
  if (role === 'executor' && !activeDocVersion)
    blockReasons.push('Нет активной версии скилла в проекте')
  if ((role === 'explorer' || role === 'challenger' || role === 'editor') && !prompt.trim())
    blockReasons.push(`Опишите задачу (prompt) для роли «${ROLE_TITLES[role]}»`)
  if (role === 'editor' && !taskFragmentId) blockReasons.push('Выберите обязательный редактируемый фрагмент для Editor')
  if (role === 'evaluator') {
    if (!scenario && (!criterion.trim() || !outputToEvaluate.trim()))
      blockReasons.push('Для evaluator укажите критерий и результат для оценки (или выберите сценарий)')
    if (scenario && !outputToEvaluate.trim() && !latestExecutorOutput)
      blockReasons.push('У сценария нет завершённого executor-запуска — вставьте результат для оценки вручную')
  }
  if (!tempOk) blockReasons.push('Температура — число от 0 до 1')
  if (!predictOk) blockReasons.push('numPredict — положительное целое число')
  if (!timeoutOk) blockReasons.push('timeoutMs — целое число миллисекунд (1000…600000)')
  const blocked = blockReasons.length > 0

  // ---------- submit ----------
  const launch = async () => {
    if (!appState?.project || !resolved || blocked) return
    setBusy(true)
    setLastError(null)
    try {
      const res = await api.createRun({
        projectId: appState.project.id,
        role,
        backend: resolved.backend,
        connectionId: resolved.connectionId ?? undefined,
        model: resolved.model ?? undefined,
        fragmentId: ['editor', 'challenger'].includes(role) ? taskFragmentId ?? undefined : undefined,
        scenarioId: scenario?.id,
        prompt: prompt.trim() || undefined,
        settings: {
          temperature: tempOk ? parsedTemp : undefined,
          numPredict: predictOk && parsedPredict !== null ? parsedPredict : undefined,
          timeoutMs: timeoutOk ? parsedTimeout : 120000,
          programChecks,
        },
        taskContext:
          role === 'evaluator' || role === 'executor' || role === 'explorer' || role === 'challenger' || role === 'editor'
            ? {
                scenarioId: scenario?.id,
                criterion: criterion.trim() || undefined,
                outputToEvaluate: outputToEvaluate.trim() || undefined,
                fragmentId: ['editor', 'challenger'].includes(role) ? taskFragmentId ?? undefined : undefined,
                instructionContext,
              }
            : undefined,
        versionId: instructionContext.versionId ?? undefined,
        series: series > 1 ? { count: series } : undefined,
      })
      const runs = res.runs
      const failed = runs.filter((r) => r.status === 'failed')
      const completed = runs.filter((r) => r.status === 'completed')
      const last = runs[runs.length - 1]
      if (last) selectRun(last.id)
      await refresh()
      if (failed.length === runs.length) {
        setLastError(failed[failed.length - 1]?.error ?? 'Все запуски завершились ошибкой')
        toast({ title: 'Запуски завершились ошибкой', variant: 'destructive' })
      } else {
        toast({
          title: failed.length
            ? 'Серия выполнена частично'
            : runs.length > 1 ? 'Серия выполнена' : 'Запуск выполнен',
          description: `Завершено: ${completed.length} · ошибок: ${failed.length}${failed.length ? ' — детали в карточке запуска' : ''}`,
          variant: failed.length ? 'destructive' : 'default',
        })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Не удалось выполнить запуск'
      setLastError(msg)
      toast({ title: 'Запуск не выполнен', description: msg, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  // ---------- render helpers ----------
  const resolvedLabel = resolved
    ? `${resolved.backend === 'freellmapi' ? 'FreeLLMAPI' : 'Ollama'} · ${appState?.connections.find((c) => c.id === resolved.connectionId)?.name ?? '—'}${resolved.model ? ` · ${resolved.model}` : ''}`
    : '—'
  const activeDocumentTitle = activeDocVersion
    ? appState?.documents.find((doc) => doc.id === activeDocVersion.documentId)?.title
    : null
  const sourceNote =
    resolved?.source === 'assignment'
      ? 'по назначению роли'
      : resolved?.source === 'override'
        ? 'выбрано вручную'
        : resolved
          ? 'роль не назначена — выберите подключение'
          : 'нет доступного бэкенда'
  const promptMeta = PROMPT_META[role]

  return (
    <Card className="relative border-border/70">
      <CardHeader className="gap-1 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Play className="size-4 text-primary" aria-hidden />
          Запуск роли
          <StatusBadge status="LIVE" withHint={false} className="ml-auto" />
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Выполнение синхронное: реальный вызов модели, статус выполнения ≠ вердикт проверки.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* role + scenario */}
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="min-w-0 space-y-1">
            <Label className="text-xs text-muted-foreground">Роль</Label>
            <Select value={role} onValueChange={(v) => setRole(v as RoleId)}>
              <SelectTrigger size="sm" className="h-8 w-full text-xs" aria-label="Роль">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {LAUNCH_ROLES.map((r) => (
                    <SelectItem key={r} value={r} className="text-xs">
                      {ROLE_TITLES[r]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-1">
            <Label className="text-xs text-muted-foreground">Сценарий (необязательно)</Label>
            <Select
              value={scenario?.id ?? 'none'}
              onValueChange={(v) => selectScenario(v === 'none' ? null : v)}
            >
              <SelectTrigger size="sm" className="h-8 w-full text-xs" aria-label="Сценарий">
                <SelectValue placeholder="Без сценария" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">
                  Без сценария
                </SelectItem>
                <SelectGroup>
                  {scenarios.slice(0, 200).map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">
                      {s.origin === 'demo' ? '[DEMO] ' : ''}
                      {s.title.length > 60 ? s.title.slice(0, 60) + '…' : s.title}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* prompt / evaluator fields */}
        {role === 'evaluator' ? (
          <div className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor="ln-criterion" className="text-xs">
                Критерий оценки
              </Label>
              <Textarea
                id="ln-criterion"
                value={criterion}
                onChange={(e) => setCriterion(e.target.value)}
                placeholder="Что считается правильным результатом…"
                className="min-h-16 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                При выбранном сценарии подставляется его заголовок и описание; если оставить пустым — сервер возьмёт
                их сам.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ln-output" className="text-xs">
                Результат для оценки (вывод executor)
              </Label>
              <Textarea
                id="ln-output"
                value={outputToEvaluate}
                onChange={(e) => setOutputToEvaluate(e.target.value)}
                placeholder={latestExecutorOutput ? '' : 'Вставьте вывод, который нужно оценить…'}
                className="min-h-24 font-mono text-[11px]"
              />
              <p className="text-[10px] text-muted-foreground">
                {scenario
                  ? latestExecutorOutput
                    ? 'Подставлен последний завершённый executor-запуск этого сценария (origin=real).'
                    : 'У сценария нет завершённого executor-запуска — вставьте результат вручную.'
                  : 'Без сценария нужно указать результат вручную.'}
              </p>
            </div>
          </div>
        ) : (
          role === 'executor' ? (
            <div className="space-y-2">
              <div className="space-y-1">
                <Label htmlFor="ln-prompt" className="text-xs">{promptMeta.label}</Label>
                <Textarea id="ln-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={promptMeta.placeholder} className="min-h-20 text-xs leading-relaxed" />
                <p className="text-[10px] text-muted-foreground">{promptMeta.hint}</p>
              </div>
            </div>
          ) : (
          <div className="space-y-1">
            <Label htmlFor="ln-prompt" className="text-xs">
              {promptMeta.label}
            </Label>
            <Textarea
              id="ln-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={promptMeta.placeholder}
              className="min-h-20 text-xs leading-relaxed"
            />
            <p className="text-[10px] text-muted-foreground">{promptMeta.hint}</p>
          </div>
          )
        )}

        {role === 'editor' && <TaskMaterialFragmentPicker versionId={instructionContext.versionId} value={taskFragmentId} onChange={(id) => setTaskFragmentId(id)} label="Обязательный редактируемый фрагмент" required />}
        {role === 'challenger' && <TaskMaterialFragmentPicker versionId={instructionContext.versionId} value={taskFragmentId} onChange={(id) => setTaskFragmentId(id)} label="Дополнительный оспариваемый фрагмент" />}
        <InstructionContextSelector value={instructionContext} onChange={setInstructionContext} versions={versions} disabled={busy} />
        <RolePromptPreview projectId={appState?.project?.id ?? null} role={role} contextSelection={instructionContext} scenarioId={role === 'evaluator' || role === 'explorer' ? scenario?.id : undefined} fragmentId={['editor', 'challenger'].includes(role) ? taskFragmentId ?? undefined : undefined} promptContext={{ task: role === 'evaluator' ? (scenario ? `Оценка результата сценария «${scenario.title}»` : 'Оценка сохранённого результата') : prompt, criterion, outputToEvaluate }} />

        {/* advanced */}
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border bg-muted/30 px-3 py-1.5 text-xs hover:bg-muted/60">
            <span className="flex items-center gap-1.5">
              <Settings2 className="size-3.5" aria-hidden />
              Расширенные параметры
            </span>
            <ChevronRight className={cn('size-3.5 transition-transform', advancedOpen && 'rotate-90')} aria-hidden />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 space-y-3 rounded-md border bg-card/40 p-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label htmlFor="ln-temp" className="text-[11px] text-muted-foreground">
                    Температура (0..1)
                  </Label>
                  <Input
                    id="ln-temp"
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ln-predict" className="text-[11px] text-muted-foreground">
                    numPredict
                  </Label>
                  <Input
                    id="ln-predict"
                    type="number"
                    min={1}
                    placeholder="по умолчанию"
                    value={numPredict}
                    onChange={(e) => setNumPredict(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ln-timeout" className="text-[11px] text-muted-foreground">
                    timeoutMs
                  </Label>
                  <Input
                    id="ln-timeout"
                    type="number"
                    min={1000}
                    step={1000}
                    value={timeoutMs}
                    onChange={(e) => setTimeoutMs(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ln-series" className="text-[11px] text-muted-foreground">
                    Серия запусков (1..10)
                  </Label>
                  <Input
                    id="ln-series"
                    type="number"
                    min={1}
                    max={10}
                    value={series}
                    onChange={(e) => setSeries(Math.min(10, Math.max(1, Math.round(Number(e.target.value) || 1))))}
                    className="h-8 text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground">Ограниченная серия: последовательные запуски.</p>
                </div>
              </div>

              <div className="flex items-start justify-between gap-3 rounded-md border p-2">
                <div className="space-y-0.5">
                  <Label htmlFor="ln-checks" className="flex items-center gap-2 text-xs">
                    Локальные программные проверки
                    <StatusBadge status="LOCAL" withHint={false} />
                  </Label>
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    Локальная проверка JSON: синтаксис, NaN/Infinity, дубликаты ключей. Действует только для роли
                    executor после выполнения.
                  </p>
                </div>
                <Switch id="ln-checks" checked={programChecks} onCheckedChange={setProgramChecks} />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Бэкенд (по умолчанию — назначение роли)</Label>
                <BackendPicker
                  idPrefix="ln"
                  value={override}
                  onChange={(v) => setOverride(v as PickerState)}
                  connections={appState?.connections ?? []}
                  sessionCloud={sessionCloud ?? appState?.sessionCloud ?? null}
                  allowFreeLLMAPI
                  noneOption={{ value: BACKEND_NONE, label: 'По назначению роли' }}
                  compact
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* resolved + cost + error */}
        <div className="space-y-1.5 rounded-md border bg-muted/30 p-2 text-xs">
          <p>
            <span className="text-muted-foreground">Документ и версия: </span>
            <span className="font-medium">{role === 'executor' ? activeDocVersion ? `${activeDocumentTitle ?? 'Документ'} · ${activeDocVersion.label}` : 'нет активной версии' : 'не используется'}</span>
          </p>
          {role === 'executor' && (
            <p>
              <span className="text-muted-foreground">Контекст: </span>{instructionContext.mode} · {instructionContext.versionId ?? 'версия не выбрана'}
            </p>
          )}
          <p>
            <span className="text-muted-foreground">Провайдер и модель: </span>
            <span className="font-mono">{resolvedLabel}</span>{' '}
            <span className="text-[10px] text-muted-foreground">({sourceNote})</span>
          </p>
          <p>
            <span className="text-muted-foreground">Будет выполнено </span>~{series}{' '}
            {series === 1 ? 'запрос' : series < 5 ? 'запроса' : 'запросов'}
            <span className="text-muted-foreground"> к </span>
            <span className="font-mono">{resolvedLabel}</span>
            {series > 1 && <span className="text-[10px] text-muted-foreground"> — последовательно, одним запросом на каждый</span>}
          </p>
        </div>

        {lastError && <ErrorState error={lastError} title="Запуск не выполнен" />}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-72 text-[10px] leading-snug text-muted-foreground">
            {blocked ? blockReasons[0] : 'Статус выполнения ≠ вердикт: завершённый запуск может содержать дефект.'}
          </p>
          <Button size="sm" className="gap-1.5" disabled={blocked} onClick={() => void launch()}>
            <Play className="size-3.5" aria-hidden />
            Запустить
          </Button>
        </div>
      </CardContent>

      {/* busy overlay */}
      {busy && (
        <div
          role="alertdialog"
          aria-label="Выполняется запуск"
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-lg border border-primary/30 bg-background/90 p-4 text-center backdrop-blur-sm"
        >
          <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
          <p className="text-sm font-medium">
            Модель работает{series > 1 ? ` — серия из ${series} запусков` : ''}…
          </p>
          <p className="font-mono text-xs text-muted-foreground">{elapsed.toFixed(1)} с</p>
          <p className="max-w-64 text-[11px] leading-snug text-muted-foreground">
            Не закрывайте страницу: запрос выполняется синхронно, до {Math.round(Number(timeoutMs) / 1000)} с на
            запуск. Прогресс по отдельным шагам не транслируется.
          </p>
          {role === 'executor' && programChecks && (
            <p className="max-w-64 text-[10px] leading-snug text-muted-foreground">
              <Info className="mr-1 inline size-3" aria-hidden />
              После выполнения будет запущена локальная проверка JSON (LOCAL).
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
