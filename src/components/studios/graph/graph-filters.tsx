// Left toolbar of the rule map: search, node kind chips, edge kind chips,
// section multiselect. Every control changes the rendered graph (ТЗ п.5).

'use client'

import * as React from 'react'
import { RotateCcw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { FragmentRef } from '@/components/shared/misc'
import type { FragmentDTO, GraphEdgeKind, GraphNode, GraphNodeKind } from '@/lib/types'
import { GRAPH_NODE_KIND_TITLES, GRAPH_EDGE_KIND_TITLES } from '@/lib/types'
import { EDGE_KIND_ORDER, EDGE_KIND_COLORS, NODE_KIND_ORDER, NODE_KIND_COLORS } from './graph-theme'
import { cn } from '@/lib/utils'

export interface GraphFilterState {
  nodeKinds: Set<GraphNodeKind>
  edgeKinds: Set<GraphEdgeKind>
  sections: Set<string>
  query: string
}

export interface FilterCounts {
  nodeKind: Record<string, number>
  edgeKind: Record<string, number>
  sections: { path: string; title: string | null; count: number }[]
}

export function GraphFilters({
  counts,
  state,
  onReset,
  onToggleNodeKind,
  onToggleEdgeKind,
  onToggleSection,
  onSetAllSections,
  onQuery,
  matches,
  fragments,
  onMatchClick,
  visibleNodeCount,
  visibleEdgeCount,
  className,
}: {
  counts: FilterCounts
  state: GraphFilterState
  onReset: () => void
  onToggleNodeKind: (k: GraphNodeKind) => void
  onToggleEdgeKind: (k: GraphEdgeKind) => void
  onToggleSection: (s: string) => void
  onSetAllSections: (all: boolean) => void
  onQuery: (q: string) => void
  matches: GraphNode[]
  fragments: Map<string, FragmentDTO>
  onMatchClick: (nodeId: string) => void
  visibleNodeCount: number
  visibleEdgeCount: number
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* search */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={state.query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Поиск по тексту правила или пути…"
            className="pl-8"
            aria-label="Поиск узлов графа"
          />
        </div>
        {state.query.trim() !== '' && (
          <p className="text-xs text-muted-foreground">
            Найдено: <span className="font-mono text-foreground/80">{matches.length}</span>
            {matches.length > 0 && ' — клик по строке центрирует узел на карте'}
          </p>
        )}
        {state.query.trim() !== '' && (
          <div className="scroll-observatory max-h-64 space-y-1 overflow-y-auto rounded-md border bg-muted/30 p-1.5">
            {matches.length === 0 && (
              <p className="p-2 text-xs text-muted-foreground">Ничего не найдено — поиск идёт по тексту правила, пути и названию раздела.</p>
            )}
            {matches.slice(0, 120).map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => onMatchClick(n.id)}
                className="block w-full rounded px-1 py-1 text-left transition-colors hover:bg-primary/10"
              >
                <FragmentRef
                  fragment={fragments.get(n.fragmentId) ?? { id: n.fragmentId, path: n.path, text: n.label, title: null }}
                  showText={false}
                />
              </button>
            ))}
            {matches.length > 120 && (
              <p className="p-1 text-[10px] text-muted-foreground">показаны первые 120 из {matches.length}</p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Типы узлов</h3>
          <span className="font-mono text-[10px] text-muted-foreground">узлов: {visibleNodeCount}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {NODE_KIND_ORDER.map((k) => {
            const on = state.nodeKinds.has(k)
            const count = counts.nodeKind[k] ?? 0
            if (count === 0 && !on) return null
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => onToggleNodeKind(k)}
                title={`${GRAPH_NODE_KIND_TITLES[k]} — ${count}`}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors',
                  on
                    ? 'border-transparent text-foreground hover:opacity-90'
                    : 'border-border bg-transparent text-muted-foreground opacity-50 hover:opacity-80'
                )}
                style={on ? { backgroundColor: `${NODE_KIND_COLORS[k]}26`, borderColor: `${NODE_KIND_COLORS[k]}80` } : undefined}
              >
                <span className="size-2 rounded-full" style={{ background: NODE_KIND_COLORS[k] }} aria-hidden />
                {GRAPH_NODE_KIND_TITLES[k]}
                <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Типы связей</h3>
          <span className="font-mono text-[10px] text-muted-foreground">связей: {visibleEdgeCount}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {EDGE_KIND_ORDER.map((k) => {
            const on = state.edgeKinds.has(k)
            const count = counts.edgeKind[k] ?? 0
            if (count === 0 && !on) return null
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => onToggleEdgeKind(k)}
                title={`${GRAPH_EDGE_KIND_TITLES[k]} — ${count}`}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors',
                  on
                    ? 'border-transparent text-foreground hover:opacity-90'
                    : 'border-border bg-transparent text-muted-foreground opacity-50 hover:opacity-80'
                )}
                style={on ? { backgroundColor: `${EDGE_KIND_COLORS[k]}26`, borderColor: `${EDGE_KIND_COLORS[k]}80` } : undefined}
              >
                <span className="size-2 rounded-full" style={{ background: EDGE_KIND_COLORS[k] }} aria-hidden />
                {GRAPH_EDGE_KIND_TITLES[k]}
                <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
              </button>
            )
          })}
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          «повторяет» — лексическое сходство (Жаккард по токенам), в одном представлении; не доказательство эквивалентности формулировок.
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Разделы (полосы)</h3>
          <span className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => onSetAllSections(true)}>
              все
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => onSetAllSections(false)}>
              снять
            </Button>
          </span>
        </div>
        <div className="scroll-observatory max-h-64 space-y-0.5 overflow-y-auto rounded-md border bg-muted/30 p-1.5">
          {counts.sections.map((s) => {
            const on = state.sections.has(s.path)
            return (
              <label
                key={s.path}
                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs transition-colors hover:bg-primary/5"
              >
                <Checkbox checked={on} onCheckedChange={() => onToggleSection(s.path)} className="size-3.5" aria-hidden />
                <span className="font-mono text-[10px] text-muted-foreground">{s.path}</span>
                <span className="min-w-0 flex-1 truncate text-foreground/85">
                  {s.title ? s.title.replace(/^\s*[\d.]+\s*/, '') : '—'}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">{s.count}</span>
              </label>
            )
          })}
        </div>
      </div>

      <Button size="sm" variant="outline" className="gap-1.5" onClick={onReset}>
        <RotateCcw className="size-3.5" aria-hidden />
        Сбросить фильтры
      </Button>
    </div>
  )
}
