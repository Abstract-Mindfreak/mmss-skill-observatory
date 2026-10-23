// Document structure model for the Instruction Atlas: section tree,
// blocks (paragraphs / list items) with their sentences, lookups.
// Derived client-side from appState.fragments (fragments of the active version).

import type { FragmentDTO, ScenarioDTO } from '@/lib/types'

export interface SectionNode {
  section: FragmentDTO
  children: SectionNode[]
  depth: number
}

export interface Block {
  /** paragraph or list_item fragment */
  fragment: FragmentDTO
  /** sentence fragments of this block (path = block.path + '.N') */
  sentences: FragmentDTO[]
}

export interface SectionContent {
  node: SectionNode
  /** direct blocks of the section (not counting subsection content) */
  blocks: Block[]
  subsections: SectionNode[]
}

export interface DocStructure {
  roots: SectionNode[]
  /** all sections in document order */
  orderedSections: SectionNode[]
  sectionsByPath: Map<string, SectionNode>
  /** nearest section path for every fragment (sections map to themselves) */
  sectionPathOf: Map<string, string>
  contentByPath: Map<string, SectionContent>
  byId: Map<string, FragmentDTO>
  all: FragmentDTO[]
}

function nearestSectionPath(path: string, sectionsByPath: Map<string, unknown>): string | null {
  let parts = path.split('.')
  while (parts.length > 1) {
    parts = parts.slice(0, -1)
    const p = parts.join('.')
    if (sectionsByPath.has(p)) return p
  }
  return null
}

export function buildDocStructure(fragments: FragmentDTO[]): DocStructure {
  const all = [...fragments].sort((a, b) => a.order - b.order)
  const sections = all.filter((f) => f.kind === 'section')
  const sectionsByPath = new Map<string, SectionNode>()
  for (const s of sections) sectionsByPath.set(s.path, { section: s, children: [], depth: 0 })

  const roots: SectionNode[] = []
  const orderedSections: SectionNode[] = []
  for (const s of sections) {
    const node = sectionsByPath.get(s.path)!
    orderedSections.push(node)
    const parts = s.path.split('.')
    // 'T' is the document root section; top-level numbered sections nest under it.
    let parentPath: string | null = null
    if (parts.length > 1) parentPath = parts.slice(0, -1).join('.')
    else if (s.path !== 'T' && s.path !== '0') parentPath = 'T'
    const parent = parentPath ? sectionsByPath.get(parentPath) : undefined
    if (parent) {
      node.depth = parent.depth + 1
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sectionPathOf = new Map<string, string>()
  for (const s of sections) sectionPathOf.set(s.id, s.path)

  // blocks: paragraphs and list items, grouped under their nearest section
  const blocksBySection = new Map<string, Block[]>()
  const blockByPath = new Map<string, Block>()
  for (const f of all) {
    if (f.kind !== 'paragraph' && f.kind !== 'list_item') continue
    const block: Block = { fragment: f, sentences: [] }
    if (!blockByPath.has(f.path)) blockByPath.set(f.path, block)
    const sp = nearestSectionPath(f.path, sectionsByPath)
    if (sp) {
      const arr = blocksBySection.get(sp) ?? []
      arr.push(block)
      blocksBySection.set(sp, arr)
    }
    if (!sectionPathOf.has(f.id) && sp) sectionPathOf.set(f.id, sp)
  }

  // sentences attach to their parent block; orphans become standalone rows
  for (const f of all) {
    if (f.kind !== 'sentence') continue
    const parentPath = f.path.split('.').slice(0, -1).join('.')
    const block = blockByPath.get(parentPath)
    if (block) {
      block.sentences.push(f)
    } else {
      const b: Block = { fragment: f, sentences: [] }
      const sp = nearestSectionPath(f.path, sectionsByPath)
      if (sp) {
        const arr = blocksBySection.get(sp) ?? []
        arr.push(b)
        blocksBySection.set(sp, arr)
      }
    }
    if (!sectionPathOf.has(f.id)) {
      const sp = nearestSectionPath(f.path, sectionsByPath)
      if (sp) sectionPathOf.set(f.id, sp)
    }
  }

  const contentByPath = new Map<string, SectionContent>()
  for (const node of orderedSections) {
    const blocks = (blocksBySection.get(node.section.path) ?? [])
      .slice()
      .sort((a, b) => a.fragment.order - b.fragment.order)
    for (const b of blocks) b.sentences.sort((x, y) => x.order - y.order)
    contentByPath.set(node.section.path, { node, blocks, subsections: node.children })
  }

  return {
    roots,
    orderedSections,
    sectionsByPath,
    sectionPathOf,
    contentByPath,
    byId: new Map(all.map((f) => [f.id, f])),
    all,
  }
}

/** Sections linked to scenarios: section path is a prefix of a scenario anchor fragment path. */
export function computeLinkedSections(
  structure: DocStructure,
  scenarios: ScenarioDTO[]
): Map<string, number> {
  const anchorPaths: string[] = []
  for (const sc of scenarios) {
    if (!sc.fragmentId) continue
    const f = structure.byId.get(sc.fragmentId)
    if (f) anchorPaths.push(f.path)
  }
  const res = new Map<string, number>()
  for (const node of structure.orderedSections) {
    let n = 0
    for (const p of anchorPaths) {
      if (p === node.section.path || p.startsWith(node.section.path + '.')) n++
    }
    if (n > 0) res.set(node.section.path, n)
  }
  return res
}

/**
 * Live coverage set: leaf fragments (sentences + list items) whose nearest
 * section contains a scenario anchor. Mirrors the backend local-structural
 * heuristic (leaves of scenario-linked sections), but recomputed from the
 * current scenario list, not from the analysis snapshot.
 */
export function computeCoverageSet(structure: DocStructure, scenarios: ScenarioDTO[]): Set<string> {
  const anchored = new Set<string>()
  for (const sc of scenarios) {
    if (!sc.fragmentId) continue
    const sp = structure.sectionPathOf.get(sc.fragmentId)
    if (sp) anchored.add(sp)
  }
  const cov = new Set<string>()
  for (const f of structure.all) {
    if (f.kind !== 'sentence' && f.kind !== 'list_item') continue
    const sp = structure.sectionPathOf.get(f.id)
    if (sp && anchored.has(sp)) cov.add(f.id)
  }
  return cov
}
