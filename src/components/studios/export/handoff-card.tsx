// Research Handoff Report — конструктор передачи исследования (ТЗ п.14):
// выбор частей, формат md/json, скачивание и копирование.
'use client'

import * as React from 'react'
import { ClipboardCopy, Download, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { CopyButton } from '@/components/shared/copy'
import { InlineSpinner } from '@/components/shared/states'
import { useToast } from '@/hooks/use-toast'
import { ApiError, downloadFile, handoffUrl } from '@/lib/api-client'
import { useStore } from '@/lib/store'
import { fetchAsText } from './markdown'

const HANDOFF_PARTS: { id: string; label: string; hint: string }[] = [
  { id: 'goal', label: 'Цель', hint: 'цель исследования + автоматическая сводка' },
  { id: 'document', label: 'Документ', hint: 'документ, версия, hash, источник, полнота' },
  { id: 'changes', label: 'Изменения', hint: 'версии/ветки, diff-сводки' },
  { id: 'analyses', label: 'Анализы', hint: 'выполненные анализы: тип, backend, модель, сводка' },
  { id: 'runs', label: 'Запуски', hint: 'роль, backend, модель, статус, вердикт, длительность' },
  { id: 'runs-full', label: 'Запуски — полные', hint: 'с полными входами/выходами (opt-in)' },
  { id: 'findings', label: 'Находки', hint: 'находки с обоснованием' },
  { id: 'evidence', label: 'Основания', hint: 'паспорта цепочек доказательств' },
  { id: 'disputed', label: 'Спорные выводы', hint: 'оспоренные заключения' },
  { id: 'hypotheses', label: 'Гипотезы', hint: 'непроверенные гипотезы' },
  { id: 'errors', label: 'Ошибки', hint: 'ошибки выполнения' },
  { id: 'limitations', label: 'Ограничения', hint: 'ограничения методов' },
  { id: 'placeholders', label: 'Заглушки', hint: 'нереализованные функции' },
  { id: 'next-steps', label: 'Следующие шаги', hint: 'вычисляемые полезные действия' },
]

const DEFAULT_PARTS = HANDOFF_PARTS.filter((p) => p.id !== 'runs-full').map((p) => p.id)

export function HandoffCard() {
  const { toast } = useToast()
  const projectId = useStore((s) => s.appState?.project?.id) ?? null
  const [parts, setParts] = React.useState<Set<string>>(new Set(DEFAULT_PARTS))
  const [format, setFormat] = React.useState<'md' | 'json'>('md')
  const [includeFullSkillText, setIncludeFullSkillText] = React.useState(false)
  const [downloadBusy, setDownloadBusy] = React.useState(false)

  const toggle = (id: string) => {
    setParts((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const partsParam = Array.from(parts).join(',')
  const url = projectId ? handoffUrl(projectId, format, partsParam, includeFullSkillText) : ''
  const empty = parts.size === 0

  const onDownload = async () => {
    if (!projectId || empty) return
    setDownloadBusy(true)
    try {
      await downloadFile(url, `handoff.${format}`)
      toast({ title: 'Отчёт передаче сформирован', description: `формат ${format}, частей: ${parts.size}` })
    } catch (e) {
      toast({
        title: 'Не удалось скачать отчёт',
        description: e instanceof ApiError ? e.message : e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setDownloadBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="gap-2 pb-3">
        <CardTitle className="text-sm">Research Handoff Report</CardTitle>
        <CardDescription>
          Отчёт для передачи другому ассистенту или разработчику: цель, документ и версия, изменения, анализы, запуски,
          находки, основания, спорные выводы, гипотезы, ошибки, ограничения, заглушки, следующие шаги.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-[11px] uppercase tracking-wide text-muted-foreground">Части отчёта</legend>
          <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {HANDOFF_PARTS.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-muted/50" title={p.hint}>
                <Checkbox
                  checked={parts.has(p.id)}
                  onCheckedChange={() => toggle(p.id)}
                  className="mt-0.5"
                  aria-label={`Часть отчёта: ${p.label}`}
                />
                <span className="min-w-0">
                  <span className="block text-xs">{p.label}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">{p.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-1">
          <Checkbox checked={includeFullSkillText} onCheckedChange={(checked) => setIncludeFullSkillText(checked === true)} className="mt-0.5" />
          <span>
            <span className="block text-xs">Включать полный текст инструкции в записи запусков</span>
            <span className="block text-[10px] text-muted-foreground">По умолчанию точный сохранённый текст дополнительной инструкции очищается только в этой экспортной копии; обязательный материал, запросы и ответы сохраняются полностью. Старые записи с неизвестным составом сообщений не восстанавливаются.</span>
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <div>
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Формат</Label>
            <ToggleGroup
              type="single"
              value={format}
              onValueChange={(v) => v && setFormat(v as 'md' | 'json')}
              variant="outline"
              size="sm"
              className="mt-1"
            >
              <ToggleGroupItem value="md" aria-label="Markdown">md</ToggleGroupItem>
              <ToggleGroupItem value="json" aria-label="JSON">json</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-4">
            {downloadBusy ? (
              <InlineSpinner label="Формирую отчёт…" />
            ) : (
              <Button size="sm" className="gap-1.5" disabled={!projectId || empty} onClick={() => void onDownload()}>
                <Download className="size-4" aria-hidden />
                Скачать
              </Button>
            )}
            <CopyButton
              text={async () => {
                if (!projectId || empty) return 'Нечего копировать: выберите части отчёта.'
                try {
                  return await fetchAsText(url)
                } catch (e) {
                  return `Не удалось получить отчёт: ${e instanceof Error ? e.message : 'ошибка'}`
                }
              }}
              label="Копировать"
              disabled={!projectId || empty}
            />
            <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
              <ClipboardCopy className="size-3" aria-hidden />
              {empty ? 'части не выбраны' : `parts=${partsParam}`}
            </span>
          </div>
        </div>

        <div className="flex items-start gap-2.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
          <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
            Подключения и секреты в экспорт не включаются. Если в заметках есть чувствительные данные — они попадут в
            экспорт: проверьте перед передачей.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
