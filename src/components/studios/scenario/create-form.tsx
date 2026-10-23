// Форма создания ветви (дочерней или корневой). Used by details panel
// (child) and by the studio header / empty state (root).
'use client'

import * as React from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ErrorState } from '@/components/shared/states'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api-client'
import { useStore } from '@/lib/store'
import type { ScenarioDTO } from '@/lib/types'

export function ScenarioCreateForm({
  parentId,
  onCreated,
  onCancel,
  autoFocus = false,
}: {
  parentId: string | null
  onCreated?: (scenario: ScenarioDTO) => void
  onCancel?: () => void
  autoFocus?: boolean
}) {
  const { toast } = useToast()
  const refresh = useStore((s) => s.refresh)
  const projectId = useStore((s) => s.appState?.project?.id ?? null)
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const submit = async () => {
    if (!projectId) return
    const t = title.trim()
    if (!t) {
      setError('Заголовок обязателен')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await api.createScenario(projectId, {
        parentId: parentId ?? undefined,
        title: t,
        description: description.trim() ? description.trim() : undefined,
      })
      await refresh()
      toast({ title: 'Ветвь создана', description: `«${t}»` })
      setTitle('')
      setDescription('')
      onCreated?.(created)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать ветвь')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="space-y-1">
        <Label htmlFor="sc-title" className="text-xs">
          Заголовок ветви
        </Label>
        <Input
          id="sc-title"
          autoFocus={autoFocus}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={parentId ? 'механизм отказа или граничная ситуация' : 'тема-корень, например «Недоступный источник»'}
          className="h-8 text-xs"
          maxLength={300}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="sc-desc" className="text-xs">
          Описание (необязательно)
        </Label>
        <Textarea
          id="sc-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="условие возникновения, нарушаемое свойство, минимальный пример"
          className="min-h-16 text-xs"
          maxLength={2000}
        />
      </div>
      {error && <ErrorState error={error} title="Не удалось создать" />}
      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
            Отмена
          </Button>
        )}
        <Button size="sm" onClick={() => void submit()} disabled={busy || !title.trim()}>
          <Plus className="size-3.5" aria-hidden />
          {busy ? 'Создание…' : parentId ? 'Добавить ветвь' : 'Создать корневую ветвь'}
        </Button>
      </div>
    </div>
  )
}
