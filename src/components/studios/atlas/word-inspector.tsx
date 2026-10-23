// Word inspector (zoom «Слова»): a small fixed panel near the clicked word with
// the word, its occurrence count in the document (LOCAL computation), up to 5
// sentence contexts (FragmentRef) and a marker-word note (ТЗ п.4).

'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FragmentRef } from '@/components/shared/misc'
import { StatusBadge } from '@/components/shared/status-badges'
import { MARKER_WORDS } from './layer-index'
import { pluralRu, escapeRegExp } from './format'
import { useAtlas } from './context'
import type { DocStructure } from './doc-structure'
import type { FragmentDTO } from '@/lib/types'

export interface WordInfo {
  count: number
  sentences: FragmentDTO[]
  isMarker: boolean
}

export function computeWordInfo(structure: DocStructure, rawWord: string): WordInfo {
  const word = rawWord.toLowerCase()
  let re: RegExp
  try {
    re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(word)}(?![\\p{L}\\p{N}_])`, 'giu')
  } catch {
    return { count: 0, sentences: [], isMarker: false }
  }
  let count = 0
  const sentences: FragmentDTO[] = []
  const extras: FragmentDTO[] = []
  for (const f of structure.all) {
    const m = f.text.match(re)
    if (!m) continue
    count += m.length
    if (f.kind === 'sentence') {
      if (sentences.length < 5) sentences.push(f)
    } else if ((f.kind === 'list_item' || f.kind === 'paragraph') && extras.length < 5) {
      extras.push(f)
    }
  }
  while (sentences.length < 5 && extras.length > 0) {
    sentences.push(extras.shift()!)
  }
  return { count, sentences, isMarker: MARKER_WORDS.includes(word) }
}

export function WordInspector() {
  const { wordInspect, setWordInspect } = useAtlas()
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!wordInspect) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setWordInspect(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWordInspect(null)
    }
    const onScroll = () => setWordInspect(null)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [wordInspect, setWordInspect])

  if (!wordInspect) return null

  const width = 320
  const left = Math.max(8, Math.min(wordInspect.x, window.innerWidth - width - 8))
  const top = Math.max(8, Math.min(wordInspect.y + 8, window.innerHeight - 260))

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Инспектор слова: ${wordInspect.word}`}
      className="fixed z-50 w-80 rounded-lg border bg-popover p-3 shadow-xl"
      style={{ left, top: Math.min(top, window.innerHeight - 120) }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-all font-mono text-sm font-semibold">{wordInspect.word}</p>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0"
          onClick={() => setWordInspect(null)}
          aria-label="Закрыть инспектор слова"
        >
          <X className="size-3.5" aria-hidden />
        </Button>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span>
          {wordInspect.count} {pluralRu(wordInspect.count, 'вхождение', 'вхождения', 'вхождений')} в тексте
          версии
        </span>
        <StatusBadge status="LOCAL" withHint={false} />
        <span className="text-[10px]">локальный подсчёт</span>
      </p>
      {wordInspect.sentences.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Встречается в фрагментах
          </p>
          <div className="scroll-observatory max-h-40 space-y-1 overflow-y-auto pr-1">
            {wordInspect.sentences.map((f) => (
              <FragmentRef key={f.id} fragment={f} />
            ))}
          </div>
        </div>
      )}
      {wordInspect.isMarker && (
        <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] leading-relaxed text-amber-600 dark:text-amber-300">
          Слово входит в список маркеров модальности и неопределённости (must, should, may, always, only…).
          Само по себе оно не опасно — значение зависит от контекста (ТЗ п.4).
        </p>
      )}
    </div>
  )
}
