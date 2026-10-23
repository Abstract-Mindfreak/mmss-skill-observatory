// Роли исследования и назначения моделей (ТЗ п.9): карточки ролей
// с назначением backend/model через popover. Interpreter используется
// из атласа; рядом с Evaluator — честная пометка о независимости.
'use client'

import * as React from 'react'
import { Bot, Info, Plug, UserCog } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api-client'
import { useStore } from '@/lib/store'
import { ROLE_DESCRIPTIONS, ROLE_TITLES } from '@/lib/types'
import type { AssignmentDTO, RoleId } from '@/lib/types'
import { BackendPicker, BACKEND_NONE, type PickerState } from './backend-picker'
import { cn } from '@/lib/utils'

const LAB_ROLES: RoleId[] = ['executor', 'explorer', 'evaluator', 'challenger', 'editor', 'interpreter']

function assignmentText(a: AssignmentDTO | undefined): { label: string; mono: boolean } {
  if (!a || !a.backend) return { label: 'не назначено — выберите модель для запусков по умолчанию', mono: false }
  if (a.backend === 'session-cloud') return { label: 'Старое назначение session-cloud недоступно — выберите подключение', mono: false }
  return { label: `Назначено: ${a.backend} · подключение «${a.connectionName ?? '—'}» · модель ${a.model ?? 'не указана'}`, mono: true }
}

function AssignPopover({ role }: { role: RoleId }) {
  const { toast } = useToast()
  const appState = useStore((s) => s.appState)
  const sessionCloud = useStore((s) => s.sessionCloud)
  const refresh = useStore((s) => s.refresh)
  const projectId = appState?.project?.id ?? null
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const assignment = appState?.assignments.find((a) => a.role === role)

  const [value, setValue] = React.useState<PickerState>({ none: BACKEND_NONE })
  React.useEffect(() => {
    if (!open) return
    if (assignment?.backend === 'ollama')
      setValue({ mode: 'ollama', connectionId: assignment.connectionId, model: assignment.model })
    else if (assignment?.backend === 'freellmapi')
      setValue({ mode: 'freellmapi', connectionId: assignment.connectionId, model: assignment.model })
    else setValue({ none: BACKEND_NONE })
  }, [open, assignment])

  const valid = 'mode' in value && Boolean(value.connectionId && value.model)

  const save = async (backend: 'ollama' | 'freellmapi' | null) => {
    if (!projectId) return
    setBusy(true)
    try {
      const body: Parameters<typeof api.putAssignment>[0] = { projectId, role, backend }
      if ((backend === 'ollama' || backend === 'freellmapi') && 'mode' in value) {
        body.connectionId = value.connectionId ?? undefined
        body.model = value.model ?? undefined
      }
      await api.putAssignment(body)
      await refresh()
      toast({
        title: backend === null ? 'Назначение снято' : 'Назначение сохранено',
        description:
          backend === 'ollama' || backend === 'freellmapi'
              ? `${backend === 'freellmapi' ? 'FreeLLMAPI' : 'Ollama'}:${'connectionId' in value ? (appState?.connections.find((c) => c.id === value.connectionId)?.name ?? '—') : '—'}`
              : undefined,
      })
      setOpen(false)
    } catch (e) {
      toast({ title: 'Не удалось сохранить', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 shrink-0 gap-1 text-xs">
          <UserCog className="size-3.5" aria-hidden />
          {assignment?.backend ? 'Изменить' : 'Назначить'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">Назначение для «{ROLE_TITLES[role]}»</p>
            <p className="text-xs text-muted-foreground">
              Назначение — значение по умолчанию: в запуске его можно переопределить вручную.
            </p>
          </div>
          <BackendPicker
            idPrefix="as"
            value={value}
            onChange={(v) => setValue(v as PickerState)}
            connections={appState?.connections ?? []}
            sessionCloud={sessionCloud ?? appState?.sessionCloud ?? null}
            allowFreeLLMAPI
            noneOption={{ value: BACKEND_NONE, label: 'Не назначено' }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-muted-foreground"
              disabled={busy || !assignment?.backend}
              onClick={() => void save(null)}
            >
              Снять назначение
            </Button>
            <Button size="sm" disabled={!valid || busy} onClick={() => void save('mode' in value ? value.mode : null)}>
              {busy ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function RolesSection() {
  const appState = useStore((s) => s.appState)
  const sessionCloud = useStore((s) => s.sessionCloud)
  const setStudio = useStore((s) => s.setStudio)
  const connections = appState?.connections ?? []
  const okCount = connections.filter((c) => c.status === 'ok').length

  return (
    <Card className="border-border/70">
      <CardHeader className="gap-1 pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <Bot className="size-4 text-primary" aria-hidden />
          Роли и назначения
          <span className="ml-auto flex items-center gap-1.5 text-[10px] font-normal text-muted-foreground">
            Ollama: {okCount > 0 ? `${okCount} доступн.` : 'нет доступных'}
            {' · '}
            FreeLLMAPI: подключение настраивается в кабинете
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Назначение задаёт бэкенд по умолчанию для роли. Проверить подключения можно в{' '}
          <Button size="sm" variant="link" className="h-auto gap-1 p-0 text-xs" onClick={() => setStudio('connections')}>
            <Plug className="size-3" aria-hidden />
            кабинете подключений
          </Button>
          .
        </p>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {LAB_ROLES.map((role) => {
          const a = appState?.assignments.find((x) => x.role === role)
          const info = assignmentText(a)
          return (
            <div
              key={role}
              className={cn(
                'flex flex-col justify-between gap-2 rounded-lg border bg-card/60 p-3',
                role === 'evaluator' && 'border-amber-500/30'
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold">{ROLE_TITLES[role]}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
                </div>
                <AssignPopover role={role} />
              </div>
              <p className={cn('text-[11px]', info.mono ? 'font-mono' : 'text-muted-foreground')}>{info.label}</p>
              {role === 'evaluator' && (
                <p className="flex gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-1.5 text-[10px] leading-snug text-amber-700 dark:text-amber-300">
                  <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
                  Несколько вызовов одной модели не являются независимым подтверждением.
                </p>
              )}
              {role === 'interpreter' && (
                <p className="text-[10px] leading-snug text-muted-foreground">
                  Запускается из карточки фрагмента в атласе (интерпретация текста), а не из лаборатории.
                </p>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
