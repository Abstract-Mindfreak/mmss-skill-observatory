// Менеджер DEMO-данных: подсчёт, загрузка, удаление (с подтверждением),
// краткий список демо-объектов с OriginBadge.
'use client'

import * as React from 'react'
import { FlaskConical, Trash2 } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InlineSpinner } from '@/components/shared/states'
import { OriginBadge, RunStatusBadge } from '@/components/shared/status-badges'
import { useToast } from '@/hooks/use-toast'
import { ApiError, api } from '@/lib/api-client'
import { useStore } from '@/lib/store'

export function DemoManager() {
  const { toast } = useToast()
  const appState = useStore((s) => s.appState)
  const refresh = useStore((s) => s.refresh)
  const [seedBusy, setSeedBusy] = React.useState(false)
  const [purgeBusy, setPurgeBusy] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  const projectId = appState?.project?.id
  const demoScenarios = appState?.scenarios.filter((s) => s.origin === 'demo') ?? []
  const demoRuns = appState?.runs.filter((r) => r.origin === 'demo') ?? []
  const demoFindings = appState?.findings.filter((f) => f.origin === 'demo') ?? []
  const demoNotes = appState?.notes.filter((n) => n.origin === 'demo') ?? []
  const demoCount = demoScenarios.length + demoRuns.length + demoFindings.length + demoNotes.length

  const onSeed = async () => {
    if (!projectId) return
    setSeedBusy(true)
    try {
      const r = await api.seedDemo(projectId)
      await refresh()
      const c = r.counts
      toast({
        title: r.note ? 'DEMO-данные уже загружены' : 'DEMO-данные загружены',
        description:
          r.note ??
          `сценариев: ${c.scenarios}, запусков: ${c.runs}, находок: ${c.findings}, заметок: ${c.notes} — все с пометкой DEMO`,
      })
    } catch (e) {
      toast({
        title: 'Не удалось загрузить DEMO-данные',
        description: e instanceof ApiError ? e.message : e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setSeedBusy(false)
    }
  }

  const onPurge = async () => {
    if (!projectId) return
    setPurgeBusy(true)
    try {
      const r = await api.purgeDemo(projectId)
      await refresh()
      const c = r.counts
      toast({
        title: 'DEMO-данные удалены',
        description: `сценариев: ${c.scenarios}, запусков: ${c.runs}, находок: ${c.findings}, заметок: ${c.notes}`,
      })
    } catch (e) {
      toast({
        title: 'Не удалось удалить DEMO-данные',
        description: e instanceof ApiError ? e.message : e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setPurgeBusy(false)
      setConfirmOpen(false)
    }
  }

  return (
    <Card>
      <CardHeader className="gap-2 pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <FlaskConical className="size-4 text-primary" aria-hidden />
          DEMO-данные
          <OriginBadge origin={demoCount > 0 ? 'demo' : 'real'} />
          <span className="font-mono text-[10px] text-muted-foreground">объектов: {demoCount}</span>
        </CardTitle>
        <CardDescription>
          Синтетические данные для демонстрации интерфейса. Загружаются только по явной кнопке и полностью удаляются
          одной кнопкой.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <DemoStat label="Сценарии" value={demoScenarios.length} />
          <DemoStat label="Запуски" value={demoRuns.length} />
          <DemoStat label="Находки" value={demoFindings.length} />
          <DemoStat label="Заметки" value={demoNotes.length} />
        </div>
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
          DEMO-данные помечены, не входят в реальные метрики и не выдаются за исследование прикреплённого файла.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {seedBusy ? (
            <InlineSpinner label="Загружаю DEMO-данные…" />
          ) : (
            <Button size="sm" variant="outline" className="gap-1.5" disabled={!projectId} onClick={() => void onSeed()}>
              Загрузить демо-данные
            </Button>
          )}
          {purgeBusy ? (
            <InlineSpinner label="Удаляю…" />
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-rose-500 hover:text-rose-400"
              disabled={!projectId || demoCount === 0}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="size-3.5" aria-hidden />
              Удалить все DEMO-данные
            </Button>
          )}
        </div>

        {demoCount > 0 && (
          <div className="scroll-observatory max-h-64 space-y-1 overflow-y-auto rounded-md border p-2.5">
            {demoScenarios.map((s) => (
              <p key={s.id} className="flex items-center gap-1.5 text-[11px]">
                <OriginBadge origin="demo" />
                <span className="truncate">сценарий: {s.title}</span>
              </p>
            ))}
            {demoRuns.map((r) => (
              <p key={r.id} className="flex items-center gap-1.5 text-[11px]">
                <OriginBadge origin="demo" />
                <span className="truncate">
                  запуск: <span className="font-mono">{r.role}</span>
                </span>
                <RunStatusBadge status={r.status} compact />
              </p>
            ))}
            {demoFindings.map((f) => (
              <p key={f.id} className="flex items-center gap-1.5 text-[11px]">
                <OriginBadge origin="demo" />
                <span className="truncate">находка: {f.title}</span>
              </p>
            ))}
            {demoNotes.map((n) => (
              <p key={n.id} className="flex items-center gap-1.5 text-[11px]">
                <OriginBadge origin="demo" />
                <span className="truncate">заметка: {n.body.slice(0, 60)}{n.body.length > 60 ? '…' : ''}</span>
              </p>
            ))}
          </div>
        )}

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-sm">Удалить все DEMO-данные?</AlertDialogTitle>
              <AlertDialogDescription>
                Будут удалены все объекты с пометкой DEMO ({demoCount}): сценарии, запуски, находки и заметки. Реальные
                данные исследования не затрагиваются.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={purgeBusy}>Отмена</AlertDialogCancel>
              <AlertDialogAction
                disabled={purgeBusy}
                className="bg-rose-600 text-white hover:bg-rose-500"
                onClick={(e) => {
                  e.preventDefault()
                  void onPurge()
                }}
              >
                {purgeBusy ? 'Удаление…' : 'Удалить'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}

function DemoStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-card/60 p-2.5">
      <p className="font-mono text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  )
}
