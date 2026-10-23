// Markdown document parser: content -> structural fragments (sections, paragraphs,
// list items, sentences). Line numbers are 1-based positions in the source text.

import type { FragmentKind } from '@/lib/types'

export interface ParsedFragment {
  kind: FragmentKind
  path: string
  order: number
  title: string | null
  text: string
  startLine: number
  endLine: number
  meta: { wordCount?: number; listIndex?: number; indent?: number }
}

const HEADING_RE = /^(#{1,3}) (.+)$/
const LIST_MARKER_RE = /^(?:[-*]|\d+\.)\s+/
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+(?=[A-Z0-9"(`])/g
const SENTINEL = '\u0001'
const ABBREVIATIONS = [
  'i.e.', 'e.g.', 'etc.', 'vs.', 'cf.',
  'sr.', 'jr.', 'dr.', 'mr.', 'ms.', 'st.', 'no.', 'fig.', 'sec.',
]

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

// Protect abbreviation dots so the sentence splitter ignores them.
function protectAbbreviations(text: string): string {
  let out = text
  for (const abbr of ABBREVIATIONS) {
    const escaped = abbr.replace(/\./g, '\\.')
    out = out.replace(new RegExp(`\\b${escaped}(?=\\s)`, 'gi'), abbr.slice(0, -1) + SENTINEL)
  }
  return out
}

interface SentenceSpan {
  text: string
  start: number
  end: number
}

function splitSentences(text: string): SentenceSpan[] {
  const protectedText = protectAbbreviations(text)
  const spans: SentenceSpan[] = []
  let last = 0
  for (const m of protectedText.matchAll(SENTENCE_SPLIT_RE)) {
    const idx = m.index ?? 0
    if (idx > last) spans.push({ text: '', start: last, end: idx })
    last = idx + m[0].length
  }
  spans.push({ text: '', start: last, end: protectedText.length })
  const out: SentenceSpan[] = []
  for (const span of spans) {
    const raw = protectedText.slice(span.start, span.end)
    const lead = raw.length - raw.trimStart().length
    const trail = raw.length - raw.trimEnd().length
    const sentence = raw.trim().split(SENTINEL).join('.')
    if (sentence.length < 3) continue
    out.push({ text: sentence, start: span.start + lead, end: span.end - trail })
  }
  return out
}

interface HeadingInfo {
  level: number
  line: number
  title: string
  path: string
  rangeEnd: number
}

interface RawBlock {
  lines: { idx: number; text: string }[]
}

export function parseDocument(content: string): ParsedFragment[] {
  const lines = content.split('\n')
  const fragments: ParsedFragment[] = []

  // --- YAML front-matter (optional) ---
  let fmEnd = -1
  if (lines.length > 0 && lines[0].trim() === '---') {
    for (let i = 2; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        fmEnd = i
        break
      }
    }
    if (fmEnd > 0) {
      fragments.push({
        kind: 'section',
        path: '0',
        order: 0,
        title: 'front-matter (metadata)',
        text: lines.slice(0, fmEnd + 1).join('\n'),
        startLine: 1,
        endLine: fmEnd + 1,
        meta: {},
      })
    }
  }
  const bodyStart = fmEnd > 0 ? fmEnd + 1 : 0

  // --- headings walk ---
  const headings: HeadingInfo[] = []
  let topCounter = 0
  let subCounter = 0
  let currentTop = ''
  for (let i = bodyStart; i < lines.length; i++) {
    const m = HEADING_RE.exec(lines[i])
    if (!m) continue
    const level = m[1].length
    let path: string
    if (level === 1) {
      path = 'T'
    } else if (level === 2) {
      topCounter++
      currentTop = String(topCounter)
      subCounter = 0
      path = currentTop
    } else {
      subCounter++
      path = currentTop ? `${currentTop}.${subCounter}` : `0.${subCounter}`
    }
    headings.push({ level, line: i, title: m[2].trim(), path, rangeEnd: lines.length - 1 })
  }
  for (let i = 0; i < headings.length; i++) {
    const end = headings[i].rangeEnd
    let rangeEnd = end
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= headings[i].level) {
        rangeEnd = headings[j].line - 1
        break
      }
    }
    headings[i].rangeEnd = rangeEnd
  }

  // --- deepest owning heading per line (for direct body extraction) ---
  const owner: (number | null)[] = new Array(lines.length).fill(null)
  const ownerLevel = new Array<number>(lines.length).fill(0)
  for (let h = 0; h < headings.length; h++) {
    const info = headings[h]
    for (let L = info.line; L <= info.rangeEnd && L < lines.length; L++) {
      if (ownerLevel[L] < info.level) {
        owner[L] = h
        ownerLevel[L] = info.level
      }
    }
  }

  const pushFragment = (f: Omit<ParsedFragment, 'order'>) => {
    fragments.push({ ...f, order: fragments.length })
  }

  // --- sections in document order, with their direct-body blocks ---
  for (let h = 0; h < headings.length; h++) {
    const info = headings[h]
    pushFragment({
      kind: 'section',
      path: info.path,
      title: info.title,
      text: lines.slice(info.line, info.rangeEnd + 1).join('\n'),
      startLine: info.line + 1,
      endLine: info.rangeEnd + 1,
      meta: {},
    })

    // contiguous runs of directly-owned body lines
    const runs: { from: number; to: number }[] = []
    let runStart = -1
    for (let L = info.line + 1; L <= info.rangeEnd && L < lines.length; L++) {
      if (owner[L] === h) {
        if (runStart < 0) runStart = L
      } else if (runStart >= 0) {
        runs.push({ from: runStart, to: L - 1 })
        runStart = -1
      }
    }
    if (runStart >= 0) runs.push({ from: runStart, to: Math.min(info.rangeEnd, lines.length - 1) })

    let blockIndex = 0
    const addSentences = (parent: ParsedFragment) => {
      const nlPositions: number[] = []
      for (let i = 0; i < parent.text.length; i++) {
        if (parent.text[i] === '\n') nlPositions.push(i)
      }
      const lineOf = (offset: number) =>
        parent.startLine + nlPositions.filter((p) => p < offset).length
      let sentenceIndex = 0
      for (const span of splitSentences(parent.text)) {
        sentenceIndex++
        pushFragment({
          kind: 'sentence',
          path: `${parent.path}.${sentenceIndex}`,
          title: null,
          text: span.text,
          startLine: lineOf(span.start),
          endLine: lineOf(Math.max(span.start, span.end - 1)),
          meta: { wordCount: wordCount(span.text) },
        })
      }
    }

    for (const run of runs) {
      // split the run into blocks on blank lines
      const blocks: RawBlock[] = []
      let current: RawBlock | null = null
      for (let L = run.from; L <= run.to; L++) {
        const lineText = lines[L]
        if (lineText.trim() === '') {
          current = null
          continue
        }
        if (!current) {
          current = { lines: [] }
          blocks.push(current)
        }
        current.lines.push({ idx: L, text: lineText })
      }

      for (const block of blocks) {
        blockIndex++
        const first = block.lines[0].text.trim()
        if (LIST_MARKER_RE.test(first)) {
          // list block: each marker line starts an item, other lines continue it
          const items: { from: number; to: number; lines: string[]; indent: number }[] = []
          let item: { from: number; to: number; lines: string[]; indent: number } | null = null
          for (const line of block.lines) {
            const lead = line.text.length - line.text.trimStart().length
            const s = line.text.trim()
            if (LIST_MARKER_RE.test(s)) {
              if (item) items.push(item)
              item = {
                from: line.idx,
                to: line.idx,
                lines: [s.replace(LIST_MARKER_RE, '')],
                indent: Math.floor(lead / 2),
              }
            } else if (item) {
              item.to = line.idx
              item.lines.push(s)
            }
          }
          if (item) items.push(item)
          items.forEach((it, i) => {
            const listItem: ParsedFragment = {
              kind: 'list_item',
              path: `${info.path}.${blockIndex}.${i + 1}`,
              order: 0,
              title: null,
              text: it.lines.join('\n').trim(),
              startLine: it.from + 1,
              endLine: it.to + 1,
              meta: { listIndex: i + 1, indent: it.indent, wordCount: wordCount(it.lines.join(' ')) },
            }
            pushFragment(listItem)
            addSentences(listItem)
          })
        } else {
          const paragraph: ParsedFragment = {
            kind: 'paragraph',
            path: `${info.path}.${blockIndex}`,
            order: 0,
            title: null,
            text: block.lines.map((l) => l.text.trimEnd()).join('\n').trim(),
            startLine: block.lines[0].idx + 1,
            endLine: block.lines[block.lines.length - 1].idx + 1,
            meta: { wordCount: wordCount(block.lines.map((l) => l.text).join(' ')) },
          }
          pushFragment(paragraph)
          addSentences(paragraph)
        }
      }
    }
  }

  fragments.forEach((f, i) => {
    f.order = i
  })
  return fragments
}

// Extract a semantic version like 0.1.4 from YAML front-matter (version: "x.y.z").
export function extractKnownVersion(content: string): string | null {
  const lines = content.split('\n')
  if (lines.length === 0 || lines[0].trim() !== '---') return null
  const end = lines.findIndex((l, i) => i >= 2 && l.trim() === '---')
  if (end < 0) return null
  const fm = lines.slice(1, end).join('\n')
  const m = /^\s*version:\s*["']?(\d+(?:\.\d+)+)["']?\s*$/m.exec(fm)
  return m ? m[1] : null
}

// Convenience: parse + map to Prisma create payloads for a version.
export function buildFragmentsForVersion(
  versionId: string,
  content: string
): {
  versionId: string
  kind: string
  path: string
  order: number
  title: string | null
  text: string
  startLine: number
  endLine: number
  meta: string
}[] {
  return parseDocument(content).map((f) => ({
    versionId,
    kind: f.kind,
    path: f.path,
    order: f.order,
    title: f.title,
    text: f.text,
    startLine: f.startLine,
    endLine: f.endLine,
    meta: JSON.stringify(f.meta),
  }))
}
