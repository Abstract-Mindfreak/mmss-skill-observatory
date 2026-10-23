// Fragment text rendering for the reading pane: marker words are subtly bolded,
// search substring is highlighted, the whole text may be wrapped in a LayerMark
// (underline of the strongest active layer), and in «Слова» zoom individual
// words become clickable (word inspector).

'use client'

import * as React from 'react'
import { LayerMark } from '@/components/shared/layers'
import type { LayerId } from '@/lib/types'
import { escapeRegExp } from './format'

interface Piece {
  text: string
  hit: boolean
}

function splitMarkers(text: string, markers: string[] | undefined): { text: string; marker: boolean }[] {
  const words = (markers ?? []).map((m) => m.trim()).filter(Boolean)
  if (words.length === 0) return [{ text, marker: false }]
  let re: RegExp
  try {
    re = new RegExp(`(?<![\\p{L}\\p{N}_])(${words.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`, 'giu')
  } catch {
    return [{ text, marker: false }]
  }
  const out: { text: string; marker: boolean }[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m[0].length === 0) {
      re.lastIndex++
      continue
    }
    if (m.index > last) out.push({ text: text.slice(last, m.index), marker: false })
    out.push({ text: m[0], marker: true })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), marker: false })
  return out
}

function splitQuery(text: string, query: string): Piece[] {
  if (!query) return [{ text, hit: false }]
  const lq = query.toLowerCase()
  const lower = text.toLowerCase()
  const out: Piece[] = []
  let last = 0
  let idx = lower.indexOf(lq)
  while (idx !== -1) {
    if (idx > last) out.push({ text: text.slice(last, idx), hit: false })
    out.push({ text: text.slice(idx, idx + query.length), hit: true })
    last = idx + query.length
    idx = lower.indexOf(lq, last)
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false })
  return out
}

interface RenderOpts {
  markers?: string[]
  query?: string
  wordMode?: boolean
  onWordClick?: (word: string, el: HTMLElement) => void
}

function buildNodes(text: string, opts: RenderOpts): React.ReactNode[] {
  const q = opts.query?.trim() ?? ''
  const out: React.ReactNode[] = []
  let key = 0
  for (const piece of splitMarkers(text, opts.markers)) {
    for (const seg of splitQuery(piece.text, q)) {
      if (seg.hit) {
        out.push(
          <mark key={key++} className="rounded-sm bg-amber-400/35 px-0.5 text-inherit dark:bg-amber-400/25">
            {seg.text}
          </mark>
        )
        continue
      }
      if (!opts.wordMode || !seg.text.trim()) {
        out.push(
          piece.marker ? (
            <strong key={key++} className="font-semibold">
              {seg.text}
            </strong>
          ) : (
            <React.Fragment key={key++}>{seg.text}</React.Fragment>
          )
        )
        continue
      }
      // word mode: every word token becomes a clickable span
      const parts = seg.text.split(/(\s+)/)
      for (const part of parts) {
        if (!part) continue
        if (/^\s+$/.test(part)) {
          out.push(<React.Fragment key={key++}>{part}</React.Fragment>)
          continue
        }
        const word = part.replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '')
        if (!word) {
          out.push(<React.Fragment key={key++}>{part}</React.Fragment>)
          continue
        }
        out.push(
          <span
            key={key++}
            role="button"
            tabIndex={0}
            className="cursor-pointer rounded-sm transition-colors hover:bg-primary/20"
            title="Слово — нажмите для инспектора"
            onClick={(e) => {
              e.stopPropagation()
              opts.onWordClick?.(word, e.currentTarget)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                opts.onWordClick?.(word, e.currentTarget)
              }
            }}
          >
            {part}
          </span>,
        )
      }
    }
  }
  return out
}

export function FragmentText({
  text,
  markers,
  query,
  layer,
  active,
  onClick,
  wordMode,
  onWordClick,
}: {
  text: string
  markers?: string[]
  query?: string
  layer?: LayerId
  active?: boolean
  onClick?: () => void
  wordMode?: boolean
  onWordClick?: (word: string, el: HTMLElement) => void
}) {
  const nodes = buildNodes(text, { markers, query, wordMode, onWordClick })
  if (layer) {
    return (
      <LayerMark layer={layer} active={active} onClick={onClick ? () => onClick() : undefined}>
        {nodes}
      </LayerMark>
    )
  }
  return <>{nodes}</>
}
