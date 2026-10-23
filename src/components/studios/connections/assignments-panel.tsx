// Панель назначений моделей по ролям: 7 ролей запусков + роль embedding.
'use client'

import * as React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InlineSpinner } from '@/components/shared/states'
import { StatusBadge } from '@/components/shared/status-badges'
import { useToast } from '@/hooks/use-toast'
import { api, ApiError } from '@/lib/api-client'
import { useStore } from '@/lib/store'
import { ROLE_DESCRIPTIONS, ROLE_TITLES, type RoleId } from '@/lib/types'
import { BackendSelect, describeBackend, type BackendValue } from './backend-select'

const ASSIGNMENT_ROLES: (RoleId | 'embedding')[] = [
  'executor',
  'explorer',
  'evaluator',
  'challenger',
  'editor',
  'assistant',
  'interpreter',
  'embedding',
]

const EMBEDDING_ROLE_TITLE = 'Embedding — векторные пробы'

export function AssignmentsPanel() {
  const { toast } = useToast()
  const appState = useStore((s) => s.appState)
  const sessionCloud = useStore((s) => s.sessionCloud)
  const refresh = useStore((s) => s.refresh)
  const [busyRole, setBusyRole] = React.useState<string | null>(null)

  const projectId = appState?.project?.id
  const connections = appState?.connections ?? []

  const assignmentOf = (role: string) => appState?.assignments.find((a) => a.role === role) ?? null

  const onChange = async (role: string, value: BackendValue) => {
    if (!projectId) return
    setBusyRole(role)
    try {
      const body =
        value.backend === null
          ? { projectId, role, backend: null }
          : { projectId, role, backend: value.backend, connectionId: value.connectionId, model: value.model }
      await api.putAssignment(body)
      await refresh()
      toast({ title: 'Назначение обновлено', description: `${role} → ${describeBackend(value)}` })
    } catch (e) {
      toast({
        title: 'Не удалось назначить',
        description: e instanceof ApiError ? e.message : e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setBusyRole(null)
    }
  }

  if (!projectId) return null

  return (
    <Card>
      <CardHeader className="gap-2 pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          Назначения моделей по ролям
          <StatusBadge status="LIVE" withHint={false} />
        </CardTitle>
        <CardDescription>
          Роли запусков используют назначение проекта: FreeLLMAPI или модель конкретного Ollama-подключения.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="hidden gap-3 px-2 text-[11px] uppercase tracking-wide text-muted-foreground md:grid md:grid-cols-[minmax(160px,1fr)_minmax(220px,1.4fr)_minmax(180px,1fr)]">
          <span>Роль</span>
          <span>Назначить</span>
          <span>Сейчас</span>
        </div>
        {ASSIGNMENT_ROLES.map((role) => {
          const a = assignmentOf(role)
          const value: BackendValue = a?.backend === 'ollama' || a?.backend === 'freellmapi'
            ? { backend: a.backend, connectionId: a.connectionId ?? '', model: a.model ?? '' }
            : { backend: null }
          const currentValueValid =
            (value.backend !== 'ollama' && value.backend !== 'freellmapi') || (!!value.connectionId && !!value.model)
          return (
            <div
              key={role}
              className="grid items-center gap-2 rounded-md border bg-card/60 p-3 md:grid-cols-[minmax(160px,1fr)_minmax(220px,1.4fr)_minmax(180px,1fr)] md:gap-3 md:border-transparent md:bg-transparent md:p-2"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{role === 'embedding' ? EMBEDDING_ROLE_TITLE : ROLE_TITLES[role]}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {role === 'embedding' ? 'embedding-пробы в кабинете подключений' : ROLE_DESCRIPTIONS[role]}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <BackendSelect
                  value={currentValueValid ? value : { backend: null }}
                  onChange={(v) => void onChange(role, v)}
                  connections={connections}
                  sessionAvailable={sessionCloud?.available}
                  allowFreeLLMAPI={role !== 'embedding'}
                  disabled={busyRole === role}
                  ariaLabel={`Назначение бэкенда для роли ${role}`}
                  className="w-full"
                />
                {busyRole === role && <InlineSpinner />}
              </div>
              <p className="truncate font-mono text-[11px] text-muted-foreground" title={describeBackend(a ?? { backend: null })}>
                {describeBackend(a ?? { backend: null })}
                {a && a.backend && !currentValueValid ? ' (модель не указана — переназначьте)' : ''}
              </p>
              {role === 'embedding' && (
                <p className="text-[11px] leading-relaxed text-muted-foreground md:col-span-3">
                  Роль embedding используется для embedding-проб; векторный индекс документа — PLACEHOLDER (см. Реестр).
                </p>
              )}
            </div>
          )
        })}
        <p className="text-[11px] text-muted-foreground">
          Назначения хранятся по проекту; удаление подключения сбрасывает их в «Не назначено». Прежде чем назначать
          модель Ollama, загрузите список моделей в карточке подключения.
        </p>
      </CardContent>
    </Card>
  )
}
