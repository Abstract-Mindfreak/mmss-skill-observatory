'use client'

import * as React from 'react'
import { Activity, Archive, ArrowUpRight, ChevronDown, CircleAlert, RotateCcw, Search, ShieldAlert, Square, Timer, Workflow } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StatusBadge } from '@/components/shared/semantic-badge'
import { api } from '@/lib/api-client'
import { useStore } from '@/lib/store'
import type { ProcessChild, ProcessEntry, ProcessStatus } from '@/lib/process-center'

const ARCHIVE_KEY = 's2.process-center.archive.v1'
const STATUS_LABEL: Record<ProcessStatus, string> = { active: 'Выполняется', waiting: 'Ожидает', paused: 'Приостановлено', blocked: 'Заблокировано', 'needs-reconciliation': 'Требует сверки', completed: 'Завершено', stopped: 'Остановлено', failed: 'Ошибка', prepared: 'Подготовлено' }
const TYPE_LABEL: Record<string, string> = { campaign: 'Кампания', run: 'Ролевой запуск', 'assistant-call': 'Помощник', 'interpreter-operation': 'Interpreter', 'explorer-operation': 'Explorer', contour: 'Пакетная обработка', analysis: 'ModelCall операция' }
const ACTION_LABEL: Record<string, string> = { pause: 'Приостановить', continue: 'Продолжить', stop: 'Остановить', reconcile: 'Сверить и закрыть', restart: 'Новое исследование с теми же настройками', retry: 'Повторить неуспешный Run' }

function viewOnlyReason(row: ProcessEntry) {
  if (row.type === 'contour' && row.status === 'waiting') return 'Только просмотр: следующий шаг запускается отдельно в Atlas; embedding-индексация здесь не прерывается.'
  if (row.type === 'interpreter-operation' && row.status === 'completed') return 'Только просмотр: результат сохранён в Atlas; новый Interpreter-запуск создаётся из карточки источника.'
  if (row.type === 'assistant-call' && row.status === 'completed') return 'Только просмотр: ответ сохранён в чате Помощника.'
  if (row.type === 'run' && row.status === 'completed') return 'Только просмотр: завершённый Run сохранён в Behavior Lab.'
  return 'Для этого типа и состояния управляющее действие недоступно.'
}

function readArchived(): string[] {
  try { const value = localStorage.getItem(ARCHIVE_KEY); const parsed: unknown = value ? JSON.parse(value) : []; return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [] } catch { return [] }
}

function ChildRow({ child, depth = 0 }: { child: ProcessChild; depth?: number }) {
  return <div className="min-w-0 border-l border-border pl-3" style={{ marginLeft: depth ? 12 : 0 }}>
    <div className="flex min-w-0 flex-wrap items-center gap-2 py-1.5 text-xs">
      <span className="min-w-0 flex-1 break-words">{child.title}</span>
      <StatusBadge status={child.status} label={STATUS_LABEL[child.status]} />
      {child.route && <span className="max-w-full break-all font-mono text-muted-foreground">{child.route}</span>}
      {child.error && <span className="max-w-full break-words text-destructive">{child.error}</span>}
      {(child.runId || child.modelCallId) && <details className="basis-full">
        <summary className="cursor-pointer text-muted-foreground">Технические сведения</summary>
        <code className="block break-all pt-1">{child.runId ? `Run ${child.runId}` : ''}{child.modelCallId ? `ModelCall ${child.modelCallId}` : ''}</code>
      </details>}
    </div>
    {child.children?.map((nested) => <ChildRow key={nested.id} child={nested} depth={depth + 1} />)}
  </div>
}

