// Visual system of the rule map: fixed color maps for node kinds and edge kinds.
// Same palette family as the atlas layers (see shared/layers.tsx). Color is never
// the only carrier of meaning — tooltips always repeat the title in text.

import type { GraphEdgeKind, GraphNodeKind } from '@/lib/types'

/** Node kind → fill hex (same palette family as layer colors). */
export const NODE_KIND_COLORS: Record<GraphNodeKind, string> = {
  definition: '#a3e635', // lime
  requirement: '#fbbf24', // amber
  constraint: '#fb7185', // rose
  condition: '#fb923c', // orange
  exception: '#e879f9', // fuchsia
  operation: '#5eead4', // teal
  contract: '#a78bfa', // violet
  validation: '#4ade80', // green
  completion: '#6ee7b7', // emerald
}

/** Edge kind → stroke hex. */
export const EDGE_KIND_COLORS: Record<GraphEdgeKind, string> = {
  defines: '#a3e635',
  uses: '#94a3b8',
  restricts: '#fb7185',
  refines: '#fb923c',
  excepts: '#e879f9',
  'depends-on': '#fbbf24',
  repeats: '#d6d3d1',
  conflicts: '#f87171',
  'scenario-supported': '#6ee7b7',
  disputed: '#f87171',
  'missing-link': '#a1a1aa',
}

export interface EdgeVisual {
  color: string
  width: number
  /** SVG dash array; undefined = solid. */
  dash?: string
  /** Base opacity (0..1) in the unfiltered view. */
  opacity: number
}

/** Edge kind → stroke style. repeats is de-emphasized (dashed, faint):
 *  it dominates the edge count and would otherwise bury the semantic links. */
export const EDGE_KIND_VISUALS: Record<GraphEdgeKind, EdgeVisual> = {
  defines: { color: '#a3e635', width: 1.6, opacity: 0.7 },
  uses: { color: '#94a3b8', width: 1.5, opacity: 0.65 },
  restricts: { color: '#fb7185', width: 1.6, opacity: 0.65 },
  refines: { color: '#fb923c', width: 1.4, opacity: 0.6 },
  excepts: { color: '#e879f9', width: 1.4, opacity: 0.65 },
  'depends-on': { color: '#fbbf24', width: 2, opacity: 0.8 },
  repeats: { color: '#d6d3d1', width: 1.1, dash: '2 5', opacity: 0.35 },
  conflicts: { color: '#f87171', width: 2, dash: '7 4', opacity: 0.85 },
  'scenario-supported': { color: '#6ee7b7', width: 1.5, dash: '1 3', opacity: 0.65 },
  disputed: { color: '#f87171', width: 1.6, dash: '5 3', opacity: 0.75 },
  'missing-link': { color: '#a1a1aa', width: 1.3, dash: '3 3', opacity: 0.55 },
}

/** Draw order for edge groups: repeats at the bottom, conflicts on top. */
export const EDGE_DRAW_ORDER: GraphEdgeKind[] = [
  'repeats',
  'scenario-supported',
  'missing-link',
  'uses',
  'refines',
  'restricts',
  'excepts',
  'depends-on',
  'disputed',
  'defines',
  'conflicts',
]

/** Node kinds in display order (chips, stats). */
export const NODE_KIND_ORDER: GraphNodeKind[] = [
  'definition',
  'requirement',
  'constraint',
  'condition',
  'exception',
  'operation',
  'contract',
  'validation',
  'completion',
]

export const EDGE_KIND_ORDER: GraphEdgeKind[] = [
  'defines',
  'uses',
  'restricts',
  'refines',
  'excepts',
  'depends-on',
  'repeats',
  'conflicts',
  'scenario-supported',
  'disputed',
  'missing-link',
]
