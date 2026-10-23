// Рендереры графиков метрик (recharts v2). Тема — через CSS-переменные обсерватории,
// палитра >5 серий — hex-цвета из LAYER_VISUALS (та же система, что подчёркивания атласа).
'use client'

import * as React from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { LAYER_TITLES, type LayerId, type MetricSeriesPoint } from '@/lib/types'
import { LAYER_VISUALS } from '@/components/shared/layers'

/** Пять основных цветов из темы (teal/amber/rose/lime/fuchsia — без синего). */
export const CHART_VARS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const

/** Hex-палитра, согласованная с CHART_VARS, для серий вне пяти переменных темы. */
const FALLBACK_PALETTE = ['#0d9488', '#d97706', '#e11d48', '#65a30d', '#c026d3', '#64748b', '#ea580c']

/** Человекочитаемые названия частей столбцов (machine layer ids → RU). */
const PART_TITLES: Record<string, string> = {
  sectionRefs: 'Ссылки на разделы',
  fragments: 'Фрагменты',
  findings: 'Находки',
  pass: 'Пройдено',
  fail: 'Не пройдено',
  inconclusive: 'Неоднозначно',
}

export function isLayerId(key: string): key is LayerId {
  return key in LAYER_TITLES
}

export function partTitle(key: string): string {
  if (isLayerId(key)) return LAYER_TITLES[key]
  return PART_TITLES[key] ?? key
}

/** Цвет серии: слои — из визуальной системы атласа, прочее — резервная палитра. */
export function seriesColor(key: string, index: number): string {
  if (isLayerId(key)) return LAYER_VISUALS[key].color
  return FALLBACK_PALETTE[index % FALLBACK_PALETTE.length]
}

const AXIS_TICK = { fontSize: 10, fill: 'var(--muted-foreground)' }
const TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--popover)',
  color: 'var(--foreground)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
  padding: '8px 10px',
  boxShadow: '0 4px 16px rgb(0 0 0 / 0.25)',
}

/** Сокращение длинной подписи секции для оси: «6. Sources and Provenance» → «6. Sources…». */
function axisLabel(label: string, max = 14): string {
  return label.length > max ? label.slice(0, max - 1).trimEnd() + '…' : label
}

interface ChartDatum extends MetricSeriesPoint {
  name: string
  __point: MetricSeriesPoint
  [key: string]: unknown
}

function toData(series: MetricSeriesPoint[]): ChartDatum[] {
  return series.map((p) => ({ ...p, name: p.label, __point: p }))
}

/** Общий тултип: подпись, значение и разбор частей с русскими названиями. */
function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload?: ChartDatum }[] }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload?.__point
  if (!point) return null
  const parts = Object.entries(point.parts ?? {}).filter(([, v]) => v > 0)
  return (
    <div className="max-w-64 space-y-1" style={TOOLTIP_STYLE}>
      <p className="text-xs font-medium">{point.label}</p>
      <p className="font-mono text-xs">
        значение: <span className="font-semibold">{point.value}</span>
      </p>
      {parts.length > 0 && (
        <ul className="mt-1 space-y-0.5 border-t pt-1" style={{ borderColor: 'var(--border)' }}>
          {parts.map(([k, v]) => (
            <li key={k} className="flex items-baseline justify-between gap-3 text-[11px]">
              <span style={{ color: 'var(--muted-foreground)' }}>{partTitle(k)}</span>
              <span className="font-mono">{v}</span>
            </li>
          ))}
        </ul>
      )}
      {point.drilldown && point.drilldown.length > 0 && (
        <p className="pt-0.5 text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
          нажмите на столбец для перехода
        </p>
      )}
    </div>
  )
}

export interface MetricChartProps {
  chartType: 'bar' | 'stacked-bar' | 'pie' | 'line'
  series: MetricSeriesPoint[]
  onPointClick?: (point: MetricSeriesPoint) => void
}

