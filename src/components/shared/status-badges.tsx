// Honest-status badges: LIVE / LOCAL / DEMO / PLACEHOLDER / STALE / ERROR,
// execution statuses and verdicts. Color is never the only meaning carrier:
// every badge has a text label and a tooltip.
'use client'

import * as React from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import type { MetricProvenance, ProvenanceStatus, RunStatus, Verdict, VerdictBy } from '@/lib/types'
import { cn } from '@/lib/utils'

const PROVENANCE_META: Record<
  ProvenanceStatus,
  { label: string; hint: string; className: string }
> = {
  LIVE: {
    label: 'LIVE',
    hint: 'Реальное выполнение через подключённый сервис',
    className: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  LOCAL: {
    label: 'LOCAL',
    hint: 'Реальное локальное вычисление или проверка',
    className: 'border-teal-500/50 bg-teal-500/10 text-teal-600 dark:text-teal-300',
  },
  DEMO: {
    label: 'DEMO',
    hint: 'Синтетические данные для демонстрации интерфейса — не входят в реальные метрики',
    className: 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-300',
  },
  PLACEHOLDER: {
    label: 'PLACEHOLDER',
    hint: 'Функция не реализована',
    className: 'border-zinc-500/50 bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border-dashed',
  },
  STALE: {
    label: 'STALE',
    hint: 'Результат относится к предыдущей версии входных данных',
    className: 'border-orange-500/50 bg-orange-500/10 text-orange-600 dark:text-orange-300',
  },
  ERROR: {
    label: 'ERROR',
    hint: 'Выполнение завершилось ошибкой',
    className: 'border-rose-500/50 bg-rose-500/10 text-rose-600 dark:text-rose-400',
  },
}

export function StatusBadge({
  status,
  className,
  withHint = true,
}: {
  status: ProvenanceStatus
  className?: string
  withHint?: boolean
}) {
  const meta = PROVENANCE_META[status]
  const badge = (
    <Badge variant="outline" className={cn('font-mono text-[10px] tracking-wide', meta.className, className)}>
      {meta.label}
    </Badge>
  )
  if (!withHint) return badge
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-64 text-xs">
          {meta.hint}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

const RUN_STATUS_META: Record<RunStatus, { label: string; className: string; dot: string; pulse?: boolean }> = {
  planned: { label: 'Запланирован', className: 'text-zinc-500 border-zinc-500/40', dot: 'bg-zinc-400' },
  queued: { label: 'В очереди', className: 'text-zinc-500 border-zinc-500/40', dot: 'bg-zinc-400' },
  running: {
    label: 'Выполняется',
    className: 'text-teal-600 dark:text-teal-300 border-teal-500/50',
    dot: 'bg-teal-400',
    pulse: true,
  },
  completed: { label: 'Завершён', className: 'text-emerald-600 dark:text-emerald-400 border-emerald-500/50', dot: 'bg-emerald-400' },
  cancelled: { label: 'Отменён', className: 'text-zinc-500 border-zinc-500/40', dot: 'bg-zinc-400' },
  failed: { label: 'Ошибка', className: 'text-rose-600 dark:text-rose-400 border-rose-500/50', dot: 'bg-rose-400' },
}

export function RunStatusBadge({ status, compact = false }: { status: RunStatus; compact?: boolean }) {
  const meta = RUN_STATUS_META[status]
  return (
    <Badge variant="outline" className={cn('gap-1.5 text-xs', meta.className)}>
      <span className={cn('size-1.5 rounded-full', meta.dot, meta.pulse && 'pulse-dot')} />
      {!compact && meta.label}
    </Badge>
  )
}

const VERDICT_META: Record<Verdict, { label: string; className: string }> = {
  pass: { label: 'Пройдено', className: 'text-emerald-600 dark:text-emerald-400 border-emerald-500/50 bg-emerald-500/10' },
  fail: { label: 'Не пройдено', className: 'text-rose-600 dark:text-rose-400 border-rose-500/50 bg-rose-500/10' },
  inconclusive: { label: 'Неоднозначно', className: 'text-amber-600 dark:text-amber-300 border-amber-500/50 bg-amber-500/10' },
}

export function VerdictBadge({
  verdict,
  by,
  modelVerdict,
}: {
  verdict: Verdict | null
  by?: VerdictBy | null
  modelVerdict?: Verdict | null
}) {
  if (!verdict) {
    return (
      <Badge variant="outline" className="text-xs text-muted-foreground border-dashed">
        Вердикт не установлен
      </Badge>
    )
  }
  const meta = VERDICT_META[verdict]
  const byLabel = by === 'user' ? 'вердикт пользователя' : by === 'program' ? 'программная проверка' : 'вердикт модели'
  const override =
    by === 'user' && modelVerdict && modelVerdict !== verdict
      ? `исходный вердикт модели: ${VERDICT_META[modelVerdict].label.toLowerCase()}`
      : null
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn('text-xs', meta.className)}>
            {meta.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-72 text-xs">
          <p>{byLabel}</p>
          {override && <p className="mt-1 text-muted-foreground">{override}</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

const METRIC_PROVENANCE_META: Record<MetricProvenance, { label: string; className: string }> = {
  measured: { label: 'Измерено', className: 'border-teal-500/50 bg-teal-500/10 text-teal-600 dark:text-teal-300' },
  computed: { label: 'Вычислено', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  'model-evaluated': { label: 'Оценено моделью', className: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300' },
  goal: { label: 'Цель', className: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300' },
  synthetic: { label: 'Синтетическое', className: 'border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  'no-data': { label: 'Данных нет', className: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border-dashed' },
}

export function ProvenanceTag({ provenance }: { provenance: MetricProvenance }) {
  const meta = METRIC_PROVENANCE_META[provenance]
  return <Badge variant="outline" className={cn('text-xs', meta.className)}>{meta.label}</Badge>
}

export function DemoBadge() {
  return (
    <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-300 font-mono text-[10px]">
      DEMO
    </Badge>
  )
}

export function OriginBadge({ origin }: { origin: 'real' | 'demo' }) {
  if (origin === 'demo') return <DemoBadge />
  return null
}
