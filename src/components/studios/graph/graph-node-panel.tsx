// Right-hand info panel of the rule map: selected node (with its edges) or
// selected edge (with its honest basis). Conflicts get the full
// clash/acquittal treatment from the conflict-candidate heuristic.

'use client'

import * as React from 'react'
import { ArrowRight, ExternalLink, MousePointerClick } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FragmentRef, KV } from '@/components/shared/misc'
import { CopyButton } from '@/components/shared/copy'
import { LayerLegend } from '@/components/shared/layers'
import type { FragmentDTO, GraphEdge, GraphNode, LayerId } from '@/lib/types'
import {
  GRAPH_EDGE_KIND_TITLES,
  GRAPH_NODE_KIND_TITLES,
  LAYER_TITLES,
} from '@/lib/types'
import { EDGE_KIND_COLORS, EDGE_KIND_VISUALS, NODE_KIND_COLORS } from './graph-theme'
import { cn } from '@/lib/utils'

export type PanelSelection =
  | {
      type: 'node'
      node: GraphNode
      edges: GraphEdge[]
    }
  | {
      type: 'edge'
      edge: GraphEdge
      sourceNode: GraphNode
      targetNode: GraphNode
    }

/** The generator of conflict candidates uses one standard acquittal text (analysis.ts);
 *  we repeat it verbatim and say where it comes from — no invented per-edge data. */
const CONFLICT_ACQUITTAL =
  'Если области действия различны (разные контракты, этапы или типы артефактов), требования совместимы.'

export function GraphNodePanel({
  selection,
  nodes,
  edges,
  fragments,
  onSelectNode,
  onSelectEdge,
  onOpenInAtlas,
  className,
}: {
  selection: PanelSelection | null
  nodes: Map<string, GraphNode>
  edges: Map<string, GraphEdge>
  fragments: Map<string, FragmentDTO>
  onSelectNode: (id: string) => void
  onSelectEdge: (id: string) => void
  onOpenInAtlas: (fragmentId: string) => void
  className?: string
}) {
  if (!selection) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center', className)}>
        <MousePointerClick className="size-6 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">Ничего не выбрано</p>
        <p className="max-w-56 text-xs leading-relaxed text-muted-foreground">
          Кликните узел или связь на карте. Наведите курсор — увидите основание связи.
        </p>
      </div>
    )
  }

  if (selection.type === 'node') {
    return (
      <NodePanelBody
        node={selection.node}
        ownEdges={selection.edges}
        nodes={nodes}
        fragments={fragments}
        onSelectNode={onSelectNode}
        onSelectEdge={onSelectEdge}
        onOpenInAtlas={onOpenInAtlas}
        className={className}
      />
    )
  }
  return (
    <EdgePanelBody
      edge={selection.edge}
      sourceNode={selection.sourceNode}
      targetNode={selection.targetNode}
      fragments={fragments}
      onSelectNode={onSelectNode}
      onOpenInAtlas={onOpenInAtlas}
      className={className}
    />
  )
}

