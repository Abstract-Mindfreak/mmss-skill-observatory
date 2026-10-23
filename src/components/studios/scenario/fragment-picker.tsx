// Диалог выбора фрагмента для привязки сценария: список разделов
// активной версии + ручной ввод точного пути. Owned by agent 3-c.
'use client'

import * as React from 'react'
import { FileText, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ErrorState, InlineSpinner } from '@/components/shared/states'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api-client'
import { useStore } from '@/lib/store'
import type { FragmentDTO, ScenarioDTO } from '@/lib/types'
import { cn } from '@/lib/utils'

export function FragmentPickerDialog({
  open,
  onOpenChange,
  scenario,
  fragments,
  onPatched,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scenario: ScenarioDTO
  fragments: FragmentDTO[]
  onPatched: () => Promise<void> | void
}) {
  const { toast } = useToast()
  const refresh = useStore((s) => s.refresh)
  const [query, setQuery] = React.useState('')
  const [manualPath, setManualPath] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setQuery('')
      setManualPath('')
      setError(null)
      setBusyId(null)
    }
  }, [open])

  const sections = React.useMemo(() => {
    const list = fragments.filter((f) => f.kind === 'section')
    const q = query.trim().toLowerCase()
    const filtered = q
      ? list.filter(
          (f) => f.path.toLowerCase().includes(q) || (f.title ?? '').toLowerCase().includes(q)
        )
      : list
    return filtered.slice(0, 80)
  }, [fragments, query])

  const patch = async (fragmentId: string, label: string) => {
    setBusyId(fragmentId)
    setError(null)
    try {
      await api.updateScenario(scenario.id, { fragmentId })
      await refresh()
      await onPatched()
      toast({ title: 'Фрагмент привязан', description: label })
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось привязать фрагмент')
    } finally {
      setBusyId(null)
    }
  }

  const onManualSubmit = () => {
    const path = manualPath.trim()
    if (!path) {
      setError('Введите путь фрагмента, например 6.2.1.3')
      return
    }
    const found = fragments.find((f) => f.path === path)
    if (!found) {
      setError(`Фрагмент с путём «${path}» не найден в активной версии. Путь указывается как в атласе (например 6.2.1.3).`)
      return
    }
    void patch(found.id, `${found.path}${found.title ? ` «${found.title}»` : ''}`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto scroll-observatory sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Привязка к фрагменту инструкции</DialogTitle>
          <DialogDescription>
            Выберите раздел активной версии или укажите точный путь любого фрагмента (абзац, пункт, предложение).
            Существующая привязка будет заменена.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по разделам (путь или заголовок)…"
              className="h-8 pl-8 text-xs"
              aria-label="Поиск по разделам"
            />
          </div>

          <div className="max-h-72 space-y-1 overflow-y-auto scroll-observatory rounded-md border p-1">
            {sections.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                Подходящих разделов нет. Используйте ручной ввод пути ниже.
              </p>
            ) : (
              sections.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void patch(f.id, `${f.path}${f.title ? ` «${f.title}»` : ''}`)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted disabled:opacity-50'
                  )}
                >
                  <FileText className="mt-0.5 size-3.5 shrink-0 text-primary/70" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-[11px] text-muted-foreground">{f.path}</span>{' '}
                    <span className="text-foreground">{f.title ?? '(без заголовка)'}</span>
                  </span>
                  {busyId === f.id ? <InlineSpinner label="" /> : null}
                </button>
              ))
            )}
          </div>

          <div className="space-y-1 rounded-md border bg-muted/30 p-2">
            <Label htmlFor="fp-manual" className="text-xs">
              Точный путь фрагмента (любой вид: раздел, абзац, пункт, предложение)
            </Label>
            <div className="flex gap-2">
              <Input
                id="fp-manual"
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onManualSubmit()
                  }
                }}
                placeholder="например 6.2.1.3"
                className="h-8 w-40 font-mono text-xs"
              />
              <Button size="sm" variant="outline" onClick={onManualSubmit} disabled={busyId !== null}>
                Привязать по пути
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Путь берётся из атласа активной версии. Фрагменты другой версии недоступны для привязки.
            </p>
          </div>

          {error && <ErrorState error={error} title="Не удалось привязать" />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
