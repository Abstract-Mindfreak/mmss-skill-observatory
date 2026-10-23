// Создание экспериментальной ветки: редактор текста поверх родительской версии.
// Предпросмотр последствий — строго локальный расчёт (без обращений к модели);
// модельные анализы — отдельные явные действия с указанием числа запросов.
'use client'

import * as React from 'react'
import { FileDiff, Save } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { InlineSpinner } from '@/components/shared/states'
import { useStore } from '@/lib/store'
import type { DocumentVersionDTO } from '@/lib/types'

export interface ExperimentDraft {
  parentId: string
  label: string
  note: string
  content: string | null
}

export function ExperimentDialog({
  open,
  onOpenChange,
  parent,
  draft,
  onDraftChange,
  onPreviewImpact,
  onSave,
  previewBusy,
  saveBusy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  parent: DocumentVersionDTO | null
  draft: ExperimentDraft
  onDraftChange: (patch: Partial<ExperimentDraft>) => void
  onPreviewImpact: () => void
  onSave: () => void
  previewBusy: boolean
  saveBusy: boolean
}) {
  const loadVersionContent = useStore((s) => s.loadVersionContent)
  const parentContent = useStore((s) => (parent ? s.versionContent[parent.id] : undefined))
  const [contentLoading, setContentLoading] = React.useState(false)
  const [contentError, setContentError] = React.useState<string | null>(null)

  // Загрузка содержимого родителя при открытии (кэш store).
  React.useEffect(() => {
    if (!open || !parent || draft.content !== null) return
    let cancelled = false
    setContentLoading(true)
    setContentError(null)
    loadVersionContent(parent.id)
      .then((content) => {
        if (cancelled) return
        if (content === null) setContentError('Не удалось загрузить содержимое родительской версии')
        else onDraftChange({ content })
      })
      .finally(() => {
        // без guard: гонка с cleanup-флагом могла навсегда оставить спиннер
        setContentLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, parent, draft.content, loadVersionContent, onDraftChange])

  const modified =
    parent !== null &&
    draft.content !== null &&
    parentContent !== undefined &&
    draft.content !== parentContent

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            Экспериментальная ветка
            {modified ? (
              <Badge variant="outline" className="border-emerald-500/50 bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400">
                текст изменён
              </Badge>
            ) : (
              <Badge variant="outline" className="border-dashed text-[10px] text-muted-foreground">
                текст не отличается от родителя
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Родитель: <span className="font-mono">{parent?.label ?? '—'}</span>
            {parent ? ` · ${parent.fragmentCount} фрагментов · ${parent.lineCount} строк` : ''}. Отредактируйте
            текст (например, переформулируйте одно предложение) — предпросмотр последствий вычисляется локально,
            без обращений к модели.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="exp-label">Метка ветки</Label>
            <Input
              id="exp-label"
              className="font-mono"
              value={draft.label}
              onChange={(e) => onDraftChange({ label: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-note">Заметка (зачем эта ветка)</Label>
            <Input
              id="exp-note"
              value={draft.note}
              placeholder="например: ужесточил формулировку §6.2"
              onChange={(e) => onDraftChange({ note: e.target.value })}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="exp-content">Содержимое (Markdown)</Label>
            {draft.content !== null && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {draft.content.length.toLocaleString('ru-RU')} симв.
              </span>
            )}
          </div>
          {contentLoading ? (
            <div className="flex min-h-[420px] items-center justify-center rounded-md border border-dashed">
              <InlineSpinner label="Загрузка текста родительской версии…" />
            </div>
          ) : contentError ? (
            <p className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-600 dark:text-rose-400">
              {contentError}
            </p>
          ) : (
            <Textarea
              id="exp-content"
              value={draft.content ?? ''}
              onChange={(e) => onDraftChange({ content: e.target.value })}
              className="scroll-observatory min-h-[420px] resize-y font-mono text-xs leading-relaxed"
              spellCheck={false}
              aria-label="Содержимое экспериментальной версии"
            />
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center">
          <p className="mr-auto max-w-sm text-[11px] leading-snug text-muted-foreground">
            Изменение текста само по себе не вызывает запросов к моделям. Анализ последствий — локальный расчёт
            (0 запросов); интерпретации и повторные запуски выполняются отдельно и явно.
          </p>
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            onClick={onPreviewImpact}
            disabled={previewBusy || saveBusy || draft.content === null || !modified}
            title={modified ? undefined : 'Сначала измените текст относительно родительской версии'}
          >
            {previewBusy ? <InlineSpinner label="Локальный расчёт…" /> : <><FileDiff className="size-3.5" aria-hidden />Анализ последствий (без сохранения)</>}
          </Button>
          <Button
            type="button"
            className="gap-1.5"
            onClick={onSave}
            disabled={saveBusy || previewBusy || draft.content === null || !modified}
            title={modified ? undefined : 'Сохранение ветки требует изменений относительно родителя'}
          >
            {saveBusy ? <InlineSpinner label="Сохранение…" /> : <><Save className="size-3.5" aria-hidden />Сохранить ветку</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
