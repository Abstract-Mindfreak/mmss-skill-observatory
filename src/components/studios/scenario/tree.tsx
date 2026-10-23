// Дерево сценариев: вложенный список с направляющими линиями,
// шевронами, статусными иконками и бейджами. Filtering happens in
// the studio; the tree only renders given forests.
'use client'

import * as React from 'react'
import {
  BadgeCheck,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  MessageSquareWarning,
  OctagonPause,
  Pin,
  Sparkles,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { RunStatusBadge, OriginBadge } from '@/components/shared/status-badges'
import type { ScenarioDTO, ScenarioStatus } from '@/lib/types'
import { SCENARIO_STATUS_TITLES } from '@/lib/types'
import { cn } from '@/lib/utils'
import { originShort, RUN_STATUS_LABELS } from './export'

// ---------- forest building ----------

export interface ScenarioNode {
  scenario: ScenarioDTO
  children: ScenarioNode[]
}

export function buildForest(scenarios: ScenarioDTO[]): ScenarioNode[] {
  const byId = new Map<string, ScenarioNode>()
  for (const s of scenarios) byId.set(s.id, { scenario: s, children: [] })
  const roots: ScenarioNode[] = []
  for (const node of byId.values()) {
    const parent = node.scenario.parentId ? byId.get(node.scenario.parentId) : undefined
    if (parent && parent !== node) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sortNodes = (nodes: ScenarioNode[]) => {
    nodes.sort(
      (a, b) => a.scenario.order - b.scenario.order || a.scenario.createdAt.localeCompare(b.scenario.createdAt)
    )
    for (const n of nodes) sortNodes(n.children)
  }
  sortNodes(roots)
  return roots
}

export function collectIds(forest: ScenarioNode[]): string[] {
  const ids: string[] = []
  const walk = (nodes: ScenarioNode[]) => {
    for (const n of nodes) {
      ids.push(n.scenario.id)
      walk(n.children)
    }
  }
  walk(forest)
  return ids
}

// ---------- status icon ----------

const STATUS_ICON: Record<
  ScenarioStatus,
  { icon: React.ComponentType<{ className?: string }>; className: string; note: string }
> = {
  unexplored: { icon: CircleDashed, className: 'text-zinc-400', note: 'Не исследована — запусков ещё не было' },
  explored: {
    icon: CircleCheck,
    className: 'text-emerald-600 dark:text-teal-300',
    note: 'Исследована (тема описана или был завершённый запуск)',
  },
  synthetic: {
    icon: Sparkles,
    className: 'text-amber-500',
    note: 'Синтетическая ветвь — заполнена без проверки, не является результатом',
  },
  'run-verified': {
    icon: BadgeCheck,
    className: 'text-emerald-600 dark:text-emerald-400',
    note: 'Проверена запуском — статус выставлен вручную после оценки',
  },
  disputed: {
    icon: MessageSquareWarning,
    className: 'text-amber-500',
    note: 'Оспорена — есть возражение (Challenger) или разногласие оценщиков',
  },
  stopped: { icon: OctagonPause, className: 'text-zinc-400', note: 'Исследование ветви остановлено' },
}

function StatusIcon({ scenario }: { scenario: ScenarioDTO }) {
  const meta = STATUS_ICON[scenario.status]
  const title =
    SCENARIO_STATUS_TITLES[scenario.status] +
    (scenario.status === 'stopped' && scenario.stopReason ? ` — причина: ${scenario.stopReason}` : '') +
    (scenario.status === 'synthetic' ? ' — synthetic (без проверки)' : '')
  return (
    <span className="flex size-5 shrink-0 items-center justify-center" title={title}>
      <meta.icon className={cn('size-4', meta.className)} aria-hidden />
    </span>
  )
}

// ---------- node rendering (recursive) ----------

function NodeTree({
  node,
  expandedSet,
  onToggle,
  selectedId,
  onSelect,
}: {
  node: ScenarioNode
  expandedSet: Set<string>
  onToggle: (id: string) => void
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const expanded = expandedSet.has(node.scenario.id)
  const hasChildren = node.children.length > 0
  const s = node.scenario
  const selected = selectedId === s.id
  const lastRun = s.lastRunStatus

  return (
    <li role="treeitem" aria-selected={selected} aria-expanded={hasChildren ? expanded : undefined} className="py-0.5">
      <div className="flex items-start gap-1">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(s.id)}
            aria-label={expanded ? `Свернуть «${s.title}»` : `Развернуть «${s.title}»`}
            className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className={cn('size-4 transition-transform', expanded && 'rotate-90')} aria-hidden />
          </button>
        ) : (
          <span className="mt-0.5 w-6 shrink-0" aria-hidden />
        )}
        <div
          role="button"
          tabIndex={0}
          onClick={() => onSelect(s.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSelect(s.id)
            }
          }}
          className={cn(
            'flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors',
            'hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            selected ? 'border-primary/50 bg-primary/10' : 'border-transparent',
            s.origin === 'demo' && !selected && 'border-amber-500/30 bg-amber-500/5'
          )}
        >
          <StatusIcon scenario={s} />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{s.title}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            {s.pinned && <Pin className="size-3 text-amber-500/90" aria-hidden />}
            {s.origin === 'demo' ? (
              <OriginBadge origin="demo" />
            ) : (
              <Badge variant="outline" className="hidden font-mono text-[9px] text-muted-foreground sm:inline-flex">
                {originShort(s.origin)}
              </Badge>
            )}
            {s.runCount > 0 && (
              <span
                className="font-mono text-[10px] tabular-nums text-muted-foreground"
                title={`Запусков по сценарию: ${s.runCount}`}
              >
                {s.runCount} зап.
              </span>
            )}
            {lastRun && (
              <span title={`Последний запуск: ${RUN_STATUS_LABELS[lastRun]}`}>
                <RunStatusBadge status={lastRun} compact />
              </span>
            )}
          </span>
        </div>
      </div>

      {hasChildren && expanded && (
        <ul role="group" className="ml-3 space-y-0.5 border-l border-border/70 pl-2">
          {node.children.map((c) => (
            <NodeTree
              key={c.scenario.id}
              node={c}
              expandedSet={expandedSet}
              onToggle={onToggle}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function ScenarioTree({
  groups,
  expandedSet,
  onToggle,
  selectedId,
  onSelect,
}: {
  groups: { label: string; forest: ScenarioNode[]; note?: string }[]
  expandedSet: Set<string>
  onToggle: (id: string) => void
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label}>
          <div className="mb-1 flex items-center gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</h3>
            <span className="font-mono text-[10px] text-muted-foreground/70">
              {g.forest.reduce((acc, n) => acc + countNodes(n), 0)}
            </span>
          </div>
          {g.note && <p className="mb-1 text-[10px] text-muted-foreground">{g.note}</p>}
          {g.forest.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
              Пусто
            </p>
          ) : (
            <ul role="tree" className="space-y-0.5">
              {g.forest.map((n) => (
                <NodeTree
                  key={n.scenario.id}
                  node={n}
                  expandedSet={expandedSet}
                  onToggle={onToggle}
                  selectedId={selectedId}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}

function countNodes(n: ScenarioNode): number {
  return 1 + n.children.reduce((acc, c) => acc + countNodes(c), 0)
}
