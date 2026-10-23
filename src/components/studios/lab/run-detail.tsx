// Детали запуска: полный вход/выход, локальные программные проверки,
// вердикт (с перезаписью пользователем), разногласия оценщиков,
// связи со сценарием и родительским запуском, повтор и копирование.
'use client'

import * as React from 'react'
import {
  Bot,
  Check,
  ChevronRight,
  ExternalLink,
  Info,
  ListTree,
  Loader2,
  RefreshCw,
  TriangleAlert,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { CopyButton } from '@/components/shared/copy'
import { JsonView, KV } from '@/components/shared/misc'
import { ErrorState } from '@/components/shared/states'
import { OriginBadge, RunStatusBadge, StatusBadge, VerdictBadge } from '@/components/shared/status-badges'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api-client'
import { useStore } from '@/lib/store'
import { ROLE_TITLES, SCENARIO_STATUS_TITLES } from '@/lib/types'
import type { RunDTO, Verdict } from '@/lib/types'
import { EvaluateDialog } from './evaluate-dialog'
import {
  backendModelLabel,
  byLabel,
  fmtDuration,
  fmtTime,
  roleShort,
  runCardMarkdown,
  runChatReportMarkdown,
  RUN_STATUS_LABELS,
  tryPrettyJson,
  verdictLabel,
} from './format'
import { cn } from '@/lib/utils'
import { parseResearchDiscrepancy } from '@/lib/research-discrepancy'

export function RunDetail({ runId }: { runId: string | null }) {
  const { toast } = useToast()
  const appState = useStore((s) => s.appState)
  const refresh = useStore((s) => s.refresh)
  const selectRun = useStore((s) => s.selectRun)
  const selectScenario = useStore((s) => s.selectScenario)
  const setStudio = useStore((s) => s.setStudio)

  const [fetchedEntry, setFetchedEntry] = React.useState<{ runId: string; run: RunDTO } | null>(null)
  const fetched = fetchedEntry?.runId === runId ? fetchedEntry.run : null
  const [fetchErrorEntry, setFetchErrorEntry] = React.useState<{ runId: string; error: string } | null>(null)
  const fetchError = fetchErrorEntry?.runId === runId ? fetchErrorEntry.error : null
  const [jsonModeEntry, setJsonModeEntry] = React.useState<{ runId: string | null; value: boolean }>({ runId: null, value: false })
  const jsonMode = jsonModeEntry.runId === runId && jsonModeEntry.value
  const setJsonMode = (value: boolean) => setJsonModeEntry({ runId, value })
  const [inputOpenEntry, setInputOpenEntry] = React.useState<{ runId: string | null; value: boolean }>({ runId: null, value: true })
  const inputOpen = inputOpenEntry.runId !== runId || inputOpenEntry.value
  const setInputOpen = (value: boolean) => setInputOpenEntry({ runId, value })
  const [retryBusy, setRetryBusy] = React.useState(false)
  const [verdictBusy, setVerdictBusy] = React.useState<string | null>(null)
  const [evaluateOpen, setEvaluateOpen] = React.useState(false)
  const [linkedObservationEntry, setLinkedObservationEntry] = React.useState<{ runId: string; rows: { id: string; status: string; observation: string; positionTitle: string }[] } | null>(null)

  const run = React.useMemo(
    () => (appState?.runs ?? []).find((r) => r.id === runId) ?? fetched,
    [appState?.runs, runId, fetched]
  )
  const linkedObservations = linkedObservationEntry && linkedObservationEntry.runId === run?.id ? linkedObservationEntry.rows : []

  React.useEffect(() => {
    let active = true
    if (!run?.versionId) return
    void api.semanticCodemap(run.projectId, run.versionId).then((data) => {
      if (!active) return
      const rows = (data.positions as { title: string; observations?: { id: string; runId: string | null; status: string; observation: string }[] }[])
      setLinkedObservationEntry({ runId: run.id, rows: rows.flatMap((position) => (position.observations ?? []).filter((observation) => observation.runId === run.id).map((observation) => ({ id: observation.id, status: observation.status, observation: observation.observation, positionTitle: position.title }))) })
    }).catch(() => { if (active) setLinkedObservationEntry({ runId: run.id, rows: [] }) })
    return () => { active = false }
  }, [run?.id, run?.projectId, run?.versionId])

  // hooks must run before any early return
  const pretty = React.useMemo(() => tryPrettyJson(run?.output ?? null), [run?.output])

  if (!runId) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
        Выберите запуск в списке — здесь появятся вход, выход, проверки и вердикт.
      </p>
    )
  }

  if (!run) {
    return (
      <div className="space-y-2 rounded-lg border border-dashed px-4 py-6 text-center">
        <p className="text-xs text-muted-foreground">
          Запуск не найден в списке последних 200 (список ограничен). Можно загрузить его напрямую по идентификатору.
        </p>
        {fetchError && <ErrorState error={fetchError} title="Не удалось загрузить запуск" />}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void api
              .run(runId)
              .then((r) => setFetchedEntry({ runId, run: r }))
              .catch((e) => setFetchErrorEntry({ runId, error: e instanceof Error ? e.message : 'Ошибка загрузки' }))
          }
        >
          Загрузить по id
        </Button>
      </div>
    )
  }

  // ---------- derived ----------
  const programChecks = run.programChecks ?? []
  const scenario = appState?.scenarios.find((s) => s.id === run.scenarioId) ?? null
  const parent = (appState?.runs ?? []).find((r) => r.id === run.parentRunId) ?? null
  const evaluators = (appState?.runs ?? [])
    .filter((r) => r.parentRunId === run.id && r.role === 'evaluator')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const distinctVerdicts = new Set(evaluators.map((e) => e.verdict ?? 'null'))
  const disagreements = evaluators.length >= 2
  const canEvaluate = run.role === 'executor' && run.status === 'completed' && !!run.output
  const isDemo = run.origin === 'demo'
  const linkedDiscrepancies = (appState?.notes ?? []).flatMap((note) => {
    if (note.kind !== 'objection') return []
    const payload = parseResearchDiscrepancy(note.body)
    return payload?.runIds.includes(run.id) ? [{ note, payload }] : []
  })

  // ---------- actions ----------
  const onRetry = async () => {
    setRetryBusy(true)
    try {
      const res = await api.retryRun(run.id)
      selectRun(res.run.id)
      await refresh()
      toast({ title: 'Повтор создан', description: 'Новый запуск выполнен с теми же параметрами.' })
    } catch (e) {
      toast({
        title: 'Не удалось повторить',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setRetryBusy(false)
    }
  }

  const onUserVerdict = async (v: Verdict) => {
    setVerdictBusy(v)
    try {
      await api.setRunVerdict(run.id, v)
      await refresh()
      toast({ title: 'Вердикт пользователя сохранён', description: 'Исходный вердикт модели сохранён в карточке.' })
    } catch (e) {
      toast({
        title: 'Не удалось сохранить вердикт',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setVerdictBusy(null)
    }
  }

  return (
    <Card className="border-border/70">
      <CardContent className="space-y-4 p-4">
        {/* header */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{ROLE_TITLES[run.role]}</span>
          <RunStatusBadge status={run.status} />
          {run.role === 'evaluator' && (
            <span className="flex items-center gap-1">
              <VerdictBadge verdict={run.verdict} by={run.verdictBy} modelVerdict={run.modelVerdict} />
            </span>
          )}
          {isDemo && <OriginBadge origin="demo" />}
          <span className="ml-auto flex items-center gap-1.5">
            <span className="font-mono text-[10px] text-muted-foreground" title={run.id}>
              {run.id.slice(0, 14)}…
            </span>
            <CopyButton text={run.id} size="icon" variant="ghost" className="size-7" />
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {fmtTime(run.createdAt)} · {RUN_STATUS_LABELS[run.status]}
          {run.finishedAt ? ` · завершён ${fmtTime(run.finishedAt)}` : ''}
        </p>

        {/* honest separation note */}
        <p className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] leading-relaxed">
          <Info className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden />
          Статус выполнения ≠ вердикт проверки. Завершённая проверка может обнаружить дефект.
        </p>

        {/* meta */}
        <div className="grid gap-x-6 gap-y-0 sm:grid-cols-2">
          <KV k="Бэкенд" v={<span className="font-mono text-xs">{backendModelLabel(run)}</span>} />
          <KV k="Запрошенная модель" v={<span className="font-mono text-xs">{run.model ?? 'не сообщено'}</span>} />
          <KV k="Фактический провайдер" v={<span className="font-mono text-xs">{run.input?.responseMetadata?.actualProvider || 'не сообщено'}</span>} />
          <KV k="Фактическая модель" v={<span className="font-mono text-xs">{run.input?.responseMetadata?.actualModel || 'не сообщено'}</span>} />
          <KV
            k="Подключение"
            v={<span className="font-mono text-xs">{run.connectionId ? `${run.connectionName ?? '—'} (снимок)` : '—'}</span>}
          />
          <KV k="Длительность" v={fmtDuration(run.durationMs)} />
          <KV
            k="Токены (вх/вых)"
            v={
              <span className="font-mono text-xs">
                {run.tokensIn ?? '—'} / {run.tokensOut ?? '—'}
              </span>
            }
          />
        </div>

        {/* links */}
        <div className="space-y-1.5">
          {run.scenarioId ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <ListTree className="size-3.5 text-primary/70" aria-hidden />
              <span className="text-muted-foreground">Сценарий:</span>
              {scenario ? (
                <>
                  <span className="max-w-full truncate font-medium" title={scenario.title}>{scenario.title}</span>
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    {SCENARIO_STATUS_TITLES[scenario.status]}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-[11px]"
                    onClick={() => {
                      selectScenario(scenario.id)
                      setStudio('scenario')
                    }}
                  >
                    <ExternalLink className="size-3" aria-hidden />
                    Открыть в дереве
                  </Button>
                </>
              ) : (
                <span className="text-muted-foreground">сценарий удалён — запуск отвязан</span>
              )}
            </div>
          ) : null}
          {run.parentRunId ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">Родительский запуск:</span>
              {parent ? (
                <>
                  <span className="font-medium">{roleShort(parent.role)}</span>
                  <RunStatusBadge status={parent.status} compact />
                  {parent.role === 'evaluator' && parent.verdict && <VerdictBadge verdict={parent.verdict} by={parent.verdictBy} />}
                  <span className="max-w-64 truncate text-[10px] text-muted-foreground">
                    {parent.input?.prompt?.slice(0, 100) ?? '—'}
                  </span>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => selectRun(parent.id)}>
                    Открыть
                  </Button>
                </>
              ) : (
                <span className="text-muted-foreground">родительский запуск не в списке последних 200</span>
              )}
            </div>
          ) : null}
        </div>

        {/* verdict override (evaluator) */}
        {run.role === 'evaluator' && run.status === 'completed' && (
          <div className="space-y-1.5 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-xs text-muted-foreground">Вердикт</Label>
              <VerdictBadge verdict={run.verdict} by={run.verdictBy} modelVerdict={run.modelVerdict} />
              {run.verdictBy && (
                <span className="text-[10px] text-muted-foreground">{byLabel(run.verdictBy)}</span>
              )}
            </div>
            {run.verdict === null && (
              <p className="flex gap-1.5 text-[11px] text-amber-600 dark:text-amber-300">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Вердикт модели не распознан (ответ не разобран как JSON с вердиктом) — установите свой.
              </p>
            )}
            {run.verdictBy === 'user' && run.modelVerdict && (
              <p className="text-[11px] text-muted-foreground">
                Исходный вердикт модели: {verdictLabel(run.modelVerdict)} — сохранён, видно в подсказке бейджа.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-muted-foreground">Мой вердикт:</span>
              {(['pass', 'fail', 'inconclusive'] as Verdict[]).map((v) => (
                <Button
                  key={v}
                  size="sm"
                  variant={run.verdict === v && run.verdictBy === 'user' ? 'default' : 'outline'}
                  className="h-7 text-xs"
                  disabled={verdictBusy !== null}
                  onClick={() => void onUserVerdict(v)}
                  title={`Установить пользовательский вердикт: ${verdictLabel(v).toLowerCase()}`}
                >
                  {verdictBusy === v && <Loader2 className="mr-1 size-3 animate-spin" aria-hidden />}
                  {verdictLabel(v)}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* evaluator disagreements */}
        {disagreements && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
              {distinctVerdicts.size > 1 ? (
                <span className="text-amber-600 dark:text-amber-300">Разногласия оценщиков ({evaluators.length})</span>
              ) : (
                <span>Оценщики этого запуска ({evaluators.length})</span>
              )}
              {distinctVerdicts.size === 1 && evaluators.every((e) => e.verdict !== null) && (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  вердикты совпадают
                </Badge>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Каждое заключение сохраняется отдельно. Большинство голосов не является доказательством истины. Показаны
              запуски из списка последних 200.
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {evaluators.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => selectRun(e.id)}
                  className="flex flex-wrap items-center gap-2 rounded-md border bg-card/60 px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/60"
                >
                  <span className="font-mono text-[10px] text-muted-foreground">{fmtTime(e.createdAt)}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{backendModelLabel(e)}</span>
                  <VerdictBadge verdict={e.verdict} by={e.verdictBy} modelVerdict={e.modelVerdict} />
                  <span className="ml-auto text-[10px] text-muted-foreground">{fmtDuration(e.durationMs)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* input */}
        {(run.role === 'executor' || run.role === 'evaluator' || linkedObservations.length > 0 || linkedDiscrepancies.length > 0) && <div className="space-y-2 rounded-md border p-3 text-xs">
          <strong>Исследовательские результаты — независимые записи</strong>
          <p>Выполнение: <b>{RUN_STATUS_LABELS[run.status]}</b>. Локальные проверки применяются только к указанной области и версии; verdict Evaluator и Observation не перезаписывают ответ или статус Run.</p>
          {run.role === 'evaluator' && <p>Модельная оценка: {run.verdict ?? 'не сохранена'} ({run.verdictBy ?? 'источник неизвестен'}).</p>}
          {linkedObservations.map((observation) => <p key={observation.id}>Observation <code>{observation.id}</code> — {observation.status}: {observation.observation} · положение «{observation.positionTitle}».</p>)}
          {linkedDiscrepancies.map(({ note, payload }) => <p key={note.id}>Расхождение <code>{note.id}</code> — {payload.assessment}, статус {payload.status}: {payload.summary}; пользовательское решение {payload.userDecision?.decision ?? 'отсутствует'}.</p>)}
        </div>}

        {/* input */}
        <Collapsible open={inputOpen} onOpenChange={setInputOpen}>
          <div className="flex items-center justify-between gap-2">
            <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium">
              <ChevronRight className={cn('size-3.5 transition-transform', inputOpen && 'rotate-90')} aria-hidden />
              Вход (JSON)
            </CollapsibleTrigger>
            <CopyButton
              text={() => JSON.stringify(run.input, null, 2)}
              label="Копировать вход"
              size="sm"
              variant="ghost"
            />
          </div>
          <CollapsibleContent>
            {run.input ? (
              <div className="mt-2 space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  {run.input.contextProvenance && <p className="sm:col-span-2 text-[11px] text-muted-foreground">Контекст инструкции: {run.input.contextProvenance.mode} · версия {run.input.contextProvenance.versionLabel ?? run.input.contextProvenance.versionId ?? 'не указана'} · фрагменты {run.input.contextProvenance.includedFragmentIds.join(', ') || '—'} · SHA-256 выборки {run.input.contextProvenance.sentContextSha256 ?? 'не применимо'} · {run.input.contextProvenance.sentContextChars} символов</p>}
                  <div className="rounded border p-2">
                    <p className="mb-1 text-[10px] font-medium text-muted-foreground">Пользовательская задача</p>
                  {run.role === 'evaluator' ? (
                    <div className="space-y-2 text-xs">
                      <div><strong>Критерии полностью:</strong><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{run.input.taskContext?.criterion ?? 'не сохранены'}</pre></div>
                      <div><strong>Оцениваемый ответ полностью:</strong><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{run.input.taskContext?.outputToEvaluate ?? 'не сохранён'}</pre></div>
                      <details><summary className="cursor-pointer">Сводное поле запуска</summary><pre className="whitespace-pre-wrap break-words">{run.input.prompt}</pre></details>
                    </div>
                  ) : <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs">{run.input.prompt}</pre>}
                  </div>
                  {run.role === 'executor' && run.input.skillText !== undefined && (
                    <div className="rounded border p-2 sm:col-span-2">
                      <p className="mb-1 text-[10px] font-medium text-muted-foreground">
                        Фактически отправленный текст скилла · {run.input.skillContextMode === 'full' ? 'полный' : 'сокращённый'} · {run.input.skillText.length.toLocaleString('ru-RU')} символов
                      </p>
                      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">{run.input.skillText}</pre>
                    </div>
                  )}
                  {run.input.sentMessages ? (
                    <div className="rounded border p-2 sm:col-span-2">
                      <p className="mb-1 text-[10px] font-medium text-muted-foreground">Фактически отправленные сообщения · {run.input.sentMessages.reduce((n, m) => n + m.content.length, 0).toLocaleString('ru-RU')} символов</p>
                      {run.input.sentMessages.map((message, index) => <details key={index} className="mb-1 rounded border p-1"><summary className="cursor-pointer text-[10px]">{message.role}</summary><pre className="whitespace-pre-wrap break-words text-xs">{message.content}</pre></details>)}
                    </div>
                  ) : <p className="sm:col-span-2 text-[11px] text-muted-foreground">Состав отправленных сообщений неизвестен.</p>}
                </div>
                <JsonView data={run.input} maxHeight="18rem" />
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">Вход не сохранён.</p>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* program checks */}
        {programChecks.length > 0 && (
          <div className="space-y-1.5 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
              Локальные программные проверки
              <StatusBadge status="LOCAL" withHint={false} />
            </div>
            <ul className="space-y-1">
              {programChecks.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  {c.status === 'unverified' ? (
                    <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  ) : c.passed ? (
                    <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-500" aria-hidden />
                  ) : (
                    <X className="mt-0.5 size-3.5 shrink-0 text-rose-500" aria-hidden />
                  )}
                  <span className="min-w-0">
                    <span className="font-medium">{c.name}</span> —{' '}
                    {c.scope && <span className="mr-1 rounded border px-1 text-[10px]">область: {c.scope}</span>}
                    {c.version && <span className="mr-1 rounded border px-1 text-[10px]">проверка: {c.version}</span>}
                    <span className="text-muted-foreground">{c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-muted-foreground">
              Проверки выполняются локально после executor-запуска; результат проверки ≠ вердикт модели.
            </p>
          </div>
        )}

        {/* output */}
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label className="text-xs font-medium">Выход модели</Label>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              <Label htmlFor="rd-json" className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Switch
                  id="rd-json"
                  checked={jsonMode}
                  onCheckedChange={setJsonMode}
                  disabled={!pretty}
                  title={pretty ? 'Показать как JSON' : 'Выход не является корректным JSON'}
                />
                как JSON
              </Label>
              <CopyButton
                text={() => (pretty && jsonMode ? pretty : run.output ?? '')}
                label="Копировать выход"
                size="sm"
                variant="ghost"
              />
              {pretty && (
                <CopyButton text={() => pretty} label="Выход JSON" size="sm" variant="ghost" />
              )}
              <CopyButton
                text={() => runChatReportMarkdown(run)}
                label="Выход — очищенный от инструкции"
                size="sm"
                variant="outline"
              />
            </div>
          </div>
          {run.output ? (
            jsonMode && pretty ? (
              <JsonView data={pretty} maxHeight="24rem" />
            ) : (
              <pre className="scroll-observatory max-h-96 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
                {run.output}
              </pre>
            )
          ) : (
            <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
              Выхода нет — запуск не завершился успешно или модель не ответила.
            </p>
          )}
          {jsonMode && !pretty && run.output && (
            <p className="text-[10px] text-muted-foreground">
              Выход не удалось разобрать как JSON — показан как текст (честно, без подмены).
            </p>
          )}
        </div>

        {/* error */}
        {run.error && <ErrorState error={run.error} title="Ошибка выполнения" />}

        {/* actions */}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {canEvaluate && (
            <Button size="sm" className="gap-1.5" onClick={() => setEvaluateOpen(true)}>
              <Bot className="size-3.5" aria-hidden />
              Оценить результат (Evaluator)
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => void onRetry()}
            disabled={retryBusy || isDemo}
            title={isDemo ? 'DEMO-запуски нельзя повторить — создайте реальный запуск' : 'Создать новый запуск с теми же параметрами'}
          >
            {retryBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
            Повторить запуск
          </Button>
          <CopyButton text={() => runCardMarkdown(run)} label="Копировать карточку запуска" size="sm" />
        </div>

        {canEvaluate && <EvaluateDialog run={run} open={evaluateOpen} onOpenChange={setEvaluateOpen} />}
      </CardContent>
    </Card>
  )
}
