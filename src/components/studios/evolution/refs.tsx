// Ссылка на фрагмент по id: если фрагмент есть в состоянии приложения — полноценная
// FragmentRef; иначе честная кнопка с id (карточка подгрузится в атласе по клику).
'use client'

import * as React from 'react'
import { FileText, ExternalLink } from 'lucide-react'
import { FragmentRef } from '@/components/shared/misc'
import { useStore } from '@/lib/store'
import type { FragmentDTO } from '@/lib/types'

export function FragmentRefById({
  fragmentId,
  text,
  className,
}: {
  fragmentId: string
  text?: string | null
  className?: string
}) {
  const fragment = useStore((s) => s.appState?.fragments.find((f) => f.id === fragmentId) ?? null)
  const goToFragment = useStore((s) => s.goToFragment)

  if (fragment) {
    return <FragmentRef fragment={fragment as Pick<FragmentDTO, 'id' | 'path' | 'text' | 'title'>} text={text ?? undefined} className={className} />
  }
  // Фрагмент принадлежит другой версии (не активной) — по id открываем атлас напрямую.
  return (
    <button
      type="button"
      onClick={() => goToFragment(fragmentId)}
      title={`Открыть в атласе — ${fragmentId}`}
      className={
        'group inline-flex max-w-full items-center gap-1.5 rounded border border-transparent bg-muted/40 px-1.5 py-0.5 text-left text-xs transition-colors hover:border-primary/40 hover:bg-primary/10 ' +
        (className ?? '')
      }
    >
      <FileText className="size-3 shrink-0 text-primary/70" aria-hidden />
      <span className="font-mono text-[10px] text-muted-foreground">{fragmentId.slice(0, 14)}…</span>
      {text && <span className="truncate">{text.length > 80 ? text.slice(0, 80) + '…' : text}</span>}
      <ExternalLink className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
    </button>
  )
}
