// Панель управления деревом: поиск, фильтры по статусу (чипы) и
// происхождению, развернуть/свернуть всё, новая корневая ветвь.
'use client'

import * as React from 'react'
import { ChevronsDownUp, ChevronsUpDown, ListPlus, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Card, CardContent } from '@/components/ui/card'
import { SCENARIO_STATUS_TITLES } from '@/lib/types'
import type { ScenarioStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

const STATUS_ORDER: ScenarioStatus[] = [
  'unexplored',
  'explored',
  'run-verified',
  'synthetic',
  'disputed',
  'stopped',
]

const STATUS_CHIP: Record<ScenarioStatus, string> = {
  unexplored: 'Неисследованные',
  explored: 'Исследованные',
  'run-verified': 'Проверенные',
  synthetic: 'Синтетические',
  disputed: 'Оспоренные',
  stopped: 'Остановленные',
}

export type OriginFilter = 'all' | 'real' | 'demo'

export function TreeControls({
  search,
  onSearch,
  statusFilter,
  onToggleStatus,
  statusCounts,
  originFilter,
  onOriginFilter,
  onExpandAll,
  onCollapseAll,
  onNewRoot,
  shownCount,
  totalCount,
}: {
  search: string
  onSearch: (v: string) => void
  statusFilter: Set<ScenarioStatus>
  onToggleStatus: (s: ScenarioStatus) => void
  statusCounts: Record<ScenarioStatus, number>
  originFilter: OriginFilter
  onOriginFilter: (v: OriginFilter) => void
  onExpandAll: () => void
  onCollapseAll: () => void
  onNewRoot: () => void
  shownCount: number
  totalCount: number
}) {
  const noneSelected = statusFilter.size === 0
  return (
    <Card className="border-border/70">
      <CardContent className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-40 flex-1">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Поиск по названию ветви…"
              className="h-8 pl-8 pr-8 text-xs"
              aria-label="Поиск по названию ветви"
            />
            {search && (
              <button
                type="button"
                onClick={() => onSearch('')}
                aria-label="Очистить поиск"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={onExpandAll}>
              <ChevronsUpDown className="size-3.5" aria-hidden />
              Развернуть все
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={onCollapseAll}>
              <ChevronsDownUp className="size-3.5" aria-hidden />
              Свернуть все
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={onNewRoot}>
              <ListPlus className="size-3.5" aria-hidden />
              Корневая ветвь
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground">Статус:</span>
          {STATUS_ORDER.map((st) => {
            const active = statusFilter.has(st)
            return (
              <button
                key={st}
                type="button"
                onClick={() => onToggleStatus(st)}
                aria-pressed={active}
                title={SCENARIO_STATUS_TITLES[st]}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                  active
                    ? 'border-primary/50 bg-primary/15 text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted/60'
                )}
              >
                {STATUS_CHIP[st]}
                <span className="ml-1 font-mono text-[10px] tabular-nums opacity-80">{statusCounts[st]}</span>
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Происхождение:</span>
            <ToggleGroup
              type="single"
              value={originFilter}
              onValueChange={(v) => v && onOriginFilter(v as OriginFilter)}
              className="gap-1"
            >
              <ToggleGroupItem value="all" className="h-7 px-2 text-[11px]">
                Все
              </ToggleGroupItem>
              <ToggleGroupItem value="real" className="h-7 px-2 text-[11px]">
                Реальные
              </ToggleGroupItem>
              <ToggleGroupItem value="demo" className="h-7 px-2 text-[11px] text-amber-600 dark:text-amber-300">
                DEMO
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <span className="text-[10px] text-muted-foreground" role="status">
            {noneSelected
              ? 'все статусы выключены — включите хотя бы один'
              : `показано ${shownCount} из ${totalCount} ветвей`}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
