// Interaction graph built from the latest local-structural analysis of a version.
// Every edge carries an explicit basis; all heuristics are lexical/structural,
// not logical dependency analysis.

import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'
import type {
  FragmentAnnotation,
  GraphData,
  GraphEdge,
  GraphEdgeKind,
  GraphNode,
  GraphNodeKind,
  LayerId,
  LocalAnalysisResult,
} from '@/lib/types'
import { sectionPathOf } from '@/lib/analysis'
import type { Fragment, Scenario } from '@prisma/client'

const EDGE_CAP = 1500

const SECTION_KIND_MAP: Record<string, GraphNodeKind> = {
  '4': 'operation',
  '8': 'contract',
  '9': 'contract',
  '10': 'contract',
  '12': 'contract',
  '15': 'validation',
  '5': 'completion',
  '11': 'completion',
  '18': 'completion',
}

const LAYER_KIND_ORDER: { layer: LayerId; kind: GraphNodeKind }[] = [
  { layer: 'definition', kind: 'definition' },
  { layer: 'prohibition', kind: 'constraint' },
  { layer: 'obligation', kind: 'requirement' },
  { layer: 'exception', kind: 'exception' },
  { layer: 'condition', kind: 'condition' },
  { layer: 'evidence', kind: 'validation' },
]

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'when', 'where', 'of',
  'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'as', 'is', 'are',
  'be', 'been', 'was', 'were', 'it', 'its', 'this', 'that', 'these', 'those',
  'not', 'no', 'do', 'does', 'did', 'can', 'may', 'must', 'shall', 'should',
  'will', 'would', 'use', 'used', 'uses', 'using', 'than', 'each', 'every',
  'any', 'all', 'some', 'such', 'only', 'also', 'into', 'within', 'without',
  'between', 'per', 'via', 'one', 'two', 'new', 'other', 'same', 'own',
])

