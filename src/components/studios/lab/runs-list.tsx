// Список запусков: фильтры (роль/статус/бэкенд/происхождение),
// автообновление каждые 5 с пока есть активные запуски, отмена.
'use client'

import * as React from 'react'
import { Ban, Bot, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { InlineSpinner } from '@/components/shared/states'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { OriginBadge, RunStatusBadge, VerdictBadge } from '@/components/shared/status-badges'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api-client'
import { useStore } from '@/lib/store'
import { ROLE_TITLES } from '@/lib/types'
import type { RoleId, RunStatus } from '@/lib/types'
import { backendModelLabel, fmtDuration, fmtTime, roleShort, RUN_STATUS_LABELS } from './format'
import { cn } from '@/lib/utils'

const FILTER_ROLES: RoleId[] = ['executor', 'explorer', 'evaluator', 'challenger', 'editor', 'assistant', 'interpreter']
const STATUSES: RunStatus[] = ['running', 'queued', 'completed', 'failed', 'cancelled', 'planned']

function VerdictByIcon({ by }: { by: 'user' | 'model' | 'program' }) {
  if (by === 'user')
    return (
      <span title="Вердикт выставил пользователь (исходный вердикт модели сохранён)">
        <User className="size-3 text-amber-600 dark:text-amber-400" aria-hidden />
      </span>
    )
  if (by === 'model')
    return (
      <span title="Вердикт выставила модель">
        <Bot className="size-3 text-muted-foreground" aria-hidden />
      </span>
    )
  return (
    <span title="Вердикт выставлен программной проверкой">
      <Bot className="size-3 text-teal-500" aria-hidden />
    </span>
  )
}

export function RunsList() {
  const { toast } = useToast()
  const appState = useStore((s) => s.appState)
  const refresh = useStore((s) => s.refresh)
  const selectedRunId = useStore((s) => s.selectedRunId)
  const selectRun = useStore((s) => s.selectRun)

  const [roleF, setRoleF] = React.useState<string>('all')
  const [statusF, setStatusF] = React.useState<string>('all')
  const [backendF, setBackendF] = React.useState<string>('all')
  const [originF, setOriginF] = React.useState<'all' | 'real' | 'demo'>('all')
  const [cancelBusy, setCancelBusy] = React.useState<Set<string>>(() => new Set())

  const projectId = appState?.project?.id ?? null
  const runs = appState?.runs ?? []
  const anyActive = runs.some((r) => r.status === 'running' || r.status === 'queued')

  // poll while something is running/queued
  React.useEffect(() => {
    if (!projectId || !anyActive) return
    let stopped = false
    const tick = async () => {
      if (stopped) return
      try {
        const fresh = await api.runs(projectId, 200)
        if (stopped) return
        useStore.setState((s) => (s.appState ? { appState: { ...s.appState, runs: fresh } } : {}))
      } catch {
        /* next tick retries */
      }
    }
    const iv = setInterval(() => void tick(), 5000)
    return () => {
      stopped = true
      clearInterval(iv)
    }
  }, [projectId, anyActive])

  const filtered = React.useMemo(
    () =>
      runs.filter((r) => {
        if (roleF !== 'all' && r.role !== roleF) return false
        if (statusF !== 'all' && r.status !== statusF) return false
        if (backendF !== 'all' && r.backend !== backendF) return false
        if (originF === 'real' && r.origin === 'demo') return false
        if (originF === 'demo' && r.origin !== 'demo') return false
        return true
      }),
    [runs, roleF, statusF, backendF, originF]
  )

  const onCancel = async (id: string) => {
    setCancelBusy((prev) => new Set([...prev, id]))
    try {
      await api.cancelRun(id)
      await refresh()
      toast({ title: 'Запуск отменён', description: 'Статус обновлён — результат не сохранён.' })
    } catch (e) {
      toast({
        title: 'Не удалось отменить',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setCancelBusy((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  return (
    <Card className="border-border/70">
      <CardHeader className="gap-1 pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          Запуски
          <Badge variant="secondary" className="text-[10px]">
            {filtered.length} из {runs.length}
          </Badge>
          {anyActive && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] text-teal-600 dark:text-teal-300">
              <span className="pulse-dot size-1.5 rounded-full bg-teal-400" aria-hidden />
              автообновление каждые 5 с
            </span>
          )}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          <Select value={roleF} onValueChange={setRoleF}>
            <SelectTrigger size="sm" className="h-7 w-36 text-[11px]" aria-label="Фильтр по роли">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">
                Все роли
              </SelectItem>
              <SelectGroup>
                {FILTER_ROLES.map((r) => (
                  <SelectItem key={r} value={r} className="text-xs">
                    {ROLE_TITLES[r]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={statusF} onValueChange={setStatusF}>
            <SelectTrigger size="sm" className="h-7 w-32 text-[11px]" aria-label="Фильтр по статусу">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">
                Любой статус
              </SelectItem>
              {STATUSES.map((st) => (
                <SelectItem key={st} value={st} className="text-xs">
                  {RUN_STATUS_LABELS[st]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={backendF} onValueChange={setBackendF}>
            <SelectTrigger size="sm" className="h-7 w-40 text-[11px]" aria-label="Фильтр по бэкенду">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">
                Любой бэкенд
              </SelectItem>
              <SelectItem value="session-cloud" className="text-xs">
                session-cloud
              </SelectItem>
              <SelectItem value="ollama" className="text-xs">
                Ollama
              </SelectItem>
              <SelectItem value="demo" className="text-xs">
                DEMO
              </SelectItem>
            </SelectContent>
          </Select>
          <ToggleGroup
            type="single"
            value={originF}
            onValueChange={(v) => v && setOriginF(v as 'all' | 'real' | 'demo')}
            className="gap-1"
          >
            <ToggleGroupItem value="all" className="h-7 px-2 text-[11px]">
              Все
            </ToggleGroupItem>
            <ToggleGroupItem value="real" className="h-7 px-2 text-[11px]">
              Реальные
            </ToggleGroupItem>
            <ToggleGroupItem value="demo" className="h-7 px-2 text-[11px] text-amber-600 dark:text-amber-300">
              DEMO
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {runs.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
            Запусков ещё нет. Настройте назначения ролей и выполните первый запуск — ошибки будут показаны честно.
          </p>
        ) : filtered.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
            По фильтрам ничего не найдено.
          </p>
        ) : (
          <div className="max-h-[26rem] divide-y overflow-y-auto scroll-observatory rounded-md border">
            {filtered.map((r) => {
              const selected = r.id === selectedRunId
              return (
                <div
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectRun(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      selectRun(r.id)
                    }
                  }}
                  className={cn(
                    'flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-2 text-xs transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    selected && 'bg-primary/10',
                    r.origin === 'demo' && !selected && 'bg-amber-500/5'
                  )}
                >
                  <span className="font-mono text-[10px] text-muted-foreground" title={fmtTime(r.createdAt)}>
                    {fmtTime(r.createdAt).split(', ').pop()}
                  </span>
                  <span className="font-medium">{roleShort(r.role)}</span>
                  <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
                    {backendModelLabel(r)}
                  </span>
                  <RunStatusBadge status={r.status} />
                  {r.role === 'evaluator' && (
                    <span className="flex items-center gap-1">
                      <VerdictBadge verdict={r.verdict} by={r.verdictBy} modelVerdict={r.modelVerdict} />
                      {r.verdictBy && <VerdictByIcon by={r.verdictBy} />}
                    </span>
                  )}
                  {r.origin === 'demo' && <OriginBadge origin="demo" />}
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">{fmtDuration(r.durationMs)}</span>
                    {(r.status === 'running' || r.status === 'queued') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 gap-1 px-1.5 text-[11px] text-rose-500 hover:text-rose-600"
                        disabled={cancelBusy.has(r.id)}
                        onClick={(e) => {
                          e.stopPropagation()
                          void onCancel(r.id)
                        }}
                      >
                        {cancelBusy.has(r.id) ? <InlineSpinner label="" /> : <Ban className="size-3" aria-hidden />}
                        Отменить
                      </Button>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">
          В проекте хранятся и показываются последние 200 запусков. Нажмите на строку, чтобы открыть детали; статус
          выполнения ≠ вердикт проверки.
        </p>
      </CardContent>
    </Card>
  )
}
