// Сравнение версий A/B: единый вид или две колонки, пословная подсветка изменений
// внутри пар «строка удалена + строка добавлена» (DiffOp.words на add-операции).
'use client'

import * as React from 'react'
import { ArrowLeftRight, CheckCircle2, Columns2, Rows3 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CopyButton } from '@/components/shared/copy'
import { ErrorState, InlineSpinner, LoadingState } from '@/components/shared/states'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api-client'
import type { DiffOp, DocumentDTO, DiffHunk, VersionDiffDTO, WordOp } from '@/lib/types'
import { cn } from '@/lib/utils'

export interface CompareOption {
  id: string
  label: string
  documentTitle: string
}

export function compareOptions(documents: DocumentDTO[]): CompareOption[] {
  return documents.flatMap((d) =>
    d.versions.map((v) => ({ id: v.id, label: v.label, documentTitle: d.title }))
  )
}

export function DiffPanel({
  documents,
  aId,
  bId,
  onAId,
  onBId,
  panelRef,
}: {
  documents: DocumentDTO[]
  aId: string | null
  bId: string | null
  onAId: (id: string | null) => void
  onBId: (id: string | null) => void
  panelRef: React.RefObject<HTMLDivElement | null>
}) {
  const options = React.useMemo(() => compareOptions(documents), [documents])
  const [mode, setMode] = React.useState<'unified' | 'split'>('unified')
  const [data, setData] = React.useState<VersionDiffDTO | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!aId || !bId || aId === bId) {
      setData(null)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    // Семантика бэкенда: GET /api/versions/{id}/diff?other={other} возвращает
    // aLabel = other, bLabel = id (path). Чтобы в UI «A → B» означало
    // «строки добавлены в B», передаём B как path-параметр, A как other.
    api
      .versionDiff(bId, aId)
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e) => {
        if (!cancelled) {
          setData(null)
          setError(e instanceof Error ? e.message : 'Не удалось загрузить сравнение')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [aId, bId])

  const labelOf = (id: string | null) => options.find((o) => o.id === id)?.label ?? '—'

  return (
    <Card ref={panelRef}>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          Сравнение версий
          {data && !data.identical && (
            <span className="flex items-center gap-2 font-mono text-xs font-normal">
              <span className="text-emerald-600 dark:text-emerald-400">+{data.addedLines}</span>
              <span className="text-rose-600 dark:text-rose-400">−{data.removedLines}</span>
              <span className="text-muted-foreground">строк</span>
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={aId ?? undefined} onValueChange={onAId}>
            <SelectTrigger size="sm" className="w-48" aria-label="Версия A">
              <SelectValue placeholder="Версия A" />
            </SelectTrigger>
            <SelectContent>
              {documents.map((d) => (
                <SelectGroup key={d.id}>
                  <SelectLabel className="max-w-56 truncate">{d.title}</SelectLabel>
                  {d.versions.map((v) => (
                    <SelectItem key={v.id} value={v.id} className="text-xs">
                      A: {v.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Поменять A и B"
            title="Поменять A и B"
            disabled={!aId || !bId}
            onClick={() => {
              onAId(bId)
              onBId(aId)
            }}
          >
            <ArrowLeftRight className="size-3.5" aria-hidden />
          </Button>
          <Select value={bId ?? undefined} onValueChange={onBId}>
            <SelectTrigger size="sm" className="w-48" aria-label="Версия B">
              <SelectValue placeholder="Версия B" />
            </SelectTrigger>
            <SelectContent>
              {documents.map((d) => (
                <SelectGroup key={d.id}>
                  <SelectLabel className="max-w-56 truncate">{d.title}</SelectLabel>
                  {d.versions.map((v) => (
                    <SelectItem key={v.id} value={v.id} className="text-xs" disabled={v.id === aId}>
                      B: {v.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="sm"
              variant={mode === 'unified' ? 'secondary' : 'ghost'}
              className="h-8 gap-1.5 px-2"
              onClick={() => setMode('unified')}
              aria-pressed={mode === 'unified'}
            >
              <Rows3 className="size-3.5" aria-hidden />
              Единый вид
            </Button>
            <Button
              size="sm"
              variant={mode === 'split' ? 'secondary' : 'ghost'}
              className="h-8 gap-1.5 px-2"
              onClick={() => setMode('split')}
              aria-pressed={mode === 'split'}
            >
              <Columns2 className="size-3.5" aria-hidden />
              Две колонки
            </Button>
            {data && (
              <CopyButton text={() => diffAsText(data)} label="Скопировать diff" size="sm" variant="ghost" />
            )}
          </div>
        </div>

        {!aId || !bId ? (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Выберите две версии — сравнение покажет изменённые строки и слова. Порядок: A → B
            (строки «добавлены» в B).
          </p>
        ) : aId === bId ? (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Выберите две разные версии.
          </p>
        ) : loading ? (
          <LoadingState label={`Сравнение «${labelOf(aId)}» и «${labelOf(bId)}»…`} />
        ) : error ? (
          <ErrorState error={error} title="Сравнение недоступно" />
        ) : data ? (
          data.identical ? (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4">
              <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
              <p className="text-sm">
                Версии идентичны (хэши совпадают):{' '}
                <span className="font-mono text-xs text-muted-foreground">{data.aHash.slice(0, 16)}…</span>
              </p>
              <Badge variant="outline" className="ml-auto font-mono text-[10px]">
                identical
              </Badge>
            </div>
          ) : (
            <DiffBody data={data} mode={mode} />
          )
        ) : null}
      </CardContent>
    </Card>
  )
}

// ---------- rendering ----------

function WordSpans({ words }: { words: WordOp[] }) {
  const out: React.ReactNode[] = []
  let prevText = ''
  words.forEach((w, i) => {
    // бэкенд токенизирует по пробелам и не хранит разделители:
    // восстанавливаем пробел между опами, если его нет ни в одном из них
    if (i > 0 && !/\s$/.test(prevText) && !/^\s/.test(w.text)) out.push(' ')
    if (w.type === 'equal')
      out.push(
        <span key={i} className="text-foreground/85">
          {w.text}
        </span>
      )
    else if (w.type === 'remove')
      out.push(
        <span key={i} className="text-rose-600 line-through decoration-rose-500/70 dark:text-rose-400">
          {w.text}
        </span>
      )
    else
      out.push(
        <span key={i} className="font-semibold text-emerald-600 dark:text-emerald-400">
          {w.text}
        </span>
      )
    prevText = w.text
  })
  return <>{out}</>
}

function DiffBody({ data, mode }: { data: VersionDiffDTO; mode: 'unified' | 'split' }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-muted/40 px-3 py-2 font-mono text-[11px]">
        <span>
          A: <span className="font-semibold">{data.aLabel}</span>{' '}
          <span className="text-muted-foreground">{data.aHash.slice(0, 10)}…</span>
        </span>
        <span className="text-muted-foreground">→</span>
        <span>
          B: <span className="font-semibold">{data.bLabel}</span>{' '}
          <span className="text-muted-foreground">{data.bHash.slice(0, 10)}…</span>
        </span>
        <span className="ml-auto text-muted-foreground">hunks: {data.hunks.length}</span>
      </div>
      <div className="scroll-observatory max-h-[32rem] overflow-auto rounded-md border">
        {mode === 'unified'
          ? data.hunks.map((h, i) => <UnifiedHunk key={i} hunk={h} index={i} total={data.hunks.length} />)
          : data.hunks.map((h, i) => <SplitHunk key={i} hunk={h} index={i} total={data.hunks.length} />)}
      </div>
    </div>
  )
}

function HunkHeader({ hunk, index, total, wide }: { hunk: DiffHunk; index: number; total: number; wide?: boolean }) {
  return (
    <div
      className={cn(
        'sticky top-0 z-10 flex items-center gap-3 border-b bg-muted/80 px-3 py-1.5 font-mono text-[11px] text-muted-foreground backdrop-blur',
        wide && 'grid-cols-2'
      )}
    >
      <span>
        @@ −{hunk.aStart},{hunk.aLines.length} +{hunk.bStart},{hunk.bLines.length} @@
      </span>
      <span className="ml-auto">фрагмент {index + 1}/{total}</span>
    </div>
  )
}

function UnifiedHunk({ hunk, index, total }: { hunk: DiffHunk; index: number; total: number }) {
  return (
    <div>
      <HunkHeader hunk={hunk} index={index} total={total} />
      <div className="font-mono text-xs leading-relaxed">
        {hunk.ops.map((op, i) => (
          <UnifiedRow key={i} op={op} />
        ))}
      </div>
    </div>
  )
}

function UnifiedRow({ op }: { op: DiffOp }) {
  const lineA = op.aLine !== undefined ? String(op.aLine) : ''
  const lineB = op.bLine !== undefined ? String(op.bLine) : ''
  const cls =
    op.type === 'remove'
      ? 'bg-rose-500/10'
      : op.type === 'add'
        ? 'bg-emerald-500/10'
        : ''
  const marker = op.type === 'remove' ? '−' : op.type === 'add' ? '+' : ' '
  const markerCls =
    op.type === 'remove' ? 'text-rose-500' : op.type === 'add' ? 'text-emerald-500' : 'text-muted-foreground'
  return (
    <div className={cn('grid grid-cols-[3rem_2.5rem_1.75rem_1fr] whitespace-pre-wrap break-all', cls)}>
      <span className="select-none px-2 text-right text-muted-foreground/70">{lineA}</span>
      <span className="select-none px-2 text-right text-muted-foreground/70">{lineB}</span>
      <span className={cn('select-none text-center font-semibold', markerCls)}>{marker}</span>
      <span className="pr-3">
        {op.type === 'add' && op.words && op.words.length > 0 ? (
          <WordSpans words={op.words} />
        ) : (
          op.text || '\u00A0'
        )}
      </span>
    </div>
  )
}

interface SplitRow {
  a?: { no: number; text: string }
  b?: { no: number; op: DiffOp }
}

/** Сборка строк «двух колонок» из последовательности операций. */
function buildSplitRows(ops: DiffOp[]): SplitRow[] {
  const rows: SplitRow[] = []
  const pending: { no: number; text: string }[] = []
  const flush = () => {
    for (const p of pending) rows.push({ a: p })
    pending.length = 0
  }
  for (const op of ops) {
    if (op.type === 'equal') {
      flush()
      rows.push({
        a: { no: op.aLine ?? 0, text: op.text },
        b: { no: op.bLine ?? 0, op },
      })
    } else if (op.type === 'remove') {
      pending.push({ no: op.aLine ?? 0, text: op.text })
    } else {
      rows.push({
        a: pending.shift(),
        b: { no: op.bLine ?? 0, op },
      })
    }
  }
  flush()
  return rows
}

function SplitHunk({ hunk, index, total }: { hunk: DiffHunk; index: number; total: number }) {
  const rows = React.useMemo(() => buildSplitRows(hunk.ops), [hunk.ops])
  return (
    <div>
      <HunkHeader hunk={hunk} index={index} total={total} />
      <div className="font-mono text-xs leading-relaxed">
        {rows.map((row, i) => {
          const aCellRose = row.a !== undefined && row.b?.op.type !== 'equal'
          const bCellGreen = row.b?.op.type === 'add'
          const bWords = row.b?.op.type === 'add' && row.b.op.words && row.b.op.words.length > 0
          return (
            <div key={i} className="grid grid-cols-[2.5rem_1fr_2.5rem_1fr] whitespace-pre-wrap break-all">
              <span className="select-none border-r bg-muted/20 px-1.5 text-right text-muted-foreground/70">
                {row.a?.no ?? ''}
              </span>
              <span className={cn('px-2', aCellRose && 'bg-rose-500/10')}>{row.a?.text ?? ''}</span>
              <span className="select-none border-r border-l bg-muted/20 px-1.5 text-right text-muted-foreground/70">
                {row.b?.no ?? ''}
              </span>
              <span className={cn('px-2', bCellGreen && 'bg-emerald-500/10')}>
                {row.b ? (
                  bWords ? (
                    // изменённая пара: слова старая → новая в одной ячейке колонки B
                    <WordSpans words={row.b.op.words!} />
                  ) : (
                    row.b.op.text || '\u00A0'
                  )
                ) : (
                  '\u00A0'
                )}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------- diff as text (unified, для копирования) ----------

export function diffAsText(d: VersionDiffDTO): string {
  if (d.identical) {
    return `Версии идентичны (хэши совпадают): ${d.aHash}`
  }
  const lines: string[] = [
    `diff --git a/${d.aLabel} b/${d.bLabel}`,
    `--- a/${d.aLabel} (${d.aHash.slice(0, 12)}…)`,
    `+++ b/${d.bLabel} (${d.bHash.slice(0, 12)}…)`,
    `# +${d.addedLines}/−${d.removedLines} строк`,
  ]
  for (const h of d.hunks) {
    lines.push(`@@ -${h.aStart},${h.aLines.length} +${h.bStart},${h.bLines.length} @@`)
    for (const op of h.ops) {
      const prefix = op.type === 'remove' ? '-' : op.type === 'add' ? '+' : ' '
      lines.push(prefix + op.text)
    }
  }
  return lines.join('\n')
}
