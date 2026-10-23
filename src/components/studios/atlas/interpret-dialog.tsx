// Interpret fragment dialog: choose a configured text connection and run the
// Interpreter role for a single fragment via POST /api/versions/{id}/analyze-model.

'use client'

import * as React from 'react'
import { Loader2, Plug, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ErrorState, InlineSpinner } from '@/components/shared/states'
import { StatusBadge } from '@/components/shared/status-badges'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api-client'
import type { FragmentDTO } from '@/lib/types'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { InstructionContextSelector } from '@/components/shared/instruction-context-selector'
import { RolePromptPreview } from '@/components/shared/role-prompt-preview'
import type { InstructionContextSelection } from '@/lib/instruction-context'

export function InterpretDialog({
  open,
  onOpenChange,
  fragment,
  versionId,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  fragment: FragmentDTO
  versionId: string
}) {
  const { toast } = useToast()
  const appState = useStore((s) => s.appState)
  const refresh = useStore((s) => s.refresh)
  const loadFragmentCard = useStore((s) => s.loadFragmentCard)

  const connections = appState?.connections ?? []
  const assignments = appState?.assignments ?? []
  const assignment = assignments.find((x) => x.role === 'interpreter') ?? null

  const [backend, setBackend] = React.useState<'ollama' | 'freellmapi' | null>(null)
  const [connectionId, setConnectionId] = React.useState('')
  const [model, setModel] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [instructionContext, setInstructionContext] = React.useState<InstructionContextSelection>({ mode: 'none', versionId, fragmentIds: [], includeParentSections: false })
  const versions = (appState?.documents ?? []).flatMap((document) => document.versions.map((version) => ({ version, documentTitle: document.title })))

  // pick defaults each time the dialog opens
  React.useEffect(() => {
    if (!open) return
    setError(null)
    setInstructionContext({ mode: 'none', versionId, fragmentIds: [], includeParentSections: false })
    const b = assignment?.backend === 'ollama' || assignment?.backend === 'freellmapi' ? assignment.backend : null
    if (!b) {
      setBackend(null)
      setConnectionId('')
      setModel('')
      return
    }
    setBackend(b)
    if (b === 'ollama' || b === 'freellmapi') {
      const conn = connections.find((c) => c.id === assignment?.connectionId && c.kind === b) ?? null
      setConnectionId(conn?.id ?? '')
      const models = (conn?.models ?? []).filter((m) => m.generate)
      setModel(
        assignment?.model && models.some((m) => m.name === assignment.model)
          ? assignment.model
          : (models[0]?.name ?? '')
      )
    }
  }, [open, assignment, connections])

  const connection = backend ? connections.find((c) => c.id === connectionId && c.kind === backend) ?? null : null
  const models = (connection?.models ?? []).filter((m) => m.generate)
  const canSubmit = !!(backend && connection && model)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (!backend || !connectionId || !model) throw new Error('Назначьте Interpreter в «Подключениях» или выберите FreeLLMAPI/Ollama для этого действия.')
      const res = await api.analyzeModel(versionId, {
        backend,
        connectionId,
        model,
        fragmentIds: [fragment.id],
        instructionContext,
      })
      const item = res.items.find((i) => i.fragmentId === fragment.id)
      if (item?.error) {
        setError(item.error)
        return
      }
      toast({ title: 'Интерпретация получена' })
      await refresh()
      await loadFragmentCard(fragment.id, true)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось выполнить интерпретацию')
    } finally {
      setBusy(false)
    }
  }

  const hasAnyBackend = connections.length > 0

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden />
            Интерпретация фрагмента
            <span className="font-mono text-xs text-muted-foreground">{fragment.path}</span>
          </DialogTitle>
          <DialogDescription>
            Роль Interpreter прочитает фрагмент и вернёт интерпретацию, альтернативные прочтения, область
            действия и ограничения. Ответ модели — оценка, а не истина.
          </DialogDescription>
        </DialogHeader>

        {hasAnyBackend ? (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/30 p-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Фрагмент
              </p>
              <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                {fragment.text}
              </p>
            </div>

            <InstructionContextSelector value={instructionContext} onChange={setInstructionContext} versions={versions} disabled={busy} />
            <RolePromptPreview projectId={appState?.project?.id ?? null} role="interpreter" contextSelection={instructionContext} fragmentId={fragment.id} promptContext={{}} />

            <div className="space-y-2">
              <Label className="text-xs">Бэкенд модели</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={!connections.some((c) => c.kind === 'ollama') || busy}
                  onClick={() => setBackend('ollama')}
                  className={cn(
                    'rounded-md border p-2.5 text-left text-xs transition-colors',
                    backend === 'ollama' ? 'border-primary/60 bg-primary/10' : 'hover:bg-muted/60'
                  )}
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    Ollama — локально
                  </span>
                  <span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">
                    {connections.length > 0
                      ? 'Реальный вызов вашей локальной модели через подключение.'
                      : 'Нет подключений — добавьте в разделе «Подключения».'}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={!connections.some((c) => c.kind === 'freellmapi') || busy}
                  onClick={() => setBackend('freellmapi')}
                  className={cn(
                    'rounded-md border p-2.5 text-left text-xs transition-colors',
                    backend === 'freellmapi' ? 'border-primary/60 bg-primary/10' : 'hover:bg-muted/60'
                  )}
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    FreeLLMAPI — шлюз
                    <StatusBadge status="LIVE" withHint={false} />
                  </span>
                  <span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">
                    Выберите подключение FreeLLMAPI и запрашиваемую модель (например, auto).
                  </span>
                </button>
              </div>
            </div>

            {backend && (
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <Label htmlFor="interpret-connection" className="text-xs">
                    Подключение
                  </Label>
                  <Select value={connectionId} onValueChange={(v) => { setConnectionId(v); setModel('') }} disabled={busy}>
                    <SelectTrigger id="interpret-connection" className="h-8 text-xs">
                      <SelectValue placeholder="Выберите подключение" />
                    </SelectTrigger>
                    <SelectContent>
                      {connections.filter((c) => c.kind === backend).map((c) => (
                        <SelectItem key={c.id} value={c.id} className="text-xs">
                          {c.name} · {c.baseUrl}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="interpret-model" className="text-xs">
                    Модель
                  </Label>
                  <Select value={model} onValueChange={setModel} disabled={busy || !connection}>
                    <SelectTrigger id="interpret-model" className="h-8 text-xs">
                      <SelectValue placeholder={connection ? 'Выберите модель' : 'Сначала подключение'} />
                    </SelectTrigger>
                    <SelectContent>
                      {models.map((m) => (
                        <SelectItem key={m.name} value={m.name} className="text-xs">
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {connection && models.length === 0 && (
                    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Plug className="size-3" aria-hidden />
                      Список моделей пуст — обновите его в разделе «Подключения» (кнопка «Модели»).
                    </p>
                  )}
                </div>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground">
              Ограничение сервиса: не более 12 фрагментов за один запрос — здесь 1 фрагмент.
            </p>

            {error && <ErrorState error={error} title="Интерпретация не выполнена" />}
          </div>
        ) : (
          <EmptyBackend />
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Отмена
          </Button>
          {hasAnyBackend && (
            <Button size="sm" className="gap-1.5" disabled={!canSubmit || busy} onClick={() => void submit()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
              {busy ? 'Интерпретация…' : 'Интерпретировать'}
            </Button>
          )}
        </DialogFooter>
        {busy && (
          <p className="sr-only" role="status">
            Выполняется запрос к модели
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

function EmptyBackend() {
  const setStudio = useStore((s) => s.setStudio)
  return (
    <div className="rounded-md border border-dashed p-4 text-center">
      <p className="text-sm font-medium">Нет доступных бэкендов моделей</p>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
          Облачный бэкенд сессии недоступен, локальные подключения не созданы. Добавьте подключение в
        разделе «Подключения» и обновите список моделей.
      </p>
      <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => setStudio('connections')}>
        <Plug className="size-3.5" aria-hidden />
        Открыть подключения
      </Button>
    </div>
  )
}
