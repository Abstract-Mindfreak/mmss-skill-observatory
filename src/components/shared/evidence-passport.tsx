// Evidence Passport: traceable chain for every substantial conclusion
// (fragment → criterion → scenario → run input → executor answer → evaluator
// conclusion → objections → status). Short and detailed modes.
'use client'

import * as React from 'react'
import {
  Bot,
  ChevronDown,
  ClipboardCheck,
  FileText,
  GitBranch,
  HelpCircle,
  LogIn,
  MessageSquareWarning,
  Ruler,
  StickyNote,
  Terminal,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { EvidenceChain, EvidenceStep } from '@/lib/types'
import { cn } from '@/lib/utils'

const STEP_META: Record<EvidenceStep['kind'], { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  fragment: { label: 'Фрагмент инструкции', icon: FileText },
  criterion: { label: 'Критерий', icon: Ruler },
  scenario: { label: 'Сценарий', icon: GitBranch },
  'run-input': { label: 'Вход запуска', icon: LogIn },
  'executor-output': { label: 'Ответ исполнителя', icon: Bot },
  'evaluator-conclusion': { label: 'Заключение проверяющего', icon: ClipboardCheck },
  objection: { label: 'Возражение', icon: MessageSquareWarning },
  note: { label: 'Заметка', icon: StickyNote },
  assumption: { label: 'Допущение', icon: HelpCircle },
  'program-check': { label: 'Программная проверка', icon: Terminal },
}

const DISTINCTION_LABELS: Record<EvidenceChain['distinction'], string> = {
  observation: 'Наблюдение',
  inference: 'Вывод',
  assumption: 'Допущение',
  'new-requirement': 'Новое требование',
  'model-evaluation': 'Модельная оценка',
  'executed-check': 'Выполненная проверка',
  'unverified-hypothesis': 'Непроверенная гипотеза',
}

export function EvidencePassport({
  evidence,
  defaultOpen = false,
  className,
}: {
  evidence: EvidenceChain
  defaultOpen?: boolean
  className?: string
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <div className={cn('rounded-lg border bg-card/60', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Паспорт вывода</span>
          <Badge variant="outline" className="text-[10px]">
            {DISTINCTION_LABELS[evidence.distinction]}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {evidence.gaps.length > 0 && (
            <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-300">
              <TriangleAlert className="mr-1 size-3" aria-hidden />
              пропуски: {evidence.gaps.length}
            </Badge>
          )}
          <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? 'Скрыть' : 'Подробно'}
            <ChevronDown className={cn('ml-1 size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
          </Button>
        </div>
      </div>
      <ol className={cn('space-y-0 px-3 pb-3', open ? 'block' : 'hidden')}>
        {evidence.steps.map((step, i) => {
          const meta = STEP_META[step.kind]
          const Icon = meta.icon
          return (
            <li key={i} className="relative flex gap-3 pb-3 last:pb-0">
              {i < evidence.steps.length - 1 && (
                <span className="absolute left-[11px] top-6 h-full w-px bg-border" aria-hidden />
              )}
              <span
                className={cn(
                  'z-10 flex size-6 shrink-0 items-center justify-center rounded-full border',
                  step.status === 'present' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                  step.status === 'partial' && 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300',
                  step.status === 'missing' && 'border-dashed border-zinc-500/40 bg-zinc-500/5 text-zinc-400'
                )}
              >
                <Icon className="size-3" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium">
                  {meta.label}
                  {step.status === 'missing' && <span className="ml-2 text-[10px] text-zinc-400">— отсутствует</span>}
                  {step.status === 'partial' && <span className="ml-2 text-[10px] text-amber-500">— частично</span>}
                </p>
                <p className="mt-0.5 break-words text-xs text-muted-foreground">{step.detail || step.label}</p>
              </div>
            </li>
          )
        })}
        {evidence.gaps.length > 0 && (
          <li className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
            <p className="text-xs font-medium text-amber-600 dark:text-amber-300">Где цепочка неполна</p>
            <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
              {evidence.gaps.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </li>
        )}
      </ol>
    </div>
  )
}
