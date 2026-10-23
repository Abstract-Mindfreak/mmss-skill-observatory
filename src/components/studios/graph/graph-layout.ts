// Deterministic section-lane layout for the rule map — no physics, no simulation.
// Lanes = sections in document order (like a subway map): x = section index,
// y = document order inside the section. Stable, fast, honest about structure.

import type { GraphNode } from '@/lib/types'

export const LANE_PITCH = 104 // distance between lane centers
export const LANE_HALF = 44 // half of the visual lane band
export const HEADER_H = 78 // lane header block height
export const TOP_PAD = 16
export const ROW_GAP = 26 // vertical distance between node centers in a lane
export const SIDE_PAD = 48
export const BOTTOM_PAD = 40
export const MAX_HEADER_LINES = 3
export const HEADER_CHARS = 15 // ~chars per header line at font-size 9.5

export interface PositionedNode {
  node: GraphNode
  x: number
  y: number
  /** radius 4..16 by degree */
  r: number
  order: number
}

export interface Lane {
  sectionPath: string
  title: string | null
  /** header lines (title without the leading number) */
  headerLines: string[]
  x: number
  index: number
  count: number
  nodes: PositionedNode[]
}

export interface GraphLayout {
  lanes: Lane[]
  positions: Map<string, { x: number; y: number; r: number }>
  laneOf: Map<string, Lane>
  width: number
  height: number
  maxDegree: number
}

/** Numeric document order for fragment paths: '6.2.10' < '6.2.2'. */
export function comparePaths(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1)
    if (d !== 0) return d
  }
  return a.localeCompare(b)
}

/** Strip the leading section number from a section title: '6.2 Inaccessible…' → 'Inaccessible…'. */
function titleBody(title: string): string {
  return title.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, '')
}

/** Greedy word wrap; returns at most MAX_HEADER_LINES lines (last one gets an ellipsis when truncated). */
function wrapTitle(title: string | null): string[] {
  if (!title) return []
  const body = titleBody(title)
  const words = body.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const all: string[] = []
  let cur = ''
  for (const w of words) {
    if (cur.length === 0) cur = w
    else if (cur.length + 1 + w.length <= HEADER_CHARS) cur += ' ' + w
    else {
      all.push(cur)
      cur = w
    }
  }
  if (cur) all.push(cur)
  if (all.length <= MAX_HEADER_LINES) return all
  const kept = all.slice(0, MAX_HEADER_LINES)
  kept[MAX_HEADER_LINES - 1] = kept[MAX_HEADER_LINES - 1].slice(0, HEADER_CHARS - 1) + '…'
  return kept
}

export function computeLayout(nodes: GraphNode[]): GraphLayout {
  // group by sectionPath in document order of first appearance
  // (nodes arrive from the API in fragment/document order, so insertion order = section order)
  const sectionsInOrder: string[] = []
  const lanesBySection = new Map<string, GraphNode[]>()
  for (const n of nodes) {
    if (!lanesBySection.has(n.sectionPath)) {
      lanesBySection.set(n.sectionPath, [])
      sectionsInOrder.push(n.sectionPath)
    }
    lanesBySection.get(n.sectionPath)!.push(n)
  }

  const maxDegree = nodes.reduce((m, n) => Math.max(m, n.degree), 0) || 1
  const lanes: Lane[] = []
  const positions = new Map<string, { x: number; y: number; r: number }>()
  const laneOf = new Map<string, Lane>()

  sectionsInOrder.forEach((sectionPath, i) => {
    const group = lanesBySection.get(sectionPath)!
    group.sort((a, b) => comparePaths(a.path, b.path))
    const x = SIDE_PAD + LANE_PITCH * i + LANE_PITCH / 2 - LANE_HALF
    const lane: Lane = {
      sectionPath,
      title: group[0]?.sectionTitle ?? null,
      headerLines: wrapTitle(group[0]?.sectionTitle ?? null),
      x,
      index: i,
      count: group.length,
      nodes: [],
    }
    group.forEach((node, j) => {
      const r = 4 + 12 * Math.sqrt(node.degree / maxDegree)
      const y = TOP_PAD + HEADER_H + j * ROW_GAP
      const pn: PositionedNode = { node, x, y, r, order: j }
      lane.nodes.push(pn)
      positions.set(node.id, { x, y, r })
      laneOf.set(node.id, lane)
    })
    lanes.push(lane)
  })

  const height = TOP_PAD + HEADER_H + Math.max(1, ...lanes.map((l) => l.count), 0) * ROW_GAP + BOTTOM_PAD
  const width = SIDE_PAD + LANE_PITCH * Math.max(1, lanes.length)
  return { lanes, positions, laneOf, width, height, maxDegree }
}

/** Cubic bezier between two points; bulges sideways when the points are stacked. */
export function curvePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1
  const dy = y2 - y1
  if (Math.abs(dx) > 10) {
    const c = Math.abs(dx) * 0.45
    return `M ${x1} ${y1} C ${x1 + Math.sign(dx) * c} ${y1}, ${x2 - Math.sign(dx) * c} ${y2}, ${x2} ${y2}`
  }
  // same (or adjacent) lane: arc to the right so vertical runs don't overlap nodes
  const bulge = 34
  const dir = dy >= 0 ? 1 : -1
  return `M ${x1} ${y1} C ${x1 + bulge} ${y1 + dir * Math.abs(dy) * 0.25}, ${x2 + bulge} ${y2 - dir * Math.abs(dy) * 0.25}, ${x2} ${y2}`
}