function NodePanelBody({
  node,
  ownEdges,
  nodes,
  fragments,
  onSelectNode,
  onSelectEdge,
  onOpenInAtlas,
  className,
}: {
  node: GraphNode
  ownEdges: GraphEdge[]
  nodes: Map<string, GraphNode>
  fragments: Map<string, FragmentDTO>
  onSelectNode: (id: string) => void
  onSelectEdge: (id: string) => void
  onOpenInAtlas: (fragmentId: string) => void
  className?: string
}) {
  const frag = fragments.get(node.fragmentId)
  const layers = node.layers as LayerId[]
  const byKind = new Map<string, GraphEdge[]>()
  for (const e of ownEdges) {
    const list = byKind.get(e.kind)
    if (list) list.push(e)
    else byKind.set(e.kind, [e])
  }
  const copyText = [
    `### Узел ${node.path} (${GRAPH_NODE_KIND_TITLES[node.kind]})`,
    '',
    frag ? frag.text : node.label,
    '',
    `- Раздел: ${node.sectionPath}${node.sectionTitle ? ` — ${node.sectionTitle}` : ''}`,
    `- Связей: ${node.degree}`,
    `- Слои: ${layers.map((l) => LAYER_TITLES[l]).join(', ') || '—'}`,
    '',
    '#### Связи:',
    ...ownEdges.map((e) => {
      const other = e.source === node.id ? nodes.get(e.target) : nodes.get(e.source)
      return `- ${GRAPH_EDGE_KIND_TITLES[e.kind]} → ${other ? `${other.path} ${other.label.slice(0, 60)}` : '?'} (${e.basis.type}: ${e.basis.detail})`
    }),
  ].join('\n')

  return (
    <div className={cn('flex h-full flex-col gap-3 overflow-y-auto scroll-observatory p-3', className)}>
      <div className="flex items-start gap-2">
        <span className="mt-1 size-3 shrink-0 rounded-full" style={{ background: NODE_KIND_COLORS[node.kind] }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">{GRAPH_NODE_KIND_TITLES[node.kind]}</p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {node.path} · раздел {node.sectionPath}
            {node.sectionTitle ? ` — ${node.sectionTitle.replace(/^\s*[\d.]+\s*/, '')}` : ''}
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
          связей: {node.degree}
        </Badge>
      </div>

      <blockquote className="rounded-md border-l-2 border-primary/40 bg-muted/40 p-2 text-xs leading-relaxed text-foreground/90">
        {frag ? frag.text : node.label}
      </blockquote>

      {layers.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Слои фрагмента</p>
          <LayerLegend layers={layers} />
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onOpenInAtlas(node.fragmentId)}>
          <ExternalLink className="size-3.5" aria-hidden />
          Открыть в атласе
        </Button>
        <CopyButton text={copyText} label="Карточка узла" size="sm" />
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Связи этого узла ({ownEdges.length})
        </p>
        {ownEdges.length === 0 && (
          <p className="text-xs text-muted-foreground">Изолированное правило — связей в этом графе нет.</p>
        )}
        <div className="scroll-observatory max-h-80 space-y-0.5 overflow-y-auto pr-1">
          {[...byKind.entries()].map(([kind, list]) => (
            <React.Fragment key={kind}>
              {list.map((e) => {
                const other = e.source === node.id ? nodes.get(e.target) : nodes.get(e.source)
                if (!other) return null
                const outgoing = e.source === node.id
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onSelectEdge(e.id)}
                    className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-primary/10"
                  >
                    <span className="font-mono text-[10px] text-muted-foreground">{other.path}</span>
                    {outgoing ? (
                      <ArrowRight className="size-3 shrink-0" style={{ color: EDGE_KIND_COLORS[e.kind] }} aria-hidden />
                    ) : (
                      <ArrowRight className="size-3 shrink-0 rotate-180" style={{ color: EDGE_KIND_COLORS[e.kind] }} aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 truncate text-foreground/85">{fragments.get(other.fragmentId)?.text ?? other.label}</span>
                    <span className="shrink-0 text-[10px]" style={{ color: EDGE_KIND_COLORS[e.kind] }}>
                      {GRAPH_EDGE_KIND_TITLES[e.kind]}
                    </span>
                  </button>
                )
              })}
            </React.Fragment>
          ))}
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Клик по связи — её основание; клик по пути узла — переход. Все связи здесь — терминологические/структурные, не логические зависимости.
        </p>
      </div>
    </div>
  )
}

function EdgePanelBody({
  edge,
  sourceNode,
  targetNode,
  fragments,
  onSelectNode,
  onOpenInAtlas,
  className,
}: {
  edge: GraphEdge
  sourceNode: GraphNode
  targetNode: GraphNode
  fragments: Map<string, FragmentDTO>
  onSelectNode: (id: string) => void
  onOpenInAtlas: (fragmentId: string) => void
  className?: string
}) {
  const v = EDGE_KIND_VISUALS[edge.kind]
  const isConflict = edge.kind === 'conflicts'
  const copyText = [
    `### Связь: ${GRAPH_EDGE_KIND_TITLES[edge.kind]}`,
    `Основание: ${edge.basis.type}${edge.basis.similarity !== undefined ? ` (сходство ${edge.basis.similarity.toFixed(2)})` : ''}`,
    edge.basis.detail,
    '',
    `Источник: ${sourceNode.path} ${fragments.get(sourceNode.fragmentId)?.text ?? sourceNode.label}`,
    `Цель: ${targetNode.path} ${fragments.get(targetNode.fragmentId)?.text ?? targetNode.label}`,
    isConflict ? `\nУсловие оправдания: ${CONFLICT_ACQUITTAL}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <div className={cn('flex h-full flex-col gap-3 overflow-y-auto scroll-observatory p-3', className)}>
      <div className="flex items-center gap-2">
        <span className="size-3 rounded-full" style={{ background: v.color }} aria-hidden />
        <p className="text-xs font-semibold">связь: {GRAPH_EDGE_KIND_TITLES[edge.kind]}</p>
        <Badge variant="outline" className="ml-auto font-mono text-[10px]">
          {edge.basis.type}
        </Badge>
      </div>

      <p className="text-xs leading-relaxed text-foreground/90">{edge.basis.detail}</p>

      {edge.basis.similarity !== undefined && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
          <KV
            k="Сходство"
            v={<span className="font-mono">{edge.basis.similarity.toFixed(2)}</span>}
          />
          <p className="mt-1 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300/90">
            Сходство вычислено в одном представлении (лексика). Это не доказательство эквивалентности формулировок и не логическая зависимость.
          </p>
        </div>
      )}

      {isConflict && (
        <div className="space-y-2 rounded-md border border-rose-500/30 bg-rose-500/5 p-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">
            Кандидат на конфликт — не подтверждённый дефект
          </p>
          <p className="text-xs leading-relaxed">{edge.basis.detail}</p>
          <div className="border-t border-rose-500/20 pt-2">
            <p className="text-[11px] font-medium text-muted-foreground">Условие снятия подозрения</p>
            <p className="mt-0.5 text-xs leading-relaxed">{CONFLICT_ACQUITTAL}</p>
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Кандидаты порождаются эвристикой «противоположная модальность + общий значимый термин»; условие оправдания выше —
            стандартный текст этой эвристики, общий для всех кандидатов. Подтверждение или опровержение — сценарий в Scenario Tree
            и Challenger в Behavior Lab.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Концы связи</p>
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[10px] text-muted-foreground">из</span>
          <FragmentRef
            fragment={fragments.get(sourceNode.fragmentId) ?? { id: sourceNode.fragmentId, path: sourceNode.path, text: sourceNode.label, title: null }}
            className="min-w-0"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[10px] text-muted-foreground">в</span>
          <FragmentRef
            fragment={fragments.get(targetNode.fragmentId) ?? { id: targetNode.fragmentId, path: targetNode.path, text: targetNode.label, title: null }}
            className="min-w-0"
          />
        </div>
      </div>

      <div className="mt-auto flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onOpenInAtlas(sourceNode.fragmentId)}>
          <ExternalLink className="size-3.5" aria-hidden />
          Источник в атласе
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onSelectNode(targetNode.id)}>
          К узлу-цели
        </Button>
        <CopyButton text={copyText} label="Связь" size="sm" variant="ghost" />
      </div>
    </div>
  )
}
