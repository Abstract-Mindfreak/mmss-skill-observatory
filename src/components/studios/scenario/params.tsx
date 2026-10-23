// «Параметры исследования» — локальная панель (ТЗ: область, глубина,
// число новых ветвей, бюджет запусков, условие остановки). Значения
// живут в состоянии студии и сохраняются в localStorage.
'use client'

import * as React from 'react'
import { Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { clampInt, type ResearchParams } from './export'

export function ResearchParamsPanel({
  params,
  onChange,
}: {
  params: ResearchParams
  onChange: (next: ResearchParams) => void
}) {
  const [open, setOpen] = React.useState(false)
  const set = (patch: Partial<ResearchParams>) => onChange({ ...params, ...patch })

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center justify-between gap-2 rounded-lg border bg-card/60 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 items-center gap-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          aria-expanded={open}
        >
          <Settings2 className="size-4 shrink-0 text-primary/70" aria-hidden />
          Параметры исследования
          <span className="truncate text-[10px] text-muted-foreground/70">
            глубина {params.depth} · ветвей ≤ {params.maxNewBranches} · бюджет{' '}
            {params.runBudget > 0 ? params.runBudget : '∞'}
          </span>
        </button>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px] text-muted-foreground"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Свернуть' : 'Открыть'}
          </Button>
        </div>
      </div>
      <CollapsibleContent>
        <div className="mt-2 grid gap-3 rounded-lg border bg-card/40 p-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="rp-scope" className="text-xs">
              Область исследования
            </Label>
            <Input
              id="rp-scope"
              value={params.scope}
              onChange={(e) => set({ scope: e.target.value })}
              placeholder="например: разделы 15–16, поведение при unknown"
              className="h-8 text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Подсказка для себя и Explorer: какие части инструкции в фокусе. Не отправляется модели автоматически.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="rp-depth" className="text-xs">
              Целевая глубина дерева
            </Label>
            <Input
              id="rp-depth"
              type="number"
              min={1}
              max={10}
              value={params.depth}
              onChange={(e) => set({ depth: clampInt(Number(e.target.value), 1, 10, 2) })}
              className="h-8 w-24 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rp-branches" className="text-xs">
              Максимум новых ветвей за шаг (1..5)
            </Label>
            <Input
              id="rp-branches"
              type="number"
              min={1}
              max={5}
              value={params.maxNewBranches}
              onChange={(e) => set({ maxNewBranches: clampInt(Number(e.target.value), 1, 5, 3) })}
              className="h-8 w-24 text-xs"
            />
            <p className="text-[10px] text-muted-foreground">Значение по умолчанию в диалоге Explorer.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="rp-budget" className="text-xs">
              Бюджет запусков
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="rp-budget"
                type="number"
                min={0}
                value={params.runBudget}
                onChange={(e) => set({ runBudget: clampInt(Number(e.target.value), 0, 100000, 20) })}
                className="h-8 w-24 text-xs"
              />
              <Label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Switch checked={params.runBudget > 0} onCheckedChange={(v) => set({ runBudget: v ? 20 : 0 })} />
                {params.runBudget > 0 ? 'ограничен' : 'без ограничения'}
              </Label>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Мягкое предупреждение при исчерпании — информационное, не блокирует работу.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="rp-stop" className="text-xs">
              Условие остановки исследования
            </Label>
            <Input
              id="rp-stop"
              value={params.stopCondition}
              onChange={(e) => set({ stopCondition: e.target.value })}
              placeholder="например: 3 подряд неоднозначных вердикта"
              className="h-8 text-xs"
            />
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground sm:col-span-2">
            Параметры сохраняются локально в браузере и попадают в экспорт ветви (markdown). Дерево не перебирает
            все ситуации само — параметры помогают держать исследование в разумных рамках.
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
