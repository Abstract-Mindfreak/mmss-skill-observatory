// Interactive SVG map: section lanes (subway-map style), curved edges, pan/zoom
// with pointer events (wheel + drag + pinch), hover tooltips with the honest
// basis of every node/edge. No physics, no external packages.
//
// Performance notes:
// - pan/zoom writes the <g transform> attribute directly (no React re-render);
// - the heavy SVG content is memoized and receives only data (no callbacks):
//   node/edge interaction is delegated to the container via data attributes,
//   so hover changes never reconcile ~2500 SVG elements.

'use client'

import * as React from 'react'
import type { FragmentDTO, GraphEdge, GraphNode, LayerId } from '@/lib/types'
import { LAYER_TITLES, GRAPH_NODE_KIND_TITLES, GRAPH_EDGE_KIND_TITLES } from '@/lib/types'
import { EDGE_KIND_VISUALS, EDGE_DRAW_ORDER, NODE_KIND_COLORS } from './graph-theme'
import { BOTTOM_PAD, HEADER_H, TOP_PAD, curvePath, type GraphLayout } from './graph-layout'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Maximize, Minus, Plus } from 'lucide-react'

const MIN_K = 0.1
const MAX_K = 4

export interface GraphCanvasProps {
  layout: GraphLayout
  /** filtered nodes (all visible) */
  nodes: GraphNode[]
  /** filtered edges (endpoints visible + kind enabled) */
  edges: GraphEdge[]
  /** search matches (null when the query is empty); non-matching nodes get dimmed */
  matchIds: Set<string> | null
  selectedNodeId: string | null
  selectedEdgeId: string | null
  onSelectNode: (node: GraphNode) => void
  onSelectEdge: (edge: GraphEdge) => void
  /** request to center the view on a node (nonce changes per request) */
  focus: { nodeId: string; nonce: number } | null
  fragmentById: (id: string) => Pick<FragmentDTO, 'id' | 'path' | 'text' | 'title'> | null
}

type Hover = { kind: 'node'; node: GraphNode; x: number; y: number } | { kind: 'edge'; edge: GraphEdge; x: number; y: number } | null

