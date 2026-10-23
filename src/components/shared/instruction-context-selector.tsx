'use client'

import * as React from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api-client'
import type { DocumentVersionDTO, FragmentDTO } from '@/lib/types'
import type { InstructionContextSelection } from '@/lib/instruction-context'

export interface ContextVersionOption {
  version: DocumentVersionDTO
  documentTitle: string
}

export function InstructionContextSelector({
  value,
  onChange,
  versions,
  initialVersionId,
  disabled = false,
}: {
  value: InstructionContextSelection
  onChange: (value: InstructionContextSelection) => void
  versions: ContextVersionOption[]
  initialVersionId?: string | null
  disabled?: boolean
}) {
  const [fragments, setFragments] = React.useState<FragmentDTO[]>([])
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const version = versions.find((item) => item.version.id === value.versionId)?.version ?? null

  React.useEffect(() => {
    if (value.mode !== 'selected' || !value.versionId) return
    let active = true
    setLoading(true)
    setLoadError(null)
    api.versionFragments(value.versionId).then((rows) => { if (active) setFragments(rows) })
      .catch((err) => { if (active) setLoadError(err instanceof Error ? err.message : 'Не удалось загрузить фрагменты') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [value.mode, value.versionId])

  const update = (patch: Partial<InstructionContextSelection>) => onChange({ ...value, ...patch })
  const selected = new Set(value.fragmentIds)

  return (
    <section className="space-y-2 rounded-md border p-3" aria-label="Дополнительный контекст инструкции">
      <div className="space-y-1">
        <Label className="text-xs">Дополнительный контекст инструкции</Label>
        <Select value={value.mode} onValueChange={(mode) => update({ mode: mode as InstructionContextSelection['mode'] })} disabled={disabled}>
          <SelectTrigger size="sm" aria-label="Режим контекста инструкции"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Без текста инструкции</SelectItem>
            <SelectItem value="selected">Выбранные фрагменты инструкции</SelectItem>
            <SelectItem value="full">Полная версия инструкции</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-[11px]">Версия</Label>
        <Select value={value.versionId ?? ''} onValueChange={(versionId) => update({ versionId, fragmentIds: [] })} disabled={disabled || versions.length === 0}>
          <SelectTrigger size="sm" aria-label="Версия инструкции"><SelectValue placeholder="Выберите версию" /></SelectTrigger>
          <SelectContent>
            {versions.map(({ version: item, documentTitle }) => (
              <SelectItem key={item.id} value={item.id}>{documentTitle} · {item.label}{item.isActive ? ' · активная' : ''}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {versions.length === 0 && <p className="text-[10px] text-muted-foreground">В проекте нет версий инструкции.</p>}
        {value.versionId && !version && <p role="alert" className="text-[10px] text-rose-600">Выбранная версия недоступна. Выберите другую; автоматической подмены нет.</p>}
      </div>

      {value.mode === 'none' && <p className="text-[10px] text-muted-foreground">Дополнительный текст инструкции не отправляется. Обязательный материал задачи и история диалога сохраняются.</p>}
      {value.mode === 'full' && version && <p className="text-[10px] text-muted-foreground">Будет отправлен полный текст: {version.contentLength.toLocaleString('ru-RU')} символов · SHA-256 версии {version.contentHash}.</p>}
      {value.mode === 'selected' && (
        <div className="space-y-2">
          {loading && <p className="text-[10px] text-muted-foreground">Загружаю список фрагментов…</p>}
          {loadError && <p role="alert" className="text-[10px] text-rose-600">{loadError}</p>}
          {!loading && !loadError && (
            <div className="max-h-72 space-y-1 overflow-y-auto rounded border p-2">
              {fragments.map((fragment) => (
                <label key={fragment.id} className="flex cursor-pointer gap-2 rounded p-1.5 hover:bg-muted/40">
                  <Checkbox checked={selected.has(fragment.id)} disabled={disabled} onCheckedChange={(checked) => {
                    const next = new Set(selected)
                    if (checked === true) next.add(fragment.id); else next.delete(fragment.id)
                    update({ fragmentIds: [...next] })
                  }} />
                  <span className="min-w-0 text-[10px]">
                    <span className="block font-mono">{fragment.id} · {fragment.path} · {value.versionId}</span>
                    <span className="block font-medium">{fragment.title ?? fragment.kind}</span>
                    <span className="block whitespace-pre-wrap text-muted-foreground">{fragment.text}</span>
                  </span>
                </label>
              ))}
              {fragments.length === 0 && <p className="text-[10px] text-muted-foreground">У версии нет структурных фрагментов.</p>}
            </div>
          )}
          <label className="flex items-start gap-2 text-[10px]">
            <Checkbox checked={value.includeParentSections} disabled={disabled} onCheckedChange={(checked) => update({ includeParentSections: checked === true })} />
            <span>Дополнительно включать родительские разделы выбранных фрагментов (будут явно перечислены в предпросмотре).</span>
          </label>
          <label className="flex items-start gap-2 text-[10px]">
            <Checkbox checked={value.includeTableOfContents === true} disabled={disabled} onCheckedChange={(checked) => update({ includeTableOfContents: checked === true })} />
            <span>Дополнительно включать оглавление версии (если оно ранее входило в контекст действия).</span>
          </label>
          <p className="text-[10px] text-muted-foreground">Скрытое добавление соседних фрагментов отключено.</p>
        </div>
      )}
    </section>
  )
}