export async function buildGraph(versionId: string): Promise<GraphData | null> {
  const version = await db.documentVersion.findUnique({ where: { id: versionId } })
  if (!version) return null
  const analysis = await db.analysis.findFirst({
    where: { versionId, type: 'local-structural' },
    orderBy: { createdAt: 'desc' },
  })
  if (!analysis) return null
  const result = safeParse<LocalAnalysisResult>(analysis.result, {
    annotations: [],
    layerCounts: {},
    repetitions: [],
    conflictCandidates: [],
    unusedDefinitions: [],
    brokenRefs: [],
    ambiguityHotspots: [],
  } as unknown as LocalAnalysisResult)

  const fragments: Fragment[] = await db.fragment.findMany({
    where: { versionId },
    orderBy: { order: 'asc' },
  })
  const scenarios: Scenario[] = await db.scenario.findMany({
    where: { projectId: version.projectId },
    orderBy: { order: 'asc' },
  })
  const findings = await db.finding.findMany({
    where: { projectId: version.projectId, status: { in: ['disputed', 'rejected'] } },
  })

  const sections = new Map<string, Fragment>()
  for (const f of fragments) {
    if (f.kind === 'section' && !sections.has(f.path)) sections.set(f.path, f)
  }
  const sectionPaths = new Set(sections.keys())
  const fragmentById = new Map(fragments.map((f) => [f.id, f]))
  const leaves = fragments.filter(
    (f) => f.kind === 'sentence' || f.kind === 'list_item'
  )
  const annotationsById = new Map<string, FragmentAnnotation>()
  for (const ann of result.annotations) annotationsById.set(ann.fragmentId, ann)

  const sectionOfFragment = (f: Fragment): string | null =>
    sectionPathOf(f.path, sectionPaths)

  // ---------- nodes ----------
  const nodes = new Map<string, GraphNode>()
  const makeNode = (f: Fragment): GraphNode => {
    const ann = annotationsById.get(f.id)
    const layers: LayerId[] = (ann?.layers ?? []).map((l) => l.layer)
    let kind: GraphNodeKind | null = null
    for (const rule of LAYER_KIND_ORDER) {
      if (layers.includes(rule.layer)) {
        kind = rule.kind
        break
      }
    }
    const sectionPath = sectionOfFragment(f)
    if (!kind) kind = SECTION_KIND_MAP[sectionPath ?? ''] ?? 'requirement'
    return {
      id: f.id,
      fragmentId: f.id,
      label: f.text.slice(0, 80),
      kind,
      path: f.path,
      sectionPath: sectionPath ?? '',
      sectionTitle: sectionPath ? sections.get(sectionPath)?.title ?? null : null,
      degree: 0,
      layers,
    }
  }
  for (const leaf of leaves) {
    const ann = annotationsById.get(leaf.id)
    if (ann && ann.layers.length > 0) nodes.set(leaf.id, makeNode(leaf))
  }

  // ---------- edges ----------
  const edges: GraphEdge[] = []
  const edgeKeys = new Set<string>()
  let edgeCounter = 0
  const addEdge = (
    source: string,
    target: string,
    kind: GraphEdgeKind,
    basisType: GraphEdge['basis']['type'],
    detail: string,
    similarity?: number
  ) => {
    if (!source || !target || source === target) return
    const key = `${source}|${target}|${kind}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edgeCounter++
    edges.push({
      id: `e${edgeCounter}`,
      source,
      target,
      kind,
      basis: { type: basisType, detail, ...(similarity !== undefined ? { similarity } : {}) },
    })
  }

  // significant terms: len >= 4, not a stopword, present in <= 30% of leaves
  const leafCount = Math.max(1, leaves.length)
  const termDocFreq = new Map<string, number>()
  for (const leaf of leaves) {
    const ann = annotationsById.get(leaf.id)
    if (!ann) continue
    for (const term of new Set(ann.terms)) {
      termDocFreq.set(term, (termDocFreq.get(term) ?? 0) + 1)
    }
  }
  const isSignificant = (term: string): boolean =>
    term.length >= 4 &&
    !STOPWORDS.has(term.toLowerCase()) &&
    (termDocFreq.get(term) ?? 0) <= leafCount * 0.3

  // defines: definition fragment -> fragments containing its defined term
  for (const leaf of leaves) {
    const ann = annotationsById.get(leaf.id)
    if (!ann || !ann.layers.some((l) => l.layer === 'definition')) continue
    for (const term of ann.terms) {
      const df = termDocFreq.get(term) ?? 0
      if (term.length < 3 || df > Math.max(10, leafCount * 0.3)) continue
      for (const other of leaves) {
        if (other.id === leaf.id) continue
        const otherAnn = annotationsById.get(other.id)
        if (otherAnn?.terms.includes(term)) {
          addEdge(leaf.id, other.id, 'defines', 'shared-term', `общий термин «${term}»`)
        }
      }
    }
  }

  // uses / depends-on: section references
  for (const leaf of leaves) {
    const ann = annotationsById.get(leaf.id)
    if (!ann || ann.sectionRefs.length === 0) continue
    const isDependency = /follow\w*\s+(?:the\s+)?[\w-]+\s*(?:procedure|contract)\s+in\s+Section\s+\d/i.test(
      leaf.text
    )
    for (const ref of ann.sectionRefs) {
      const num = /(?:Section |§)(\d+(?:\.\d+)?)/.exec(ref)?.[1]
      if (!num || !sectionPaths.has(num)) continue
      const target = leaves.find(
        (l) =>
          sectionOfFragment(l) === num ||
          sectionOfFragment(l)?.startsWith(`${num}.`) === true
      )
      if (!target) continue
      addEdge(
        leaf.id,
        target.id,
        isDependency ? 'depends-on' : 'uses',
        'section-reference',
        `ссылка на раздел ${num}`
      )
    }
  }

  // restricts: prohibition -> up to 3 fragments sharing significant terms
  for (const leaf of leaves) {
    const ann = annotationsById.get(leaf.id)
    if (!ann || !ann.layers.some((l) => l.layer === 'prohibition')) continue
    const scored: { id: string; term: string; df: number }[] = []
    for (const other of leaves) {
      if (other.id === leaf.id) continue
      const otherAnn = annotationsById.get(other.id)
      if (!otherAnn) continue
      const shared = ann.terms.filter(
        (t) => otherAnn.terms.includes(t) && isSignificant(t)
      )
      if (shared.length === 0) continue
      const best = shared
        .map((t) => ({ t, df: termDocFreq.get(t) ?? 0 }))
        .sort((a, b) => a.df - b.df)[0]
      scored.push({ id: other.id, term: best.t, df: best.df })
    }
    scored.sort((a, b) => a.df - b.df)
    for (const cand of scored.slice(0, 3)) {
      addEdge(leaf.id, cand.id, 'restricts', 'shared-term', `общий термин «${cand.term}»`)
    }
  }

  // refines / excepts: nearest preceding leaf within the same section
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i]
    const ann = annotationsById.get(leaf.id)
    if (!ann) continue
    const layers = ann.layers.map((l) => l.layer)
    const section = sectionOfFragment(leaf)
    if (layers.includes('condition') || layers.includes('exception')) {
      for (let j = i - 1; j >= 0; j--) {
        if (sectionOfFragment(leaves[j]) === section) {
          addEdge(leaf.id, leaves[j].id, 'refines', 'structure', 'условие/исключение в том же разделе')
          break
        }
      }
    }
    if (layers.includes('exception')) {
      for (let j = i - 1; j >= 0; j--) {
        const prevAnn = annotationsById.get(leaves[j].id)
        const prevLayers = prevAnn?.layers.map((l) => l.layer) ?? []
        if (
          sectionOfFragment(leaves[j]) === section &&
          (prevLayers.includes('obligation') || prevLayers.includes('prohibition'))
        ) {
          addEdge(
            leaf.id,
            leaves[j].id,
            'excepts',
            'structure',
            'исключение рядом с обязательством/запретом в том же разделе'
          )
          break
        }
      }
    }
  }

  // repeats: pairwise inside repetition clusters
  for (const group of result.repetitions) {
    for (let i = 0; i < group.fragmentIds.length; i++) {
      for (let j = i + 1; j < group.fragmentIds.length; j++) {
        addEdge(
          group.fragmentIds[i],
          group.fragmentIds[j],
          'repeats',
          'lexical-similarity',
          'лексическое сходство (Жаккард по токенам)',
          group.similarity
        )
      }
    }
  }

  // conflicts: conflict candidates
  for (const cand of result.conflictCandidates) {
    addEdge(cand.aFragmentId, cand.bFragmentId, 'conflicts', 'shared-term', cand.clashConditions)
  }

  // scenario-supported: scenario anchor -> other nodes in the covered section
  for (const scenario of scenarios) {
    if (!scenario.fragmentId) continue
    const anchor = fragmentById.get(scenario.fragmentId)
    if (!anchor) continue
    const anchorSection = sectionOfFragment(anchor)
    if (!anchorSection) continue
    if ((anchor.kind === 'sentence' || anchor.kind === 'list_item') && !nodes.has(anchor.id)) {
      nodes.set(anchor.id, makeNode(anchor))
    }
    for (const node of nodes.values()) {
      if (node.id === anchor.id || node.sectionPath !== anchorSection) continue
      addEdge(
        anchor.id,
        node.id,
        'scenario-supported',
        'scenario-link',
        `сценарий «${scenario.title}» привязан к разделу ${anchorSection}`
      )
    }
  }

  // disputed: findings with status disputed/rejected point at their fragment
  for (const finding of findings) {
    if (!finding.fragmentId) continue
    const target = fragmentById.get(finding.fragmentId)
    if (!target) continue
    let source: Fragment | undefined
    if (finding.scenarioId) {
      const scenario = scenarios.find((s) => s.id === finding.scenarioId)
      if (scenario?.fragmentId) source = fragmentById.get(scenario.fragmentId)
    }
    if (!source) continue
    const statusTitle = finding.status === 'rejected' ? 'отклонена' : 'оспорена'
    addEdge(
      source.id,
      target.id,
      'disputed',
      'finding-link',
      `находка «${finding.title}» (${statusTitle}) оспаривает применение этого фрагмента`
    )
  }

  // ---------- cap total edges, dropping from the largest kind buckets ----------
  if (edges.length > EDGE_CAP) {
    const byKind = new Map<GraphEdgeKind, GraphEdge[]>()
    for (const e of edges) {
      if (!byKind.has(e.kind)) byKind.set(e.kind, [])
      byKind.get(e.kind)!.push(e)
    }
    while (edges.length > EDGE_CAP) {
      let largestKind: GraphEdgeKind | null = null
      let largestSize = 0
      for (const [kind, list] of byKind) {
        if (kind === 'disputed') continue
        if (list.length > largestSize) {
          largestSize = list.length
          largestKind = kind
        }
      }
      if (!largestKind) break
      const removed = byKind.get(largestKind)!.pop()!
      const idx = edges.indexOf(removed)
      if (idx >= 0) edges.splice(idx, 1)
    }
  }

  // ---------- degrees & stats ----------
  for (const edge of edges) {
    const s = nodes.get(edge.source)
    const t = nodes.get(edge.target)
    if (s) s.degree++
    if (t) t.degree++
  }

  const centralNodes = [...nodes.values()]
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 10)
    .map((n) => ({ nodeId: n.id, degree: n.degree }))

  const bridges = edges
    .filter((e) => {
      const s = nodes.get(e.source)
      const t = nodes.get(e.target)
      return s && t && s.sectionPath !== t.sectionPath
    })
    .slice(0, 40)
    .map((e) => ({
      edgeId: e.id,
      fromSection: nodes.get(e.source)?.sectionPath ?? '',
      toSection: nodes.get(e.target)?.sectionPath ?? '',
    }))

  const isolatedNodes = [...nodes.values()]
    .filter((n) => n.degree === 0)
    .map((n) => n.id)

  const duplicateClusters = result.repetitions
    .map((g) => ({
      nodeIds: g.fragmentIds.filter((id) => nodes.has(id)),
      similarity: g.similarity,
    }))
    .filter((g) => g.nodeIds.length >= 2)

  // longest chain over depends-on / refines (approximation, cycle-guarded DFS)
  const chainAdj = new Map<string, string[]>()
  for (const e of edges) {
    if (e.kind !== 'depends-on' && e.kind !== 'refines') continue
    if (!chainAdj.has(e.source)) chainAdj.set(e.source, [])
    chainAdj.get(e.source)!.push(e.target)
  }
  let longestChain: { nodes: string[]; length: number } = { nodes: [], length: 0 }
  {
    const bestFrom = new Map<string, string[]>()
    let steps = 0
    const dfs = (nodeId: string, visited: Set<string>): string[] => {
      steps++
      if (steps > 50000) return [nodeId]
      if (bestFrom.has(nodeId)) return bestFrom.get(nodeId)!
      if (visited.has(nodeId)) return [nodeId]
      visited.add(nodeId)
      let best: string[] = [nodeId]
      for (const next of chainAdj.get(nodeId) ?? []) {
        if (visited.has(next)) continue
        const path = dfs(next, visited)
        if (path.length + 1 > best.length) best = [nodeId, ...path]
      }
      visited.delete(nodeId)
      bestFrom.set(nodeId, best)
      return best
    }
    for (const start of chainAdj.keys()) {
      const path = dfs(start, new Set())
      if (path.length > longestChain.length) longestChain = { nodes: path, length: path.length }
    }
    if (longestChain.length === 0) longestChain = { nodes: [], length: 0 }
  }

  const scenarioTopSections = new Set<string>()
  for (const scenario of scenarios) {
    if (!scenario.fragmentId) continue
    const f = fragmentById.get(scenario.fragmentId)
    const sp = f ? sectionOfFragment(f) : null
    if (sp) scenarioTopSections.add(sp.split('.')[0])
  }
  const sectionsWithoutScenarios = [...sections.entries()]
    .filter(([path]) => /^[1-9]\d*$/.test(path) && !scenarioTopSections.has(path))
    .map(([path, f]) => ({ path, title: f.title }))

  const nodeList = [...nodes.values()]

  return {
    nodes: nodeList,
    edges,
    stats: {
      centralNodes,
      bridges,
      isolatedNodes,
      duplicateClusters,
      longestChain,
      sectionsWithoutScenarios,
      methodSummary:
        'Граф построен из локального структурного анализа: связи по общим терминам, ссылкам на разделы, лексическому сходству, сценариям и находкам',
      limitations: [
        'Терминологические связи не эквивалентны логическим зависимостям',
        'Сходство embedding/лексическое ≠ эквивалентность формулировок',
        'Самая длинная цепочка — приближение (DFS по рёбрам depends-on/refines с защитой от циклов)',
      ],
    },
    provenance: 'LOCAL',
    versionId,
    generatedAt: new Date().toISOString(),
  }
}