/** Универсальный рендерер графика по chartType метрики. Высота задаётся контейнером. */
export function MetricChart({ chartType, series, onPointClick }: MetricChartProps) {
  const data = React.useMemo(() => toData(series), [series])
  const handleBar = (entry: unknown) => {
    const point = (entry as { payload?: ChartDatum } | null)?.payload?.__point
    if (point && onPointClick) onPointClick(point)
  }
  const handlePie = (entry: unknown) => {
    const point = (entry as ChartDatum | null)?.__point
    if (point && onPointClick) onPointClick(point)
  }

  if (series.length === 0) return null

  if (chartType === 'pie') {
    const colors = data.map((_, i) => seriesColor(`__idx_${i}`, i))
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip content={<ChartTooltip />} />
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="38%"
            outerRadius="72%"
            paddingAngle={2}
            strokeWidth={1}
            stroke="var(--popover)"
            onClick={handlePie}
            style={{ cursor: onPointClick ? 'pointer' : 'default' }}
          >
            {data.map((d, i) => (
              <Cell key={d.label} fill={colors[i % colors.length]} />
            ))}
          </Pie>
          <Legend
            verticalAlign="bottom"
            height={36}
            iconSize={8}
            wrapperStyle={{ fontSize: 10, color: 'var(--muted-foreground)' }}
          />
        </PieChart>
      </ResponsiveContainer>
    )
  }

  if (chartType === 'line') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="name"
            tick={AXIS_TICK}
            tickFormatter={(v: string) => axisLabel(v, 10)}
            interval="preserveStartEnd"
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
          />
          <YAxis tick={AXIS_TICK} axisLine={{ stroke: 'var(--border)' }} tickLine={false} allowDecimals={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border)' }} />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={{ r: 2.5, fill: 'var(--chart-1)' }}
            activeDot={{ r: 4 }}
            onClick={handleBar}
            style={{ cursor: onPointClick ? 'pointer' : 'default' }}
          />
        </LineChart>
      </ResponsiveContainer>
    )
  }

  // bar | stacked-bar
  const partKeys =
    chartType === 'stacked-bar'
      ? Array.from(new Set(data.flatMap((d) => Object.entries(d.parts ?? {}).filter(([, v]) => v > 0).map(([k]) => k))))
      : []
  const manyLabels = data.length > 8

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="name"
          tick={AXIS_TICK}
          tickFormatter={(v: string) => axisLabel(v, manyLabels ? 10 : 14)}
          interval={0}
          angle={manyLabels ? -38 : 0}
          textAnchor={manyLabels ? 'end' : 'middle'}
          height={manyLabels ? 58 : 24}
          axisLine={{ stroke: 'var(--border)' }}
          tickLine={false}
        />
        <YAxis tick={AXIS_TICK} axisLine={{ stroke: 'var(--border)' }} tickLine={false} allowDecimals={false} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--muted)', fillOpacity: 0.35 }} />
        {partKeys.length > 0 && (
          <Legend
            verticalAlign="top"
            align="right"
            iconSize={8}
            formatter={(v: string) => partTitle(v)}
            wrapperStyle={{ fontSize: 10, color: 'var(--muted-foreground)' }}
          />
        )}
        {partKeys.length === 0 ? (
          <Bar
            dataKey="value"
            fill="var(--chart-1)"
            radius={[3, 3, 0, 0]}
            maxBarSize={42}
            onClick={handleBar}
            style={{ cursor: onPointClick ? 'pointer' : 'default' }}
          />
        ) : (
          partKeys.map((k, i) => (
            <Bar
              key={k}
              dataKey={`parts.${k}`}
              name={partTitle(k)}
              stackId="layers"
              fill={seriesColor(k, i)}
              maxBarSize={42}
              onClick={handleBar}
              style={{ cursor: onPointClick ? 'pointer' : 'default' }}
            />
          ))
        )}
      </BarChart>
    </ResponsiveContainer>
  )
}