export function GraphCanvas(props: GraphCanvasProps) {
  const { layout, nodes, edges, matchIds, selectedNodeId, selectedEdgeId, focus } = props

  const containerRef = React.useRef<HTMLDivElement>(null)
  const gRef = React.useRef<SVGGElement>(null)
  const zoomLabelRef = React.useRef<HTMLSpanElement>(null)
  const viewRef = React.useRef({ k: 1, tx: 0, ty: 0 })
  const pointersRef = React.useRef(new Map<number, { x: number; y: number }>())
  const dragRef = React.useRef<{ lastX: number; lastY: number } | null>(null)
  const pinchRef = React.useRef<{ dist: number } | null>(null)
  const movedRef = React.useRef(0)
  const hoverIdRef = React.useRef<string | null>(null)
  const [hover, setHover] = React.useState<Hover>(null)

  const nodeById = React.useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const edgeById = React.useMemo(() => new Map(edges.map((e) => [e.id, e])), [edges])

  const apply = React.useCallback(() => {
    const { k, tx, ty } = viewRef.current
    gRef.current?.setAttribute('transform', `translate(${tx} ${ty}) scale(${k})`)
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(k * 100)}%`
  }, [])

  const fit = React.useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const w = el.clientWidth
    const h = el.clientHeight
    const k = clamp(Math.min((w - 24) / layout.width, (h - 24) / layout.height), MIN_K, 1.5)
    viewRef.current = { k, tx: (w - k * layout.width) / 2, ty: (h - k * layout.height) / 2 }
    apply()
  }, [apply, layout])

  const zoomAt = React.useCallback(
    (factor: number, cx: number, cy: number) => {
      const v = viewRef.current
      const k2 = clamp(v.k * factor, MIN_K, MAX_K)
      if (k2 === v.k) return
      v.tx = cx - ((cx - v.tx) * k2) / v.k
      v.ty = cy - ((cy - v.ty) * k2) / v.k
      v.k = k2
      apply()
    },
    [apply]
  )

  // wheel: zoom at cursor (non-passive to prevent page scroll)
  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - rect.left, e.clientY - rect.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // pointer gestures: 1 pointer = pan, 2 pointers = pinch zoom
  React.useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const pointers = pointersRef.current
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      movedRef.current += Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y)
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (pointers.size >= 2 && pinchRef.current) {
        const pts = [...pointers.values()]
        const midX = (pts[0].x + pts[1].x) / 2 - rect.left
        const midY = (pts[0].y + pts[1].y) / 2 - rect.top
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
        const p = pinchRef.current
        if (p.dist > 0) {
          const v = viewRef.current
          const k2 = clamp(v.k * (dist / p.dist), MIN_K, MAX_K)
          if (k2 !== v.k) {
            v.tx = midX - ((midX - v.tx) * k2) / v.k
            v.ty = midY - ((midY - v.ty) * k2) / v.k
            v.k = k2
            apply()
          }
        }
        pinchRef.current = { dist }
        dragRef.current = null
      } else if (dragRef.current) {
        const d = dragRef.current
        viewRef.current.tx += e.clientX - d.lastX
        viewRef.current.ty += e.clientY - d.lastY
        dragRef.current = { lastX: e.clientX, lastY: e.clientY }
        apply()
      }
    }
    const onUp = (e: PointerEvent) => {
      if (pointersRef.current.has(e.pointerId)) pointersRef.current.delete(e.pointerId)
      if (pointersRef.current.size < 2) pinchRef.current = null
      if (pointersRef.current.size === 0) {
        dragRef.current = null
        // click fires right after pointerup; reset the threshold slightly later
        window.setTimeout(() => {
          movedRef.current = 0
        }, 80)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [apply])

  const onPointerDown = React.useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointersRef.current.size === 1) {
      movedRef.current = 0
      dragRef.current = { lastX: e.clientX, lastY: e.clientY }
    } else {
      dragRef.current = null
      const pts = [...pointersRef.current.values()]
      pinchRef.current = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) }
    }
  }, [])

  // delegated interaction: click selects, pointer-over hovers
  const onClick = React.useCallback(
    (e: React.MouseEvent) => {
      if (movedRef.current > 6) return
      const target = e.target as Element
      const nodeEl = target.closest('[data-node-id]')
      if (nodeEl) {
        const node = nodeById.get(nodeEl.getAttribute('data-node-id') ?? '')
        if (node) props.onSelectNode(node)
        return
      }
      const edgeEl = target.closest('[data-edge-id]')
      if (edgeEl) {
        const edge = edgeById.get(edgeEl.getAttribute('data-edge-id') ?? '')
        if (edge) props.onSelectEdge(edge)
      }
    },
    [nodeById, edgeById, props]
  )

  const onPointerOver = React.useCallback(
    (e: React.PointerEvent) => {
      const target = e.target as Element
      const nodeEl = target.closest('[data-node-id]')
      const edgeEl = target.closest('[data-edge-id]')
      const id = nodeEl?.getAttribute('data-node-id') ?? edgeEl?.getAttribute('data-edge-id') ?? null
      if (id === hoverIdRef.current) return
      hoverIdRef.current = id
      if (!id) {
        setHover(null)
        return
      }
      const node = nodeEl ? nodeById.get(id) : undefined
      const edge = edgeEl ? edgeById.get(id) : undefined
      if (node) setHover({ kind: 'node', node, x: e.clientX, y: e.clientY })
      else if (edge) setHover({ kind: 'edge', edge, x: e.clientX, y: e.clientY })
      else setHover(null)
    },
    [nodeById, edgeById]
  )

  const onPointerOut = React.useCallback((e: React.PointerEvent) => {
    const to = e.relatedTarget as Element | null
    if (to && (to.closest('[data-node-id]') || to.closest('[data-edge-id]'))) return
    hoverIdRef.current = null
    setHover(null)
  }, [])

  // initial fit + keep fitted on container resize (before the user pans)
  React.useEffect(() => {
    fit()
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (movedRef.current === 0 && Math.abs(viewRef.current.tx) < 3) fit()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit])

  // focus requests (search hit, stats click)
  React.useEffect(() => {
    if (!focus) return
    const p = layout.positions.get(focus.nodeId)
    const el = containerRef.current
    if (!p || !el) return
    const v = viewRef.current
    const k = Math.max(v.k, 0.85)
    v.tx = el.clientWidth / 2 - k * p.x
    v.ty = el.clientHeight / 2 - k * p.y
    v.k = k
    apply()
  }, [focus, layout, apply])

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative h-full min-h-[420px] w-full touch-none select-none overflow-hidden rounded-lg border bg-grid bg-card'
      )}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
      role="application"
      aria-label="Карта правил: перетаскивание — панорама, колесо — масштаб, клик по узлу — выбор фрагмента"
    >
      <svg className="absolute inset-0 h-full w-full" style={{ shapeRendering: 'optimizeSpeed' }} aria-hidden>
        <g ref={gRef} style={{ willChange: 'transform' }}>
          <GraphSvgContent
            layout={layout}
            nodes={nodes}
            edges={edges}
            matchIds={matchIds}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
          />
        </g>
      </svg>

      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="max-w-sm rounded-md border border-dashed bg-card/80 p-4 text-sm text-muted-foreground">
            Фильтры исключили все узлы. Включите типы узлов, связи или разделы — либо нажмите «Сбросить фильтры».
          </p>
        </div>
      )}

      {/* zoom controls */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg border bg-card/90 p-1 shadow-sm">
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label="Приблизить"
          onClick={() => {
            const el = containerRef.current
            if (el) zoomAt(1.35, el.clientWidth / 2, el.clientHeight / 2)
          }}
        >
          <Plus className="size-4" aria-hidden />
        </Button>
        <span ref={zoomLabelRef} className="min-w-12 text-center font-mono text-xs tabular-nums text-muted-foreground">
          100%
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label="Отдалить"
          onClick={() => {
            const el = containerRef.current
            if (el) zoomAt(1 / 1.35, el.clientWidth / 2, el.clientHeight / 2)
          }}
        >
          <Minus className="size-4" aria-hidden />
        </Button>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2" onClick={fit}>
          <Maximize className="size-3.5" aria-hidden />
          Вся карта
        </Button>
      </div>

      {/* hover tooltip */}
      {hover && <GraphTooltip hover={hover} fragmentById={props.fragmentById} className="pointer-events-none fixed z-50" />}
    </div>
  )
}

// ---------- memoized heavy SVG content (data only, no callbacks) ----------

const GraphSvgContent = React.memo(function GraphSvgContent({
  layout,
  nodes,
  edges,
  matchIds,
  selectedNodeId,
  selectedEdgeId,
}: {
  layout: GraphLayout
  nodes: GraphNode[]
  edges: GraphEdge[]
  matchIds: Set<string> | null
  selectedNodeId: string | null
  selectedEdgeId: string | null
}) {
  const searching = matchIds !== null
  const byKind = React.useMemo(() => {
    const map = new Map<string, GraphEdge[]>()
    for (const e of edges) {
      const list = map.get(e.kind)
      if (list) list.push(e)
      else map.set(e.kind, [e])
    }
    return map
  }, [edges])

  const laneAxisBottom = layout.height - BOTTOM_PAD + 10

  return (
    <>
      {/* lane bands + headers */}
      {layout.lanes.map((lane) => {
        const dim = lane.count === 0
        return (
          <g key={lane.sectionPath} opacity={dim ? 0.35 : 1}>
            <title>{`Раздел ${lane.sectionPath}${lane.title ? ` — ${lane.title}` : ''}`}</title>
            <line
              x1={lane.x}
              y1={TOP_PAD + HEADER_H - 6}
              x2={lane.x}
              y2={laneAxisBottom}
              className="text-muted-foreground"
              stroke="currentColor"
              strokeOpacity={0.22}
              strokeDasharray="2 7"
            />
            <text x={lane.x} y={TOP_PAD + 4} textAnchor="middle" className="fill-foreground font-mono" fontSize={11} fontWeight={600}>
              {lane.sectionPath}
            </text>
            {lane.headerLines.map((line, i) => (
              <text key={i} x={lane.x} y={TOP_PAD + 17 + i * 11} textAnchor="middle" className="fill-muted-foreground" fontSize={9}>
                {line}
              </text>
            ))}
            {lane.count > 0 && (
              <text x={lane.x} y={laneAxisBottom + 12} textAnchor="middle" className="fill-muted-foreground font-mono" fontSize={9}>
                {lane.count}
              </text>
            )}
          </g>
        )
      })}

      {/* visible edge strokes (below nodes) */}
      {EDGE_DRAW_ORDER.map((kind) => {
        const list = byKind.get(kind) ?? []
        if (list.length === 0) return null
        const v = EDGE_KIND_VISUALS[kind]
        return (
          <g key={`e-${kind}`}>
            {list.map((edge) => {
              const p1 = layout.positions.get(edge.source)
              const p2 = layout.positions.get(edge.target)
              if (!p1 || !p2) return null
              const d = curvePath(p1.x, p1.y, p2.x, p2.y)
              const selected = selectedEdgeId === edge.id
              const isMatchDim = searching && !(matchIds!.has(edge.source) && matchIds!.has(edge.target))
              const tiedToSelection = selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId)
              const opacity = selected
                ? 1
                : isMatchDim
                  ? 0.05
                  : tiedToSelection
                    ? Math.min(1, v.opacity + 0.35)
                    : selectedNodeId
                      ? v.opacity * 0.25
                      : v.opacity
              return (
                <path
                  key={edge.id}
                  d={d}
                  fill="none"
                  stroke={v.color}
                  strokeWidth={selected ? v.width * 2.4 : tiedToSelection ? v.width + 0.6 : v.width}
                  strokeOpacity={opacity}
                  strokeDasharray={v.dash}
                  pointerEvents="none"
                />
              )
            })}
          </g>
        )
      })}

      {/* invisible fat hit strokes for hover/click (above edges, below nodes) */}
      {EDGE_DRAW_ORDER.map((kind) => {
        const list = byKind.get(kind) ?? []
        if (list.length === 0) return null
        return (
          <g key={`h-${kind}`}>
            {list.map((edge) => {
              const p1 = layout.positions.get(edge.source)
              const p2 = layout.positions.get(edge.target)
              if (!p1 || !p2) return null
              const d = curvePath(p1.x, p1.y, p2.x, p2.y)
              return (
                <path
                  key={`hit-${edge.id}`}
                  data-edge-id={edge.id}
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={10}
                  style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                />
              )
            })}
          </g>
        )
      })}

      {/* nodes */}
      {nodes.map((node) => {
        const p = layout.positions.get(node.id)
        if (!p) return null
        const selected = selectedNodeId === node.id
        const matched = matchIds?.has(node.id) ?? false
        const dimmed = searching && !matched
        const fill = NODE_KIND_COLORS[node.kind]
        const hitR = Math.max(p.r + 5, 11)
        return (
          <g key={node.id}>
            {selected && (
              <circle
                cx={p.x}
                cy={p.y}
                r={p.r + 7}
                fill="none"
                stroke="#2dd4bf"
                strokeWidth={1.4}
                strokeDasharray="4 3"
                style={{ filter: 'drop-shadow(0 0 5px rgba(45,212,191,0.7))' }}
                pointerEvents="none"
              />
            )}
            {matched && !selected && (
              <circle cx={p.x} cy={p.y} r={p.r + 5} fill="none" stroke="#2dd4bf" strokeWidth={1.2} strokeDasharray="3 3" pointerEvents="none" />
            )}
            <circle
              cx={p.x}
              cy={p.y}
              r={p.r}
              fill={fill}
              fillOpacity={dimmed ? 0.16 : 0.92}
              stroke="#0c1210"
              strokeOpacity={dimmed ? 0.1 : 0.55}
              strokeWidth={0.8}
              pointerEvents="none"
            />
            <circle data-node-id={node.id} cx={p.x} cy={p.y} r={hitR} fill="transparent" style={{ cursor: 'pointer', pointerEvents: 'all' }} />
            {matched && (
              <text x={p.x} y={p.y + hitR + 9} textAnchor="middle" fontSize={9} className="fill-muted-foreground" pointerEvents="none">
                {node.label.length > 30 ? node.label.slice(0, 30) + '…' : node.label}
              </text>
            )}
          </g>
        )
      })}
    </>
  )
})

// ---------- tooltip ----------

function GraphTooltip({
  hover,
  fragmentById,
  className,
}: {
  hover: NonNullable<Hover>
  fragmentById: (id: string) => Pick<FragmentDTO, 'id' | 'path' | 'text' | 'title'> | null
  className?: string
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [placed, setPlaced] = React.useState({ left: 0, top: 0 })
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth || 300
    const h = el.offsetHeight || 160
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left = Math.min(Math.max(12, hover.x + 16), Math.max(12, vw - w - 12))
    const top = Math.min(Math.max(12, hover.y + 18), Math.max(12, vh - h - 12))
    setPlaced({ left, top })
  }, [hover])

  if (hover.kind === 'node') {
    const node = hover.node
    const frag = fragmentById(node.fragmentId)
    const layers = node.layers as LayerId[]
    return (
      <div
        ref={ref}
        role="tooltip"
        className={cn('w-80 max-w-[86vw] rounded-lg border bg-card/95 p-3 text-xs shadow-xl backdrop-blur', className)}
        style={{ left: placed.left, top: placed.top }}
      >
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full" style={{ background: NODE_KIND_COLORS[node.kind] }} aria-hidden />
          <span className="font-medium">{GRAPH_NODE_KIND_TITLES[node.kind]}</span>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">{node.path}</span>
        </div>
        <p className="mt-1.5 leading-relaxed text-foreground/90">{frag ? frag.text : node.label}</p>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            Раздел: <span className="text-foreground/80">{node.sectionPath}</span>
            {node.sectionTitle ? ` — ${node.sectionTitle.replace(/^\s*[\d.]+\s*/, '')}` : ''}
          </span>
          <span>
            Связей: <span className="font-mono text-foreground/80">{node.degree}</span>
          </span>
        </div>
        {layers.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {layers.map((l) => (
              <span key={l} className="rounded border border-border bg-muted/50 px-1.5 py-px text-[10px] text-muted-foreground">
                {LAYER_TITLES[l]}
              </span>
            ))}
          </div>
        )}
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          Клик — выбрать фрагмент; связи графа — терминологические, не логические зависимости.
        </p>
      </div>
    )
  }

  const edge = hover.edge
  const v = EDGE_KIND_VISUALS[edge.kind]
  return (
    <div
      ref={ref}
      role="tooltip"
      className={cn('w-80 max-w-[86vw] rounded-lg border bg-card/95 p-3 text-xs shadow-xl backdrop-blur', className)}
      style={{ left: placed.left, top: placed.top }}
    >
      <div className="flex items-center gap-2">
        <span className="size-2.5 rounded-full" style={{ background: v.color }} aria-hidden />
        <span className="font-medium">связь: {GRAPH_EDGE_KIND_TITLES[edge.kind]}</span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/90">{edge.basis.detail}</p>
      <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
        <p>
          основание: <span className="font-mono text-[10px] text-foreground/80">{edge.basis.type}</span>
        </p>
        {edge.basis.similarity !== undefined && (
          <p>
            сходство: <span className="font-mono text-foreground/80">{edge.basis.similarity.toFixed(2)}</span>{' '}
            <span className="text-amber-600 dark:text-amber-300">(в одном представлении; не доказательство эквивалентности)</span>
          </p>
        )}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        Клик — показать связь целиком; терминологические связи — не логические зависимости.
      </p>
    </div>
  )
}

// ---------- helpers ----------

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}
