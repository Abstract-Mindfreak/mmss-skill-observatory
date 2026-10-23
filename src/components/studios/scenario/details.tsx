// Панель деталей выбранного сценария: редактирование (PATCH), статус,
// привязка фрагмента, история запусков, действия (запуск/Explorer/
// ветвь/закрепление/удаление/копирование/экспорт).
'use client'

import * as React from 'react'
import {
  Info,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Card, CardContent } from '@/components/ui/card'
import { CopyButton } from '@/components/shared/copy'
import { ErrorState } from '@/components/shared/states'
import { FragmentRef } from '@/components/shared/misc'
import { OriginBadge, RunStatusBadge, VerdictBadge } from '@/components/shared/status-badges'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api-client'
import { useStore } from '@/lib/store'
import { ROLE_TITLES, SCENARIO_STATUS_TITLES } from '@/lib/types'
import type { FragmentDTO, RunDTO, ScenarioDTO, ScenarioStatus } from '@/lib/types'
import { cn } from '@/lib/utils'
import {
  fmtDuration,
  originLong,
  scenarioCardMarkdown,
  subtreeMarkdown,
  type ResearchParams,
} from './export'
import { ScenarioCreateForm } from './create-form'
import { FragmentPickerDialog } from './fragment-picker'

const STATUS_OPTIONS: ScenarioStatus[] = [
  'unexplored',
  'explored',
  'run-verified',
  'synthetic',
  'disputed',
  'stopped',
]

/** Shape accepted by FragmentRef for a fragment that exists but is not
 *  in the active-version list (e.g. belongs to another version). */
function fallbackFragmentRef(fragmentId: string): Pick<FragmentDTO, 'id' | 'path' | 'text' | 'title'> {
  return { id: fragmentId, path: '?', title: null, text: 'фрагмент не в списке активной версии' }
}

