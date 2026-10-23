// Карточка метрики: заголовок + провенанс + паспорт показателя (i) + график
// или честная панель «Данных нет». Списочные метрики — строками, без графика.
'use client'

import * as React from 'react'
import { ArrowRight, ChevronRight, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ProvenanceTag } from '@/components/shared/status-badges'
import { KV } from '@/components/shared/misc'
import { MetricChart, partTitle } from './metric-chart'
import type { MetricDefinition, MetricSeriesPoint } from '@/lib/types'
import { cn } from '@/lib/utils'

const PART_CHIP_CLASS: Record<string, string> = {
  pass: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  fail: 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400',
  inconclusive: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300',
}

export function MetricCard({
  metric,
  onDrill,
}: {
  metric: MetricDefinition
  onDrill: (point: MetricSeriesPoint) => void
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <h3 className="min-w-0 text-sm font-semibold leading-snug">{metric.title}</h3>
          <div className="flex shrink-0 items-center gap-1.5">
            <ProvenanceTag provenance={metric.provenance} />
            <MetricPassport metric={metric} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-56 flex-1 flex-col">
        {metric.noData ? (
          <NoDataPanel metric={metric} />
        ) : metric.chartType === 'list' ? (
          <ListMetric metric={metric} onDrill={onDrill} />
        ) : (
          <ChartSection metric={metric as MetricDefinition & { chartType: 'bar' | 'stacked-bar' | 'pie' | 'line' }} onDrill={onDrill} />
        )}
      </CardContent>
    </Card>
  )
}

/** Паспорт показателя (ТЗ п.11): определение / способ / выборка / ограничения / дата. */
function MetricPassport({ metric }: { metric: MetricDefinition }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Паспорт показателя «${metric.title}»`}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Info className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <div className="space-y-3">
          <div>
            <p className="text-xs font-semibold">Паспорт показателя</p>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{metric.id}</p>
          </div>
          <PassportRow title="Определение" body={metric.definition} />
          <PassportRow title="Способ получения" body={metric.method} />
          <PassportRow title="Ограничения" body={metric.limitations} />
          <div className="grid grid-cols-2 gap-x-4">
            <KV
              k="Размер выборки"
              v={metric.sampleSize === null ? 'не применимо' : metric.sampleSize.toLocaleString('ru-RU')}
            />
            <KV
              k="Вычислено"
              v={<span className="text-xs">{new Date(metric.computedAt).toLocaleString('ru-RU')}</span>}
            />
            <KV k="Данные" v={metric.dataOrigin === 'real' ? 'реальные (DEMO исключены)' : metric.dataOrigin} />
            <KV
              k="Версия"
              v={
                metric.versionId ? (
                  <span className="font-mono text-[10px]">{metric.versionId.slice(0, 12)}…</span>
                ) : (
                  '—'
                )
              }
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function PassportRow({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="mt-0.5 text-xs leading-relaxed">{body}</p>
    </div>
  )
}

/** Честная панель отсутствия данных — никогда не 0% / 100% заглушки. */
function NoDataPanel({ metric }: { metric: MetricDefinition }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-center">
      <Badge variant="outline" className="border-dashed font-mono text-[10px] text-muted-foreground">
        Данных нет
      </Badge>
      <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
        {metric.noDataReason ?? 'Данных для этой метрики нет'}
      </p>
      <p className="text-[10px] text-muted-foreground">
        Провенанс: <span className="font-mono">{metric.provenance}</span> — вместо пустых значений честно
        показываем отсутствие данных.
      </p>
    </div>
  )
}

function ChartSection({
  metric,
  onDrill,
}: {
  metric: MetricDefinition & { chartType: Exclude<MetricDefinition['chartType'], 'list'> }
  onDrill: (point: MetricSeriesPoint) => void
}) {
  return (
    <>
      <div className="h-56">
        <MetricChart chartType={metric.chartType} series={metric.series} onPointClick={onDrill} />
      </div>
      <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
        <ChevronRight className="mt-0.5 size-3 shrink-0" aria-hidden />
        <span className="line-clamp-2">{metric.limitations}</span>
      </p>
    </>
  )
}

/** Списочная метрика (evaluator-disagreements): строки-группы, без графика. */
function ListMetric({
  metric,
  onDrill,
}: {
  metric: MetricDefinition
  onDrill: (point: MetricSeriesPoint) => void
}) {
  return (
    <div className="scroll-observatory max-h-64 flex-1 space-y-1.5 overflow-y-auto pr-1">
      {metric.series.map((p, i) => {
        const drill = p.drilldown?.[0]
        return (
          <button
            key={`${p.label}-${i}`}
            type="button"
            onClick={() => onDrill(p)}
            className={cn(
              'flex w-full flex-col gap-1 rounded-md border bg-card/60 px-3 py-2 text-left transition-colors',
              drill ? 'hover:border-primary/40 hover:bg-primary/5' : 'cursor-default opacity-90'
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-mono text-xs">{p.label}</span>
              <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                {p.value} оценщ.
                {drill && <ArrowRight className="size-3" aria-hidden />}
              </span>
            </span>
            <span className="flex flex-wrap gap-1">
              {Object.entries(p.parts ?? {}).map(([k, v]) => (
                <span
                  key={k}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium',
                    PART_CHIP_CLASS[k] ?? 'border-border bg-muted/50 text-muted-foreground'
                  )}
                >
                  {partTitle(k)}: {v}
                </span>
              ))}
            </span>
          </button>
        )
      })}
      <p className="flex items-start gap-1.5 pt-1 text-[11px] leading-snug text-muted-foreground">
        <ChevronRight className="mt-0.5 size-3 shrink-0" aria-hidden />
        <span className="line-clamp-2">{metric.limitations}</span>
      </p>
    </div>
  )
}
