// Self-contained line-based LCS diff with unified-style hunks (3 context lines)
// and word-level detail for single-line replacements.

import type { DiffHunk, DiffOp, WordOp } from '@/lib/types'

export interface DiffResult {
  hunks: DiffHunk[]
  addedLines: number
  removedLines: number
}

const CONTEXT = 3
const MAX_DP_LINES = 6000

interface LineOp {
  type: 'equal' | 'remove' | 'add'
  aLine?: number
  bLine?: number
  text: string
  words?: WordOp[]
}

function lcsOps(a: string[], b: string[]): LineOp[] {
  // trim common prefix/suffix to keep the DP table small
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)

  const ops: LineOp[] = []
  for (let i = 0; i < start; i++) {
    ops.push({ type: 'equal', aLine: i + 1, bLine: i + 1, text: a[i] })
  }

  if (midA.length > MAX_DP_LINES || midB.length > MAX_DP_LINES) {
    // honest fallback: wholesale replacement of the middle part
    for (let i = 0; i < midA.length; i++) {
      ops.push({ type: 'remove', aLine: start + i + 1, text: midA[i] })
    }
    for (let j = 0; j < midB.length; j++) {
      ops.push({ type: 'add', bLine: start + j + 1, text: midB[j] })
    }
  } else {
    const n = midA.length
    const m = midB.length
    // dp[i][j] = LCS length of midA[i..], midB[j..]
    const dp = new Int32Array((n + 1) * (m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * (m + 1) + j] =
          midA[i] === midB[j]
            ? dp[(i + 1) * (m + 1) + (j + 1)] + 1
            : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + (j + 1)])
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        ops.push({ type: 'equal', aLine: start + i + 1, bLine: start + j + 1, text: midA[i] })
        i++
        j++
      } else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + (j + 1)]) {
        ops.push({ type: 'remove', aLine: start + i + 1, text: midA[i] })
        i++
      } else {
        ops.push({ type: 'add', bLine: start + j + 1, text: midB[j] })
        j++
      }
    }
    while (i < n) {
      ops.push({ type: 'remove', aLine: start + i + 1, text: midA[i] })
      i++
    }
    while (j < m) {
      ops.push({ type: 'add', bLine: start + j + 1, text: midB[j] })
      j++
    }
  }

  for (let k = 0; k < a.length - endA; k++) {
    ops.push({
      type: 'equal',
      aLine: endA + k + 1,
      bLine: endB + k + 1,
      text: a[endA + k],
    })
  }
  return ops
}

function wordDiff(oldLine: string, newLine: string): WordOp[] {
  const a = oldLine.split(/\s+/).filter(Boolean)
  const b = newLine.split(/\s+/).filter(Boolean)
  const n = a.length
  const m = b.length
  const dp = new Int32Array((n + 1) * (m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * (m + 1) + j] =
        a[i] === b[j]
          ? dp[(i + 1) * (m + 1) + (j + 1)] + 1
          : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + (j + 1)])
    }
  }
  const raw: WordOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ type: 'equal', text: a[i] })
      i++
      j++
    } else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + (j + 1)]) {
      raw.push({ type: 'remove', text: a[i] })
      i++
    } else {
      raw.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) {
    raw.push({ type: 'remove', text: a[i] })
    i++
  }
  while (j < m) {
    raw.push({ type: 'add', text: b[j] })
    j++
  }
  const merged: WordOp[] = []
  for (const op of raw) {
    const last = merged[merged.length - 1]
    if (last && last.type === op.type) {
      last.text += ' ' + op.text
    } else {
      merged.push({ ...op })
    }
  }
  return merged
}

export function diffVersions(aContent: string, bContent: string): DiffResult {
  const a = aContent.split('\n')
  const b = bContent.split('\n')
  const ops = lcsOps(a, b)

  let addedLines = 0
  let removedLines = 0
  for (const op of ops) {
    if (op.type === 'add') addedLines++
    if (op.type === 'remove') removedLines++
  }

  // word-level detail for single-line replacements (remove immediately followed by add)
  for (let i = 0; i < ops.length - 1; i++) {
    if (ops[i].type === 'remove' && ops[i + 1].type === 'add') {
      const words = wordDiff(ops[i].text, ops[i + 1].text)
      if (words.some((w) => w.type !== 'equal')) {
        ops[i + 1].words = words
      }
    }
  }

  // group changes into merged regions, then build hunks with context
  const changeRegions: { from: number; to: number }[] = []
  let regionStart = -1
  for (let i = 0; i < ops.length; i++) {
    const changed = ops[i].type !== 'equal'
    if (changed && regionStart < 0) regionStart = i
    if (!changed && regionStart >= 0) {
      changeRegions.push({ from: regionStart, to: i - 1 })
      regionStart = -1
    }
  }
  if (regionStart >= 0) changeRegions.push({ from: regionStart, to: ops.length - 1 })

  const merged: { from: number; to: number }[] = []
  for (const region of changeRegions) {
    const last = merged[merged.length - 1]
    if (last && region.from - last.to - 1 <= 2 * CONTEXT) {
      last.to = region.to
    } else {
      merged.push({ ...region })
    }
  }

  const hunks: DiffHunk[] = []
  for (const region of merged) {
    const from = Math.max(0, region.from - CONTEXT)
    const to = Math.min(ops.length - 1, region.to + CONTEXT)
    const hunkOps: DiffOp[] = []
    const aLines: string[] = []
    const bLines: string[] = []
    let aStart: number | null = null
    let bStart: number | null = null
    for (let i = from; i <= to; i++) {
      const op = ops[i]
      if (op.type === 'equal') {
        aLines.push(op.text)
        bLines.push(op.text)
        if (aStart === null && op.aLine !== undefined) aStart = op.aLine
        if (bStart === null && op.bLine !== undefined) bStart = op.bLine
      } else if (op.type === 'remove') {
        aLines.push(op.text)
        if (aStart === null && op.aLine !== undefined) aStart = op.aLine
      } else {
        bLines.push(op.text)
        if (bStart === null && op.bLine !== undefined) bStart = op.bLine
      }
      hunkOps.push({ ...op })
    }
    hunks.push({
      aStart: aStart ?? 0,
      aLines,
      bStart: bStart ?? 0,
      bLines,
      ops: hunkOps,
    })
  }

  return { hunks, addedLines, removedLines }
}