export default function ProcessCenterStudio() {
  const projectId = useStore((state) => state.appState?.project?.id ?? state.projectId)
  const selectedProcessId = useStore((state) => state.selectedProcessId)
  const selectProcess = useStore((state) => state.selectProcess)
  const setStudio = useStore((state) => state.setStudio)
  const selectRun = useStore((state) => state.selectRun)
  const [rows, setRows] = React.useState<ProcessEntry[]>([])
  const [generatedAt, setGeneratedAt] = React.useState<string | null>(null)
  const [error, setError] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [status, setStatus] = React.useState('all')
  const [type, setType] = React.useState('all')
  const [allProjects, setAllProjects] = React.useState(false)
  const [showArchived, setShowArchived] = React.useState(false)
  const [archived, setArchived] = React.useState<string[]>([])
  const [visibleCount, setVisibleCount] = React.useState(40)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState('')

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => setArchived(readArchived()))
    return () => window.cancelAnimationFrame(frame)
  }, [])
  const refresh = React.useCallback(async () => {
    try { const response = await api.processes(projectId ?? undefined, allProjects); setRows(response.processes); setGeneratedAt(response.generatedAt); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }, [allProjects, projectId])
  React.useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0)
    const timer = window.setInterval(() => void refresh(), 5000)
    return () => { window.clearTimeout(initial); window.clearInterval(timer) }
  }, [refresh])

  const visible = React.useMemo(() => rows.filter((row) => {
    const isArchived = archived.includes(row.id)
    if (showArchived !== isArchived) return false
    if (status !== 'all' && row.status !== status) return false
    if (type !== 'all' && row.type !== type) return false
    const searchable = `${row.title} ${row.direction} ${row.stage} ${row.projectName} ${row.versionLabel ?? ''} ${row.waitingReason ?? ''}`.toLocaleLowerCase()
    return searchable.includes(query.trim().toLocaleLowerCase())
  }), [rows, archived, showArchived, status, type, query])
  const selected = rows.find((row) => row.id === selectedProcessId) ?? null
  const activeCount = rows.filter((row) => row.status === 'active').length

  const setArchivedState = (next: string[]) => {
    setArchived(next)
    try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(next)) } catch { setNotice('Не удалось сохранить локальное предпочтение списка.') }
  }
  const driveCampaign = async (row: ProcessEntry) => {
    const campaignId = row.campaignId
    if (!campaignId || !row.versionId) throw new Error('Для продолжения кампании не найдены проект и версия.')
    for (let iteration = 0; iteration < 200; iteration += 1) {
      const result = await fetch('/api/research-campaign', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: row.projectId, versionId: row.versionId, campaignId, action: 'advance' }) }).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`); return data as { kind?: string; campaign?: { status: string } } })
      if (result.kind === 'waiting') { await new Promise((resolve) => window.setTimeout(resolve, 1000)); continue }
      if (result.campaign?.status !== 'running') break
    }
  }
  const runAction = async (row: ProcessEntry, action: string) => {
    if (busyId) return
    if (['stop', 'pause', 'restart', 'retry'].includes(action)) {
      const prompt = action === 'stop' ? 'Подтвердите остановку. S2 прервёт только локальный запрос; провайдер мог продолжить вычисление.' : action === 'pause' ? 'Поставить процесс на паузу? Сохранённая история не удаляется.' : action === 'restart' ? 'Создать новое исследование с теми же параметрами и ссылкой на предшественника? Модельные запросы не начнутся до отдельного запуска.' : 'Создать новый Run с сохранённым входом? Историческая запись останется без изменений.'
      if (!window.confirm(prompt)) return
    }
    const basis = action === 'reconcile' ? window.prompt('Укажите основание принудительной сверки. Результат внешнего провайдера останется неизвестным:') ?? '' : undefined
    if (action === 'reconcile' && (basis ?? '').trim().length < 8) { setNotice('Сверка отменена: основание должно содержать не менее 8 символов.'); return }
    setBusyId(row.id); setNotice('')
    try {
      let response: Record<string, unknown>
      if (action === 'retry' && row.runId) {
        response = await fetch(`/api/runs/${row.runId}/retry`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: row.projectId }) }).then(async (res) => { const data = await res.json(); if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`); return data })
      } else {
        response = await api.processAction({ projectId: row.projectId, type: row.type === 'run' ? 'run' : row.type === 'contour' ? 'contour' : row.type === 'campaign' ? 'campaign' : 'model-call', id: row.runId ?? row.analysisId ?? row.campaignId ?? row.modelCallId ?? '', action, ...(basis ? { basis } : {}) })
      }
      if (action === 'continue' && row.campaignId && response.driveRequired === true) await driveCampaign(row)
      if (action === 'retry' && response.run) setNotice('Создан новый Run; исходная запись сохранена.')
      else if (action === 'restart') setNotice('Создана новая подготовленная кампания. Запуск требует отдельного подтверждения.')
      else if (action === 'stop') setNotice(typeof response.localStop === 'string' ? response.localStop : 'Запрос принят локальным владельцем; внешний результат неизвестен.')
      else if (action === 'reconcile') setNotice('Запись закрыта как failed/unknown, не как успешная проверка. Основание сохранено.')
      else if (action === 'pause') setNotice('Процесс приостановлен. Провайдер мог завершить текущий запрос позже.')
      await refresh()
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusyId(null) }
  }

  const openDirection = (row: ProcessEntry) => {
    selectProcess(row.id)
    if (row.runId) { selectRun(row.runId); setStudio('lab') }
    else if (row.type === 'campaign') setStudio('research')
    else if (row.type === 'assistant-call') setStudio('assistant')
    else setStudio('atlas')
  }

  return <div className="mx-auto max-w-7xl space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex items-center gap-2"><Activity className="size-5 text-primary" /><h1 className="text-2xl font-semibold">Процессы и очередь</h1></div><p className="mt-1 text-sm text-muted-foreground">Единое представление существующих владельцев. Оно только наблюдает данные и не запускает работу при открытии.</p></div>
      <div className="flex flex-wrap items-center gap-2"><Button variant={allProjects ? 'default' : 'outline'} size="sm" onClick={() => setAllProjects((value) => !value)}>{allProjects ? 'Все проекты' : 'Текущий проект'}</Button><Button variant={showArchived ? 'secondary' : 'outline'} size="sm" onClick={() => setShowArchived((value) => !value)}>{showArchived ? 'Архивированные' : 'Обычная очередь'}</Button><Button variant="outline" size="sm" onClick={() => void refresh()}>Обновить</Button></div>
    </header>
    {error && <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm"><strong>Потеря связи с очередью.</strong> {error} {generatedAt && `Показан последний снимок ${new Date(generatedAt).toLocaleTimeString()}.`}</div>}
    {notice && <div role="status" className="rounded-lg border bg-card p-3 text-sm">{notice}</div>}
    {rows.length > 0 && activeCount === 0 && !error && <p className="text-sm text-muted-foreground">Нет активных процессов. Сохранённая история доступна в списке ниже.</p>}
    {rows.length === 0 && !error && <Card><CardContent className="flex items-center gap-3 py-8 text-sm text-muted-foreground"><Timer className="size-5" />Нет активных процессов; история процессов в выбранном проекте пока пуста.</CardContent></Card>}
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)]">
      <section className="min-w-0 space-y-3" aria-label="Список процессов">
        <div className="grid gap-2 sm:grid-cols-4"><label className="relative sm:col-span-2"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Поиск по задаче, версии или проекту" value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(40) }} /></label><Select value={type} onValueChange={setType}><SelectTrigger aria-label="Фильтр типа"><SelectValue placeholder="Тип процесса" /></SelectTrigger><SelectContent><SelectItem value="all">Все типы</SelectItem>{Object.entries(TYPE_LABEL).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Select value={status} onValueChange={setStatus}><SelectTrigger aria-label="Фильтр состояния"><SelectValue placeholder="Состояние" /></SelectTrigger><SelectContent><SelectItem value="all">Все состояния</SelectItem>{Object.entries(STATUS_LABEL).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
        {visible.length === 0 && rows.length > 0 && <Card><CardContent className="py-8 text-sm text-muted-foreground">Нет записей по этим фильтрам.</CardContent></Card>}
        {visible.slice(0, visibleCount).map((row) => <Card key={row.id} className={selectedProcessId === row.id ? 'ring-2 ring-ring' : ''}>
          <CardHeader className="min-w-0 space-y-2 pb-3"><div className="flex min-w-0 flex-wrap items-center gap-2"><Badge variant="outline">{TYPE_LABEL[row.type] ?? row.type}</Badge><StatusBadge status={row.status} label={STATUS_LABEL[row.status]} /><Button variant="outline" size="sm" className="ml-auto" onClick={() => openDirection(row)}><ArrowUpRight className="mr-1 size-3.5" />Открыть</Button><button className="basis-full min-w-0 break-words text-left font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => selectProcess(row.id)}>{row.title}</button></div><p className="break-words text-xs text-muted-foreground">{row.projectName} · {row.versionLabel ?? 'версия неизвестна'} · {row.direction}</p></CardHeader>
          <CardContent className="space-y-2 text-sm"><div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground"><span>Этап: {row.stage}</span>{row.progress && <span>Прогресс: {row.progress}</span>}<span>Обновлено: {new Date(row.updatedAt).toLocaleString()}</span></div>{row.waitingReason && <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs"><CircleAlert className="size-4 shrink-0" />{row.waitingReason}</p>}{row.children.length > 0 && <details className="rounded border p-2"><summary className="flex cursor-pointer items-center gap-2 text-xs font-medium"><Workflow className="size-4" />Связанные действия и результаты ({row.children.length})<ChevronDown className="ml-auto size-3.5" /></summary><div className="mt-2 space-y-1">{row.children.map((child) => <ChildRow key={child.id} child={child} />)}</div></details>}
          <div className="flex max-w-full flex-wrap gap-2 pt-1">{row.controls.map((action) => <Button key={action} size="sm" variant={action === 'stop' || action === 'reconcile' ? 'destructive' : 'outline'} className="max-w-full whitespace-normal text-left leading-tight" disabled={busyId === row.id} onClick={() => void runAction(row, action)}>{action === 'stop' ? <Square className="mr-1 size-3 shrink-0" /> : action === 'restart' || action === 'retry' ? <RotateCcw className="mr-1 size-3 shrink-0" /> : action === 'reconcile' ? <ShieldAlert className="mr-1 size-3 shrink-0" /> : <Activity className="mr-1 size-3 shrink-0" />}{ACTION_LABEL[action] ?? action}</Button>)}{row.controls.length === 0 && <p className="self-center text-xs text-muted-foreground">{viewOnlyReason(row)}</p>}{['completed', 'stopped', 'failed', 'paused', 'blocked'].includes(row.status) && <Button size="sm" variant="ghost" className="max-w-full whitespace-normal text-left leading-tight" onClick={() => setArchivedState(showArchived ? archived.filter((id) => id !== row.id) : [...new Set([...archived, row.id])])}><Archive className="mr-1 size-3.5 shrink-0" />{showArchived ? 'Вернуть в очередь' : 'Убрать из очереди'}</Button>}</div>
        </CardContent></Card>)}
        {visible.length > visibleCount && <Button variant="outline" onClick={() => setVisibleCount((count) => count + 40)}>Показать ещё 40 из {visible.length - visibleCount}</Button>}
      </section>
      <aside aria-label="Подробности выбранного процесса" className="min-w-0 xl:sticky xl:top-20 xl:self-start">
        {selected ? <Card><CardHeader><CardTitle className="break-words">{selected.title}</CardTitle><p className="text-sm text-muted-foreground">{STATUS_LABEL[selected.status]} · {TYPE_LABEL[selected.type] ?? selected.type}</p></CardHeader><CardContent className="space-y-3 text-sm"><p><strong>Проект:</strong> {selected.projectName}</p><p><strong>Версия:</strong> {selected.versionLabel ?? 'неизвестна'}</p><p className="break-words"><strong>Направление:</strong> {selected.direction}</p><p><strong>Этап:</strong> {selected.stage}</p><p><strong>Начало:</strong> {new Date(selected.createdAt).toLocaleString()}</p><p><strong>Последнее обновление:</strong> {new Date(selected.updatedAt).toLocaleString()}</p>{selected.progress && <p><strong>Прогресс:</strong> {selected.progress}</p>}{selected.route && <p className="break-words"><strong>{selected.routeLabel ?? 'Маршрут'}:</strong> {selected.route}</p>}{selected.waitingReason && <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2">{selected.waitingReason}</p>}{selected.error && <p className="rounded border border-destructive/40 p-2 text-destructive">{selected.error}</p>}{selected.rawError && <details><summary className="cursor-pointer">Техническая ошибка</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs">{selected.rawError}</pre></details>}<details><summary className="cursor-pointer text-muted-foreground">Технические идентификаторы</summary><code className="mt-2 block break-all text-xs">{selected.id}{selected.runId ? ` · Run ${selected.runId}` : ''}{selected.modelCallId ? ` · ModelCall ${selected.modelCallId}` : ''}{selected.analysisId ? ` · Analysis ${selected.analysisId}` : ''}{selected.campaignId ? ` · Campaign ${selected.campaignId}` : ''}</code></details><p className="text-xs text-muted-foreground">Скрытие из очереди сохраняется только в настройке этого браузера. Исследовательские записи и история не удаляются.</p></CardContent></Card> : <Card><CardContent className="py-8 text-sm text-muted-foreground">Выберите процесс, чтобы увидеть направление, этап, маршрут и связанные записи.</CardContent></Card>}
      </aside>
    </div>
  </div>
}
