// Панель контекста и бэкенда чата помощника: выбранный фрагмент (или «без
// контекста»), бэкенд по назначению роли assistant или переопределение.
'use client'

import * as React from 'react'
import { BookOpen, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { FragmentRef } from '@/components/shared/misc'
import { useStore, assignmentFor } from '@/lib/store'
import { BackendSelect, describeBackend, type BackendValue } from '../connections/backend-select'
import { resolveTextBackend, type TextBackendChoice } from '@/lib/backend-routing'

export interface ChatBackendChoice {
  backend: 'ollama' | 'freellmapi'
  connectionId?: string
  model?: string
}

/** Что реально будет передано в api.sendChat. */
export function resolveChatBackend(
  override: BackendValue | null,
  assignment: { backend: string | null; connectionId: string | null; model: string | null }
): ChatBackendChoice | null {
  const actionChoice = override && (override.backend === 'ollama' || override.backend === 'freellmapi')
    ? override
    : null
  const assignmentChoice = (assignment.backend === 'ollama' || assignment.backend === 'freellmapi') && assignment.connectionId && assignment.model
    ? { backend: assignment.backend, connectionId: assignment.connectionId, model: assignment.model } satisfies TextBackendChoice
    : null
  return resolveTextBackend(actionChoice, assignmentChoice)
}

export function ContextPanel({
  useContext,
  onUseContextChange,
  override,
  onOverrideChange,
  resolvedBackend,
}: {
  useContext: boolean
  onUseContextChange: (v: boolean) => void
  override: BackendValue | null
  onOverrideChange: (v: BackendValue | null) => void
  resolvedBackend: ChatBackendChoice | null
}) {
  const appState = useStore((s) => s.appState)
  const sessionCloud = useStore((s) => s.sessionCloud)
  const selectedFragmentId = useStore((s) => s.selectedFragmentId)
  const setStudio = useStore((s) => s.setStudio)
  const assignment = useStore((s) => assignmentFor(s, 'assistant'))

  const selectedFragment = selectedFragmentId ? appState?.fragments.find((f) => f.id === selectedFragmentId) ?? null : null
  const section = React.useMemo(() => {
    if (!selectedFragment) return null
    const prefix = selectedFragment.path.split('.')[0]
    return (
      appState?.fragments.find((f) => f.kind === 'section' && selectedFragment.path.startsWith(`${f.path}.`)) ??
      appState?.fragments.find((f) => f.kind === 'section' && f.path === prefix) ??
      null
    )
  }, [selectedFragment, appState])
  const connName =
    resolvedBackend?.backend === 'ollama' || resolvedBackend?.backend === 'freellmapi'
      ? appState?.connections.find((c) => c.id === resolvedBackend.connectionId)?.name
      : undefined

  const assignmentValue = assignment ?? { backend: null, connectionId: null, model: null }
  const selectValue: BackendValue =
    override ?? ((assignmentValue.backend === 'ollama' || assignmentValue.backend === 'freellmapi') && assignmentValue.connectionId && assignmentValue.model ? { backend: assignmentValue.backend, connectionId: assignmentValue.connectionId, model: assignmentValue.model } : { backend: null })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-2 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <BookOpen className="size-4 text-primary" aria-hidden />
            Контекст
          </CardTitle>
          <CardDescription>Помощник отвечает по контексту выбранного фрагмента.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {selectedFragment ? (
            <>
              <FragmentRef fragment={selectedFragment} />
              {section && (
                <p className="text-[11px] text-muted-foreground">
                  Раздел: <span className="font-mono">{section.path}</span>
                  {section.title ? ` · ${section.title}` : ''}
                </p>
              )}
              <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-muted/50">
                <Checkbox
                  checked={useContext}
                  onCheckedChange={(v) => onUseContextChange(v === true)}
                  className="mt-0.5"
                  aria-label="Передавать фрагмент как контекст"
                />
                <span className="text-xs leading-relaxed">
                  Передавать фрагмент как контекст
                  <span className="block text-[10px] text-muted-foreground">
                    без контекста помощник видит только историю диалога
                  </span>
                </span>
              </label>
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">без контекста</p>
              <Button size="sm" variant="outline" onClick={() => setStudio('atlas')}>
                Выбрать фрагмент в атласе
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-2 pb-3">
          <CardTitle className="text-sm">Бэкенд модели</CardTitle>
          <CardDescription>
            По умолчанию — назначение роли assistant (см. кабинет подключений); можно переопределить для этого диалога.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          <Label className="text-[11px] text-muted-foreground">
            {override == null ? 'по назначению роли assistant' : 'переопределено для этого диалога'}
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <BackendSelect
              value={selectValue}
              onChange={(v) => onOverrideChange(v.backend === null ? null : v)}
              connections={appState?.connections ?? []}
              sessionAvailable={sessionCloud?.available}
              allowFreeLLMAPI
              noneLabel="По назначению (assistant)"
              ariaLabel="Бэкенд модели помощника"
              className="min-w-52"
            />
          </div>
          <p className="font-mono text-[10px] text-muted-foreground">
            будет использован:{' '}
            {resolvedBackend ? describeBackend({ ...resolvedBackend, connectionName: connName }) : 'не назначено — выберите бэкенд'}
          </p>
          {resolvedBackend == null && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300" role="alert">
              Роль assistant не назначена. Назначьте бэкенд в кабинете подключений или выберите его здесь.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex items-start gap-2.5 rounded-md border p-3">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Ответы генерирует модель: каждое утверждение — модельная оценка (model-evaluated provenance), а не проверенный
          факт о документе. Чего нет в контексте — помощник должен сказать прямо; сверяйте важное с текстом в атласе.
        </p>
      </div>
    </div>
  )
}
