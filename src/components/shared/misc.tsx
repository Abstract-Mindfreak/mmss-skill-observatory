// Misc shared primitives: SectionHeader, FragmentRef, KV, JsonView, MarkdownView.
'use client'

import * as React from 'react'
import { FileText, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStore } from '@/lib/store'
import type { FragmentDTO } from '@/lib/types'
import { cn } from '@/lib/utils'

export function SectionHeader({
  title,
  description,
  actions,
  badges,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  badges?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-3 border-b pb-4 md:flex-row md:items-end md:justify-between', className)}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight md:text-xl">{title}</h1>
          {badges}
        </div>
        {description && <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Reference to a document fragment: navigates to the Atlas on click. */
export function FragmentRef({
  fragment,
  text,
  className,
  showText = true,
}: {
  fragment?: Pick<FragmentDTO, 'id' | 'path' | 'text' | 'title'> | null
  text?: string | null
  className?: string
  showText?: boolean
}) {
  const goToFragment = useStore((s) => s.goToFragment)
  if (!fragment) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}>
        <FileText className="size-3" aria-hidden />
        фрагмент не указан
      </span>
    )
  }
  const snippet = text ?? fragment.title ?? fragment.text
  return (
    <button
      type="button"
      onClick={() => goToFragment(fragment.id)}
      className={cn(
        'group inline-flex max-w-full items-center gap-1.5 rounded border border-transparent bg-muted/40 px-1.5 py-0.5 text-left text-xs transition-colors hover:border-primary/40 hover:bg-primary/10',
        className
      )}
      title={`Открыть в атласе — путь ${fragment.path}`}
    >
      <FileText className="size-3 shrink-0 text-primary/70" aria-hidden />
      <span className="font-mono text-[10px] text-muted-foreground">{fragment.path}</span>
      {showText && (
        <span className="truncate">{snippet.length > 90 ? snippet.slice(0, 90) + '…' : snippet}</span>
      )}
      <ExternalLink className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
    </button>
  )
}

export function KV({ k, v, mono }: { k: React.ReactNode; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className={cn('min-w-0 break-words text-right', mono && 'font-mono text-xs')}>{v}</span>
    </div>
  )
}

export function JsonView({
  data,
  maxHeight = '24rem',
  className,
}: {
  data: unknown
  maxHeight?: string
  className?: string
}) {
  const text = React.useMemo(
    () => (typeof data === 'string' ? data : JSON.stringify(data, null, 2)),
    [data]
  )
  return (
    <pre
      className={cn(
        'scroll-observatory overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed',
        className
      )}
      style={{ maxHeight }}
    >
      {text}
    </pre>
  )
}

/** Minimal markdown rendering with observatory typography (no external CSS needed). */
export function MarkdownView({ text, className }: { text: string; className?: string }) {
  const blocks = React.useMemo(() => renderMarkdown(text), [text])
  return <div className={cn('space-y-2 text-sm leading-relaxed', className)}>{blocks}</div>
}

// Tiny, safe markdown renderer (headings, lists, bold/italic/code, tables, hr).
function renderMarkdown(src: string): React.ReactNode[] {
  const lines = src.split('\n')
  const out: React.ReactNode[] = []
  let i = 0
  let key = 0
  const inline = (s: string): React.ReactNode => {
    const parts: React.ReactNode[] = []
    const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(s))) {
      if (m.index > last) parts.push(s.slice(last, m.index))
      const tok = m[0]
      if (tok.startsWith('**')) parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>)
      else if (tok.startsWith('`'))
        parts.push(
          <code key={key++} className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            {tok.slice(1, -1)}
          </code>
        )
      else parts.push(<em key={key++}>{tok.slice(1, -1)}</em>)
      last = m.index + tok.length
    }
    if (last < s.length) parts.push(s.slice(last))
    return parts
  }
  while (i < lines.length) {
    const line = lines[i]
    if (/^#{1,4}\s/.test(line)) {
      const level = line.match(/^#+/)![0].length
      const cls =
        level <= 2 ? 'text-base font-semibold' : level === 3 ? 'text-sm font-semibold' : 'text-sm font-medium'
      out.push(
        <p key={key++} className={cn(cls, 'pt-1')}>
          {inline(line.replace(/^#+\s/, ''))}
        </p>
      )
      i++
    } else if (/^\s*[-*]\s/.test(line) || /^\s*\d+\.\s/.test(line)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && (/^\s*[-*]\s/.test(lines[i]) || /^\s*\d+\.\s/.test(lines[i]))) {
        items.push(<li key={key++} className="ml-4 list-disc">{inline(lines[i].replace(/^\s*(?:[-*]|\d+\.)\s/, ''))}</li>)
        i++
      }
      out.push(
        <ul key={key++} className="space-y-1">
          {items}
        </ul>
      )
    } else if (/^\|.*\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1])) {
      const header = lines[i].split('|').slice(1, -1).map((c) => c.trim())
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /^\|.*\|/.test(lines[i])) {
        rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()))
        i++
      }
      out.push(
        <div key={key++} className="scroll-observatory overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                {header.map((h, hi) => (
                  <th key={hi} className="px-2 py-1.5 text-left font-medium">
                    {inline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-t">
                  {r.map((c, ci) => (
                    <td key={ci} className="px-2 py-1.5 align-top">
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    } else if (/^\s*(---|___)\s*$/.test(line)) {
      out.push(<hr key={key++} className="border-border" />)
      i++
    } else if (line.trim() === '') {
      i++
    } else {
      out.push(
        <p key={key++} className="text-muted-foreground">
          {inline(line)}
        </p>
      )
      i++
    }
  }
  return out
}

/** Button that opens a fragment in the atlas (used across studios). */
export function OpenInAtlasButton({ fragmentId, label = 'Открыть в атласе' }: { fragmentId: string; label?: string }) {
  const goToFragment = useStore((s) => s.goToFragment)
  return (
    <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => goToFragment(fragmentId)}>
      <ExternalLink className="size-3.5" aria-hidden />
      {label}
    </Button>
  )
}