export function ScenarioDetails({
  scenario,
  params,
  totalRealRuns,
  onLaunch,
  onSuggest,
  onDeleted,
  onClose,
}: {
  scenario: ScenarioDTO
  params: ResearchParams
  totalRealRuns: number
  onLaunch: (s: ScenarioDTO) => void
  onSuggest: (s: ScenarioDTO) => void
  onDeleted: (s: ScenarioDTO) => void
  onClose?: () => void
}) {
  const { toast } = useToast()
  const appState = useStore((s) => s.appState)
  const refresh = useStore((s) => s.refresh)
  const selectRun = useStore((s) => s.selectRun)
  const setStudio = useStore((s) => s.setStudio)

  const [title, setTitle] = React.useState(scenario.title)
  const [desc, setDesc] = React.useState(scenario.description ?? '')
  const [status, setStatus] = React.useState<ScenarioStatus>(scenario.status)
  const [stopReason, setStopReason] = React.useState(scenario.stopReason ?? '')
  const [addChildOpen, setAddChildOpen] = React.useState(false)
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setTitle(scenario.title)
    setDesc(scenario.description ?? '')
    setStatus(scenario.status)
    setStopReason(scenario.stopReason ?? '')
    setAddChildOpen(false)
    setError(null)
  }, [scenario.id, scenario.title, scenario.description, scenario.status, scenario.stopReason])

  // ---------- data for card/export ----------
  const allScenarios = appState?.scenarios ?? []
  const children = React.useMemo(
    () =>
      allScenarios
        .filter((s) => s.parentId === scenario.id)
        .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt)),
    [allScenarios, scenario.id]
  )
  const scenarioRuns = React.useMemo(
    () => (appState?.runs ?? []).filter((r) => r.scenarioId === scenario.id),
    [appState?.runs, scenario.id]
  )
  const fragments = appState?.fragments ?? []

  // ---------- mutations ----------

  const patch = async (id: string, body: Record<string, unknown>, busyKey: string, okTitle: string) => {
    setBusy(busyKey)
    setError(null)
    try {
      await api.updateScenario(id, body)
      await refresh()
      toast({ title: okTitle })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Не удалось применить изменение'
      setError(msg)
      toast({ title: 'Не удалось', description: msg, variant: 'destructive' })
      return false
    } finally {
      setBusy(null)
    }
    return true
  }

  const onSaveCard = async () => {
    if (!title.trim()) {
      setError('Заголовок не может быть пустым')
      return
    }
    await patch(
      scenario.id,
      { title: title.trim(), description: desc.trim() ? desc.trim() : '' },
      'card',
      'Изменения сохранены'
    )
  }

  const onStatusChange = (next: ScenarioStatus) => {
    if (next === 'stopped') {
      setStatus('stopped')
      return
    }
    setStatus(next)
    void patch(
      scenario.id,
      { status: next, stopReason: '' },
      'status',
      `Статус: ${SCENARIO_STATUS_TITLES[next]}`
    )
  }

  const onSaveStopped = () => {
    void patch(
      scenario.id,
      { status: 'stopped', stopReason: stopReason.trim() ? stopReason.trim() : '' },
      'status',
      'Ветвь остановлена'
    )
  }

  const onPin = () =>
    void patch(scenario.id, { pinned: !scenario.pinned }, 'pin', scenario.pinned ? 'Откреплено' : 'Закреплено')

  const onDelete = async () => {
    setBusy('delete')
    try {
      await api.deleteScenario(scenario.id)
      await refresh()
      toast({ title: 'Ветвь удалена', description: 'Связанные запуски сохранены и отвязаны от сценария.' })
      onDeleted(scenario)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Не удалось удалить'
      toast({ title: 'Удаление отклонено', description: msg, variant: 'destructive' })
    } finally {
      setBusy(null)
      setDeleteOpen(false)
    }
  }

  const openRun = (run: RunDTO) => {
    selectRun(run.id)
    setStudio('lab')
  }

  // ---------- copy/export texts ----------
  const cardText = () =>
    scenarioCardMarkdown(scenario, children, scenarioRuns, fragments)
  const subtreeText = () =>
    subtreeMarkdown(scenario, allScenarios, (id) => (appState?.runs ?? []).filter((r) => r.scenarioId === id), fragments, params, {
      performed: totalRealRuns,
      budget: params.runBudget,
    })

  const dirty = title.trim() !== scenario.title || (desc.trim() || '') !== (scenario.description ?? '')
  const reasonDirty = scenario.status === 'stopped' && stopReason.trim() !== (scenario.stopReason ?? '')
  const stopSaveReady = status === 'stopped' && (scenario.status !== 'stopped' || reasonDirty) && stopReason.trim().length > 0

  return (
    <Card className="border-border/70">
      <CardContent className="space-y-4 p-4">
        {/* header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
              {originLong(scenario.origin)}
            </Badge>
            {scenario.origin === 'demo' && <OriginBadge origin="demo" />}
            {scenario.pinned && (
              <Badge variant="outline" className="gap-1 border-amber-500/50 bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-300">
                <Pin className="size-3" aria-hidden /> закреплена
              </Badge>
            )}
          </div>
          {onClose && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onClose}>
              Закрыть
            </Button>
          )}
        </div>

        {scenario.generationMetadata && (
          <p className="text-[10px] font-mono text-muted-foreground">
            Генерация: подключение {scenario.generationMetadata.backend} · «{scenario.generationMetadata.connectionName ?? '—'}» · запрос: {scenario.generationMetadata.requestedModel ?? '—'} · фактический провайдер: {scenario.generationMetadata.actualProvider ?? 'не сообщён'} · фактическая модель: {scenario.generationMetadata.actualModel ?? 'не сообщена'}
          </p>
        )}

        {/* title */}
        <div className="space-y-1">
          <Label htmlFor="sd-title" className="text-xs text-muted-foreground">
            Заголовок
          </Label>
          <Input
            id="sd-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-8 text-sm font-medium"
            maxLength={300}
          />
        </div>

        {/* description */}
        <div className="space-y-1">
          <Label htmlFor="sd-desc" className="text-xs text-muted-foreground">
            Описание
          </Label>
          <Textarea
            id="sd-desc"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="условие возникновения, нарушаемое свойство, минимальный пример"
            className="min-h-20 text-xs leading-relaxed"
            maxLength={2000}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">
              {scenario.createdAt === scenario.updatedAt
                ? `создана ${new Date(scenario.createdAt).toLocaleString('ru-RU')}`
                : `обновлена ${new Date(scenario.updatedAt).toLocaleString('ru-RU')}`}
            </span>
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" disabled={!dirty || busy !== null} onClick={() => void onSaveCard()}>
              <Pencil className="size-3" aria-hidden />
              {busy === 'card' ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </div>
        </div>

        {/* status */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-muted-foreground">Статус ветви</Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Как меняется статус">
                    <Info className="size-3.5" aria-hidden />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-72 text-xs leading-relaxed">
                  <p>Завершённый запуск переводит ветвь из «Неисследованная» в «Исследованная» автоматически.</p>
                  <p className="mt-1 text-muted-foreground">
                    «Проверена запуском» никогда не ставится автоматически — только вручную после вашей оценки. Статус
                    ветви ≠ вердикт запуска.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={status} onValueChange={(v) => onStatusChange(v as ScenarioStatus)} disabled={busy === 'status'}>
              <SelectTrigger size="sm" className="h-8 w-56 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {STATUS_OPTIONS.map((st) => (
                    <SelectItem key={st} value={st} className="text-xs">
                      {SCENARIO_STATUS_TITLES[st]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {status === 'stopped' && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={!stopSaveReady || busy === 'status'}
                onClick={onSaveStopped}
              >
                {busy === 'status' ? 'Сохранение…' : reasonDirty ? 'Сохранить причину' : 'Остановить ветвь'}
              </Button>
            )}
          </div>
          {status === 'stopped' && (
            <div className="space-y-1">
              <Label htmlFor="sd-stop" className="text-xs text-muted-foreground">
                Причина остановки (обязательна)
              </Label>
              <Input
                id="sd-stop"
                value={stopReason}
                onChange={(e) => setStopReason(e.target.value)}
                placeholder="например: дальнейшие запуски не дают новой информации"
                className="h-8 text-xs"
                maxLength={500}
              />
            </div>
          )}
        </div>

        {/* fragment link */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Привязка к тексту инструкции</Label>
          <div className="flex flex-wrap items-center gap-2">
            <FragmentRef
              fragment={
                scenario.fragmentId
                  ? fragments.find((f) => f.id === scenario.fragmentId) ?? fallbackFragmentRef(scenario.fragmentId)
                  : null
              }
              showText={false}
              className="text-xs"
            />
            {scenario.fragmentId ? (
              <>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPickerOpen(true)} disabled={busy !== null}>
                  Изменить
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground"
                  disabled={busy !== null}
                  onClick={() => void patch(scenario.id, { fragmentId: '' }, 'fragment', 'Привязка снята')}
                >
                  Отвязать
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPickerOpen(true)} disabled={busy !== null}>
                Привязать фрагмент
              </Button>
            )}
          </div>
        </div>

        {/* runs */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <Label className="text-xs text-muted-foreground">
              Запуски сценария ({scenario.runCount})
            </Label>
            {scenario.runCount > scenarioRuns.length && (
              <span className="text-[10px] text-muted-foreground">
                в списке последних 200 доступно {scenarioRuns.length}
              </span>
            )}
          </div>
          {scenarioRuns.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
              Запусков ещё нет. Кнопка «Запустить сценарий» откроет лабораторию с этой ветвью.
            </p>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto scroll-observatory rounded-md border p-1">
              {scenarioRuns.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => openRun(r)}
                  className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/60"
                >
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {new Date(r.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="font-medium">{ROLE_TITLES[r.role].split(' — ')[0]}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {r.backend === 'session-cloud'
                      ? 'session-cloud'
                      : r.backend === 'demo'
                        ? 'DEMO'
                        : `${r.backend} · подключение «${r.connectionName ?? '—'}» · запрошенная модель ${r.model ?? 'не указана'}`}
                  </span>
                  <RunStatusBadge status={r.status} />
                  {r.role === 'evaluator' && <VerdictBadge verdict={r.verdict} by={r.verdictBy} modelVerdict={r.modelVerdict} />}
                  <span className="ml-auto text-[10px] text-muted-foreground">{fmtDuration(r.durationMs)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {error && <ErrorState error={error} title="Не удалось применить изменение" />}

        {/* actions */}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Button size="sm" className="gap-1.5" onClick={() => onLaunch(scenario)}>
            <Play className="size-3.5" aria-hidden />
            Запустить сценарий
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onSuggest(scenario)}>
            <Sparkles className="size-3.5" aria-hidden />
            Предложить ветви (Explorer)
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={cn('gap-1.5', !addChildOpen && 'text-foreground')}
            onClick={() => setAddChildOpen((v) => !v)}
            aria-expanded={addChildOpen}
          >
            <Plus className="size-3.5" aria-hidden />
            Добавить ветвь
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 text-xs"
            onClick={onPin}
            disabled={busy === 'pin'}
            title={scenario.pinned ? 'Убрать из закреплённых' : 'Показывать в группе «Закреплённые» сверху дерева'}
          >
            {scenario.pinned ? <PinOff className="size-3.5" aria-hidden /> : <Pin className="size-3.5" aria-hidden />}
            {scenario.pinned ? 'Открепить' : 'Закрепить'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-rose-600 hover:text-rose-700 dark:text-rose-400"
            onClick={() => setDeleteOpen(true)}
            disabled={busy === 'delete'}
          >
            <Trash2 className="size-3.5" aria-hidden />
            Удалить
          </Button>
          <CopyButton text={cardText} label="Копировать карточку" size="sm" />
          <CopyButton text={subtreeText} label="Экспортировать ветвь" size="sm" />
        </div>

        {/* add child form */}
        {addChildOpen && (
          <ScenarioCreateForm
            parentId={scenario.id}
            onCancel={() => setAddChildOpen(false)}
            onCreated={() => setAddChildOpen(false)}
          />
        )}

        {/* dialogs */}
        <FragmentPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          scenario={scenario}
          fragments={fragments}
          onPatched={() => Promise.resolve()}
        />

        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить ветвь «{scenario.title}»?</AlertDialogTitle>
              <AlertDialogDescription>
                Сервер отклонит удаление, если есть дочерние ветви — сначала удалите или переместите их. Связанные
                запуски не удаляются: они сохранятся и будут отвязаны от сценария.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction
                className="bg-rose-600 hover:bg-rose-700"
                onClick={(e) => {
                  e.preventDefault()
                  void onDelete()
                }}
              >
                Удалить
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}
