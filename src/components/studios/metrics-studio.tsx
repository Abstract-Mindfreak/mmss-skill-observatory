// Метрики (ТЗ п.11): честные панели показателей с паспортом каждого —
// определение, способ, выборка, ограничения, дата. DEMO-данные исключены.
'use client'

import * as React from 'react'
import { BarChart3, Download, RefreshCw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SectionHeader } from '@/components/shared/misc'
import { ErrorState, InlineSpinner, LoadingState } from '@/components/shared/states'
import { CopyButton } from '@/components/shared/copy'
import { OriginBadge } from '@/components/shared/status-badges'
import { useStore, activeVersionId } from '@/lib/store'
import { api, downloadFile, exportUrl } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'
import type { MetricsBundle, MetricProvenance, MetricSeriesPoint } from '@/lib/types'
import { MetricCard } from './metrics/metric-card'
import { partTitle } from './metrics/metric-chart'

const PROVENANCE_LABELS: Record<MetricProvenance, string> = {
  measured: 'Измерено',
  computed: 'Вычислено',
  'model-evaluated': 'Оценено моделью',
  goal: 'Цель',
  synthetic: 'Синтетическое',
  'no-data': 'Данных нет',
}

export default function MetricsStudio() {
  const appState = useStore((s) => s.appState)
  const currentVersionId = useStore(activeVersionId)
  const selectVersion = useStore((s) => s.selectVersion)
  const selectRun = useStore((s) => s.selectRun)
  const selectScenario = useStore((s) => s.selectScenario)
  const setStudio = useStore((s) => s.setStudio)
  const goToFragment = useStore((s) => s.goToFragment)
  const { toast } = useToast()

  const [bundle, setBundle] = React.useState<MetricsBundle | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [exportBusy, setExportBusy] = React.useState(false)

  const project = appState?.project ?? null
  const documents = appState?.documents ?? []

  const load = React.useCallback(async () => {
    if (!project || !currentVersionId) return
    setLoading(true)
    setError(null)
    try {
      setBundle(await api.metrics(project.id, currentVersionId))
    } catch (e) {
      setBundle(null)
      setError(e instanceof Error ? e.message : 'Не удалось загрузить метрики')
    } finally {
      setLoading(false)
    }
  }, [project, currentVersionId])

  React.useEffect(() => {
    void load()
  }, [load])

  // ---- drilldown: переход в профильную студию + тост с подписью ----
  const handleDrill = (point: MetricSeriesPoint) => {
    const dd = point.drilldown?.[0]
    if (!dd) {
      toast({ title: point.label, description: 'У этой точки нет ссылки-перехода на исходные данные' })
      return
    }
    switch (dd.kind) {
      case 'section':
      case 'fragment': {
        // число фрагментов раздела считаем только для версии, чьи фрагменты уже в состоянии
        const section = appState?.fragments.find((f) => f.id === dd.id)
        let count = 0
        if (section && appState && bundle?.versionId === appState.activeVersion?.id) {
          count = appState.fragments.filter(
            (f) => f.path === section.path || f.path.startsWith(section.path + '.')
          ).length
        }
        toast({
          title: count > 0 ? `${point.label} — ${count} фрагментов; открыт атлас` : `${point.label}; открыт атлас`,
        })
        goToFragment(dd.id)
        break
      }
      case 'run':
        selectRun(dd.id)
        setStudio('lab')
        toast({ title: point.label, description: 'Открыт Behavior Lab — выбран связанный запуск' })
        break
      case 'scenario':
        selectScenario(dd.id)
        setStudio('scenario')
        toast({ title: point.label, description: 'Открыто дерево сценариев' })
        break
      case 'finding':
        setStudio('lab')
        toast({ title: point.label, description: 'Открыт Behavior Lab — находки привязаны к запускам' })
        break
      case 'version':
        selectVersion(dd.id)
        toast({ title: `Метрики пересчитываются для версии «${point.label}»` })
        break
    }
  }

  const handleExportCsv = async () => {
    if (!project) return
    setExportBusy(true)
    try {
      await downloadFile(exportUrl(project.id, 'csv', 'all'), `${project.name}-export.csv`)
      toast({ title: 'CSV-экспорт начат', description: 'Файл содержит таблицы: сценарии, запуски, находки, заметки' })
    } catch (e) {
      toast({
        title: 'Экспорт не удался',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setExportBusy(false)
    }
  }

  const buildSummary = React.useCallback((): string => {
    if (!bundle || !project) return ''
    const lines: string[] = [
      `# Метрики проекта «${project.name}»`,
      `Версия: ${documents.flatMap((d) => d.versions).find((v) => v.id === bundle.versionId)?.label ?? bundle.versionId}`,
      `Сгенерировано: ${new Date(bundle.generatedAt).toLocaleString('ru-RU')}`,
      `DEMO-данные исключены: ${bundle.demoExcluded ? 'да' : 'нет'}`,
      '',
    ]
    for (const m of bundle.metrics) {
      lines.push(`## ${m.title} (${m.id})`)
      lines.push(`- Провенанс: ${PROVENANCE_LABELS[m.provenance]}`)
      lines.push(`- Размер выборки: ${m.sampleSize === null ? 'не применимо' : m.sampleSize}`)
      if (m.noData) {
        lines.push(`- Данных нет: ${m.noDataReason ?? 'нет данных'}`)
      } else {
        for (const p of m.series) {
          const parts = Object.entries(p.parts ?? {})
          lines.push(
            `- ${p.label}: ${p.value}${parts.length > 0 ? ` (${parts.map(([k, v]) => `${partTitle(k)}: ${v}`).join(', ')})` : ''}`
          )
        }
      }
      lines.push('')
    }
    return lines.join('\n')
  }, [bundle, project, documents])

  if (!project) {
    return (
      <div className="py-8">
        <ErrorState error="Проект не выбран" title="Нет проекта для метрик" />
      </div>
    )
  }

  const demoRuns = appState?.runs.filter((r) => r.origin === 'demo').length ?? 0
  const demoFindings = appState?.findings.filter((f) => f.origin === 'demo').length ?? 0
  const demoScenarios = appState?.scenarios.filter((s) => s.origin === 'demo').length ?? 0
  const demoNotes = appState?.notes.filter((n) => n.origin === 'demo').length ?? 0
  const demoTotal = demoRuns + demoFindings + demoScenarios + demoNotes

  return (
    <div className="space-y-6 py-2">
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            <BarChart3 className="size-5 text-primary" aria-hidden />
            Метрики
          </span>
        }
        description="Честные показатели исследования: у каждого — паспорт (определение, способ, выборка, ограничения). Нулевая выборка показывается как «данных нет», а не как 0% или 100%."
        actions={
          <>
            <Select
              value={currentVersionId ?? undefined}
              onValueChange={(v) => selectVersion(v)}
              disabled={documents.length === 0}
            >
              <SelectTrigger size="sm" className="w-56" aria-label="Версия для метрик">
                <SelectValue placeholder="Версия документа" />
              </SelectTrigger>
              <SelectContent>
                {documents.map((d) => (
                  <SelectGroup key={d.id}>
                    <SelectLabel className="max-w-64 truncate">{d.title}</SelectLabel>
                    {d.versions.map((v) => (
                      <SelectItem key={v.id} value={v.id} className="text-xs">
                        {v.label}
                        {v.isActive ? ' · активная' : ''}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void load()} disabled={loading}>
              {loading ? <InlineSpinner label="Обновление…" /> : <><RefreshCw className="size-3.5" aria-hidden />Обновить метрики</>}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => void handleExportCsv()}
              disabled={exportBusy}
            >
              {exportBusy ? <InlineSpinner label="Экспорт…" /> : <><Download className="size-3.5" aria-hidden />Экспорт CSV</>}
            </Button>
            <CopyButton text={buildSummary} label="Копировать сводку" size="sm" />
          </>
        }
      />

      <p className="-mt-2 text-xs text-muted-foreground">
        CSV-экспорт покрывает таблицы (сценарии, запуски, находки, заметки) — карточки метрик переносятся кнопкой
        «Копировать сводку» в формате Markdown.
      </p>

      {/* DEMO exclusion banner */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
          <ShieldCheck className="size-4 shrink-0 text-teal-500" aria-hidden />
          <span className="text-xs font-medium">
            {bundle?.demoExcluded
              ? 'DEMO-данные исключены из всех метрик'
              : 'DEMO-данные: состояние проверки неизвестно'}
          </span>
          <span className="text-xs text-muted-foreground">
            {demoTotal > 0
              ? `В проекте есть DEMO-записи: сценариев ${demoScenarios}, запусков ${demoRuns}, находок ${demoFindings}, заметок ${demoNotes} — в метрики они не входят.`
              : 'DEMO-записей в проекте нет.'}
          </span>
          {demoTotal > 0 && <OriginBadge origin="demo" />}
        </CardContent>
      </Card>

      {error && <ErrorState error={error} onRetry={() => void load()} title="Метрики недоступны" />}

      {loading && !bundle ? (
        <LoadingState label="Вычисление метрик…" />
      ) : bundle ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {bundle.metrics.map((m) => (
            <MetricCard key={m.id} metric={m} onDrill={handleDrill} />
          ))}
        </div>
      ) : !error ? (
        <LoadingState label="Ожидание данных…" />
      ) : null}
    </div>
  )
}
