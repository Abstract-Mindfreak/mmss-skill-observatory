// Failure Roads: stage card, road connector, fork card, pit card.
// Pits are «potential failures (hypotheses)» until runs say otherwise —
// the label is repeated in text, color is never the only carrier.

'use client'

import * as React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FlaskConical,
  GitBranch,
  XOctagon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { FragmentRef } from '@/components/shared/misc'
import { StatusBadge } from '@/components/shared/status-badges'
import { CopyButton } from '@/components/shared/copy'
import type { FragmentDTO, RunDTO } from '@/lib/types'
import { ROLE_TITLES } from '@/lib/types'
import type { ForkDef, StageDef } from './roads-map'
import type { Pit } from './roads-pits'
import { cn } from '@/lib/utils'

export type SectionResolver = (path: string) => FragmentDTO | null

// ---------- stage card ----------

export function StageCard({
  stage,
  refs,
  observationCount,
  observedRuns,
  pitCount,
  children,
  className,
}: {
  stage: StageDef
  refs: React.ReactNode
  observationCount: number
  observedRuns: RunDTO[]
  pitCount: number
  children?: React.ReactNode
  className?: string
}) {
  return (
    <section
      aria-label={`Стадия ${stage.id}: ${stage.title}`}
      className={cn('flex w-full shrink-0 flex-col gap-2 md:w-[318px]', className)}
    >
      <div className="relative rounded-lg border bg-card p-3 shadow-sm">
        <div className="flex items-start gap-2">
          <span className="glow-teal flex size-7 shrink-0 items-center justify-center rounded-full border bg-primary/10 font-mono text-sm font-semibold text-primary">
            {stage.id}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold leading-tight">{stage.title}</h3>
            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">предполагаемый маршрут</p>
          </div>
          {observationCount > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="flex items-center gap-1.5 rounded-full border border-teal-500/50 bg-teal-500/10 px-2 py-0.5 text-[11px] text-teal-700 dark:text-teal-300">
                    <span className="pulse-dot size-1.5 rounded-full bg-teal-400" aria-hidden />
                    наблюдений: {observationCount}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-72 text-xs">
                  <p className="font-medium">Фактически наблюдавшиеся запуски (real)</p>
                  <ul className="mt-1 space-y-0.5">
                    {observedRuns.map((r) => (
                      <li key={r.id} className="text-muted-foreground">
                        {ROLE_TITLES[r.role]} · {r.status}
                        {r.verdict ? ` · ${r.verdict}` : ''} · {r.backend}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 border-t pt-1.5 text-[10px] text-muted-foreground">
                    Наблюдаемый результат привязан к разделу сценария; внутренний маршрут модели не наблюдается.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">{refs}</div>
        <p className="mt-2 text-xs leading-relaxed text-foreground/85">{stage.requirement}</p>
        <p className="mt-2 rounded border-l-2 border-primary/40 bg-muted/40 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground/80">выход:</span> {stage.exit}
        </p>
      </div>
      {pitCount > 0 && <p className="pl-1 text-[10px] text-muted-foreground">↳ ям под стадией: {pitCount}</p>}
      {children}
    </section>
  )
}

// ---------- connector between stages ----------

export function RoadConnector({ withFork = false }: { withFork?: boolean }) {
  if (withFork) return null
  return (
    <div aria-hidden className="flex shrink-0 items-center justify-center md:w-10 md:self-center">
      <span className="hidden h-px w-full bg-primary/35 md:block" />
      <span className="mx-auto block h-6 w-px bg-primary/35 md:hidden" />
    </div>
  )
}

// ---------- fork card ----------

export function ForkCard({
  fork,
  onFollowPit,
  className,
}: {
  fork: ForkDef
  onFollowPit: (pitId: string) => void
  className?: string
}) {
  return (
    <aside
      aria-label={`Развилка после стадии ${fork.afterStage}: ${fork.condition}`}
      className={cn(
        'w-full shrink-0 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/5 p-3 md:w-[268px] md:self-center',
        className
      )}
    >
      <div className="flex items-center gap-2">
        <GitBranch className="size-4 text-fuchsia-500" aria-hidden />
        <p className="text-xs font-semibold">Развилка · стадия {fork.afterStage} → {fork.afterStage + 1}</p>
      </div>
      <p className="mt-1 text-xs font-medium text-foreground/90">если «{fork.condition}»</p>
      <ul className="mt-2 space-y-1.5">
        {fork.branches.map((b, i) => (
          <li key={i}>
            {b.kind === 'ok' ? (
              <div className="flex items-start gap-1.5 rounded border border-emerald-500/25 bg-emerald-500/5 px-2 py-1.5">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" aria-hidden />
                <div className="min-w-0">
                  <p className="text-[11px] font-medium leading-tight text-foreground/90">{b.label}</p>
                  {b.detail && <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{b.detail}</p>}
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => b.pitId && onFollowPit(b.pitId)}
                className="flex w-full items-start gap-1.5 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1.5 text-left transition-colors hover:border-rose-500/70"
              >
                <XOctagon className="mt-0.5 size-3.5 shrink-0 text-rose-500" aria-hidden />
                <div className="min-w-0">
                  <p className="text-[11px] font-medium leading-tight text-rose-600 dark:text-rose-400">{b.label}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">нажмите, чтобы раскрыть яму</p>
                </div>
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 border-t pt-1.5 text-[10px] leading-relaxed text-muted-foreground">Основание: {fork.basis}</p>
    </aside>
  )
}

// ---------- pit card ----------

export function PitCard({
  pit,
  open,
  onToggle,
  resolveSection,
  relatedRuns,
  onVerify,
  onOpenFragment,
  pitRef,
}: {
  pit: Pit
  open: boolean
  onToggle: () => void
  resolveSection: SectionResolver
  relatedRuns: RunDTO[]
  onVerify: () => void
  onOpenFragment: (fragmentId: string) => void
  pitRef?: React.Ref<HTMLDivElement>
}) {
  const section = resolveSection(pit.ruleRef.sectionPath)
  const hasRuns = relatedRuns.length > 0

  return (
    <div ref={pitRef} className="relative">
      <span aria-hidden className="absolute -left-3.5 top-4 h-px w-3.5 bg-amber-500/50" />
      <div
        className={cn(
          'rounded-lg border p-3 transition-colors',
          open ? 'border-amber-500/60 bg-amber-500/5' : 'border-amber-500/30 bg-card hover:border-amber-500/50'
        )}
      >
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-2 text-left">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-[9px] text-amber-600 dark:text-amber-300">
                яма
              </Badge>
              <span className="text-xs font-semibold">{pit.title}</span>
            </span>
            <span className="mt-1 block text-[10px] text-muted-foreground">
              потенциальный отказ (гипотеза) · стадия {pit.stage}
              {pit.relatedStages?.length ? `, затрагивает ${pit.relatedStages.join(', ')}` : ''}
            </span>
          </span>
          <ChevronDown className={cn('mt-1 size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
        </button>

        {open && (
          <div className="mt-3 space-y-3 border-t pt-3">
            <Field label="Условие возникновения" text={pit.condition} />
            <Field label="Нарушаемое свойство" text={pit.violatedProperty} />
            <Field label="Последствие" text={pit.consequence} />

            <div className="space-y-1">
              <FieldLabel>Минимальный пример</FieldLabel>
              <p className="rounded-md border-l-2 border-amber-500/40 bg-muted/40 p-2 text-xs leading-relaxed text-foreground/90">
                {pit.minimalExample}
              </p>
            </div>

            <div className="space-y-1.5">
              <FieldLabel>Привязка к тексту скилла</FieldLabel>
              <div className="rounded-md border bg-muted/30 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground">§{pit.ruleRef.sectionPath}</span>
                  {section ? (
                    <button
                      type="button"
                      onClick={() => onOpenFragment(section.id)}
                      className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                    >
                      {section.title?.replace(/^\s*[\d.]+\s*/, '')}
                      <ExternalLink className="size-3" aria-hidden />
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground">раздел не найден во фрагментах</span>
                  )}
                </div>
                <blockquote className="mt-1.5 border-l-2 border-primary/40 pl-2 font-mono text-[11px] leading-relaxed text-foreground/85">
                  “{pit.ruleRef.quote}”
                </blockquote>
              </div>
              {pit.extraRefs?.map((r, i) => {
                const extraSection = resolveSection(r.sectionPath)
                return (
                  <div key={i} className="rounded-md border bg-muted/20 p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground">§{r.sectionPath}</span>
                      {extraSection && (
                        <FragmentRef fragment={extraSection} showText={false} />
                      )}
                    </div>
                    <blockquote className="mt-1 border-l-2 border-border pl-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                      “{r.quote}”
                    </blockquote>
                  </div>
                )
              })}
            </div>

            <Field label="Допущение" text={pit.extraAssumption} />
            <Field label="Способ проверки" text={pit.verificationMethod} />
            <Field label="Условие оправдания" text={pit.acquittalCondition} />

            <div className="rounded-md border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium text-muted-foreground">Статус доказательности:</span>
                {hasRuns ? (
                  <Badge variant="outline" className="border-teal-500/50 bg-teal-500/10 text-[10px] text-teal-700 dark:text-teal-300">
                    есть связанные запуски ({relatedRuns.length})
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-dashed text-[10px] text-muted-foreground">
                    {pit.evidenceStatus}
                  </Badge>
                )}
              </div>
              {hasRuns ? (
                <ul className="mt-1.5 space-y-0.5">
                  {relatedRuns.map((r) => (
                    <li key={r.id} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="text-teal-600 dark:text-teal-300">●</span>
                      {ROLE_TITLES[r.role]} · {r.status}
                      {r.verdict ? ` · вердикт: ${r.verdict}` : ' · вердикт не установлен'} · {r.backend}
                    </li>
                  ))}
                  <li className="pt-1 text-[10px] text-muted-foreground">
                    Связанные запуски не доказывают внутренний маршрут модели — только наблюдаемый результат по разделу сценария.
                  </li>
                </ul>
              ) : (
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                  Запусков, привязанных к разделам этой ямы, пока нет — статус не доказан и не опровергнут.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={onVerify}>
                <FlaskConical className="size-3.5" aria-hidden />
                Проверить сценарием
              </Button>
              {section && (
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => onOpenFragment(section.id)}>
                  <ExternalLink className="size-3.5" aria-hidden />
                  Связанный фрагмент
                </Button>
              )}
              <CopyButton text={() => pitToMarkdown(pit)} label="Скопировать яму" size="sm" variant="ghost" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{children}</p>
}

function Field({ label, text }: { label: string; text: string }) {
  return (
    <div className="space-y-0.5">
      <FieldLabel>{label}</FieldLabel>
      <p className="text-xs leading-relaxed text-foreground/90">{text}</p>
    </div>
  )
}

// ---------- markdown builders ----------

export function pitToMarkdown(pit: Pit): string {
  const lines = [
    `### Яма: ${pit.title}`,
    '',
    `- Стадия: ${pit.stage}${pit.relatedStages?.length ? ` (затрагивает ${pit.relatedStages.join(', ')})` : ''}`,
    `- Условие возникновения: ${pit.condition}`,
    `- Нарушаемое свойство: ${pit.violatedProperty}`,
    `- Последствие: ${pit.consequence}`,
    `- Минимальный пример: ${pit.minimalExample}`,
    `- Привязка: §${pit.ruleRef.sectionPath} — “${pit.ruleRef.quote}”`,
    ...(pit.extraRefs ?? []).map((r) => `- Доп. привязка: §${r.sectionPath} — “${r.quote}”`),
    `- Допущение: ${pit.extraAssumption}`,
    `- Способ проверки: ${pit.verificationMethod}`,
    `- Условие оправдания: ${pit.acquittalCondition}`,
    `- Статус доказательности: ${pit.evidenceStatus}`,
    '',
    '_Каталог ям составлен вручную по тексту скилла; это потенциальный отказ (гипотеза), не подтверждённый дефект._',
  ]
  return lines.join('\n')
}

export function roadsToMarkdown(
  stages: StageDef[],
  forks: ForkDef[],
  pits: Pit[]
): string {
  const lines: string[] = []
  lines.push('# Failure Roads — карта дороги выполнения задачи')
  lines.push('')
  lines.push('_Аналитическая реконструкция по разделам скилла (LOCAL). Наблюдаемые наложения — из реальных запусков._')
  lines.push('')
  for (const s of stages) {
    lines.push(`## Стадия ${s.id}. ${s.title}`)
    lines.push(`- Разделы: ${s.refs.map((r) => `§${r.path} (${r.label})`).join('; ')}`)
    lines.push(`- Требование: ${s.requirement}`)
    lines.push(`- Выход: ${s.exit}`)
    const stagePits = pits.filter((p) => p.stage === s.id)
    if (stagePits.length > 0) {
      lines.push(`- Ямы (${stagePits.length}):`)
      for (const p of stagePits) lines.push(`  - ${p.title} — ${p.condition}`)
    }
    lines.push('')
  }
  for (const f of forks) {
    lines.push(`## Развилка после стадии ${f.afterStage}: «${f.condition}»`)
    lines.push(`- Основание: ${f.basis}`)
    for (const b of f.branches) {
      lines.push(`  - ${b.kind === 'ok' ? '✓' : '✗'} ${b.label}${b.detail ? ` — ${b.detail}` : ''}`)
    }
    lines.push('')
  }
  lines.push('## Каталог ям (полные карточки)')
  lines.push('')
  for (const p of pits) {
    lines.push(pitToMarkdown(p))
    lines.push('')
  }
  return lines.join('\n')
}
