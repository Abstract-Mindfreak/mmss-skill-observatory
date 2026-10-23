// ============================================================
// Metrics engine (owner: agent 1-c).
// Computes the MetricsBundle (10 metrics per docs/CONTRACTS.md).
// Demo data (origin='demo') is excluded everywhere; every metric
// carries definition/method/limitations and honest no-data handling.
// ============================================================

import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'
import type {
  FragmentAnnotation,
  LocalAnalysisResult,
  MetricDefinition,
  MetricProvenance,
  MetricSeriesPoint,
  MetricsBundle,
  RunStatus,
  Verdict,
} from '@/lib/types'
import type { DocumentVersion, Fragment } from '@prisma/client'

// ---------- helpers ----------

function topPath(path: string): string {
  return path.split('.')[0] ?? path
}

interface SectionInfo {
  path: string
  title: string
  label: string // "6. Sources and Provenance"
  fragmentId: string
}

/** Top-level sections (path without a dot) sorted numerically. */
function buildSectionList(fragments: Fragment[]): SectionInfo[] {
  return fragments
    .filter((f) => f.kind === 'section' && !f.path.includes('.'))
    .map((f) => {
      // strip a leading number from the title to avoid "1. 1. Purpose..." duplication
      const cleanTitle = (f.title ?? '').replace(/^\d+(?:\.\d+)*\.?\s+/, '').trim()
      return {
        path: f.path,
        title: cleanTitle || (f.title ?? ''),
        label: `${f.path}. ${cleanTitle || f.title || f.path}`.trim(),
        fragmentId: f.id,
      }
    })
    .sort((a, b) => Number(a.path) - Number(b.path) || a.path.localeCompare(b.path))
}

const NO_ANALYSIS_REASON =
  'Локальный структурный анализ для этой версии не выполнен — запустите «Локальный анализ» в интерфейсе'
const NO_FRAGMENTS_REASON =
  'В этой версии нет фрагментов — привязка к разделам невозможна (выполните локальный анализ)'

const EMPTY_ANALYSIS: LocalAnalysisResult = {
  analysisId: '',
  versionId: '',
  createdAt: '',
  durationMs: 0,
  methodSummary: '',
  limitations: [],
  fragmentCount: 0,
  annotations: [],
  layerCounts: {},
  repetitions: [],
  conflictCandidates: [],
  unusedDefinitions: [],
  brokenRefs: [],
  ambiguityHotspots: [],
}

interface MetricInput {
  id: string
  title: string
  chartType: MetricDefinition['chartType']
  provenance: MetricProvenance
  definition: string
  method: string
  limitations: string
  sampleSize: number
  versionId: string | null
  series: MetricSeriesPoint[]
  noData: boolean
  noDataReason?: string
}

function mkMetric(m: MetricInput): MetricDefinition {
  const out: MetricDefinition = {
    id: m.id,
    title: m.title,
    chartType: m.chartType,
    provenance: m.provenance,
    definition: m.definition,
    method: m.method,
    limitations: m.limitations,
    sampleSize: m.sampleSize,
    dataOrigin: 'real',
    computedAt: new Date().toISOString(),
    versionId: m.versionId,
    series: m.noData ? [] : m.series,
    noData: m.noData,
  }
  if (m.noData && m.noDataReason) out.noDataReason = m.noDataReason
  return out
}

const RUN_STATUS_TITLES: Record<RunStatus, string> = {
  planned: 'Запланирован',
  queued: 'В очереди',
  running: 'Выполняется',
  completed: 'Завершён',
  cancelled: 'Отменён',
  failed: 'Ошибка',
}

const VERDICT_TITLES: Record<Verdict, string> = {
  pass: 'Пройден',
  fail: 'Не пройден',
  inconclusive: 'Неопределённый',
}

// ---------- main entry ----------

/**
 * Compute the metrics bundle for a project.
 * versionId defaults to the active version (or the latest one).
 * Returns null when the project (or the requested version) does not exist.
 */
export async function computeMetrics(
  projectId: string,
  versionIdParam?: string
): Promise<MetricsBundle | null> {
  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project) return null

  const documents = await db.document.findMany({
    where: { projectId },
    include: { versions: true },
  })
  const allVersions: DocumentVersion[] = documents.flatMap((d) => d.versions)
  const byDateDesc = (a: DocumentVersion, b: DocumentVersion) =>
    b.importDate.getTime() - a.importDate.getTime()

  let version: DocumentVersion | undefined
  if (versionIdParam) {
    version = allVersions.find((v) => v.id === versionIdParam)
    if (!version) return null
  } else {
    version = allVersions.filter((v) => v.isActive).sort(byDateDesc)[0]
    if (!version) version = [...allVersions].sort(byDateDesc)[0]
  }

  const generatedAt = new Date().toISOString()
  const versionId = version?.id ?? null

  // no versions at all -> every metric honestly no-data
  if (!version) {
    const empty = (id: string, title: string, chartType: MetricDefinition['chartType']): MetricDefinition =>
      mkMetric({
        id,
        title,
        chartType,
        provenance: 'computed',
        definition: METRIC_DEFS[id].definition,
        method: METRIC_DEFS[id].method,
        limitations: METRIC_DEFS[id].limitations,
        sampleSize: 0,
        versionId: null,
        series: [],
        noData: true,
        noDataReason: 'В проекте нет версий документа — вычисление невозможно',
      })
    return {
      projectId,
      versionId: '',
      metrics: METRIC_IDS.map((id) => empty(id, METRIC_DEFS[id].title, METRIC_DEFS[id].chartType)),
      demoExcluded: true,
      generatedAt,
    }
  }

  const fragments = await db.fragment.findMany({
    where: { versionId: version.id },
    orderBy: { order: 'asc' },
  })
  const analysis = await db.analysis.findFirst({
    where: { versionId: version.id, type: 'local-structural' },
    orderBy: { createdAt: 'desc' },
  })
  const analysisResult: LocalAnalysisResult | null = analysis
    ? safeParse<LocalAnalysisResult>(analysis.result, EMPTY_ANALYSIS)
    : null
  const hasAnalysis = Boolean(analysis && analysisResult && analysisResult.annotations)

  const scenarios = await db.scenario.findMany({
    where: { projectId, origin: { not: 'demo' } },
  })
  const runs = await db.run.findMany({
    where: { projectId, origin: { not: 'demo' } },
    orderBy: { createdAt: 'asc' },
  })
  const findings = await db.finding.findMany({
    where: { projectId, origin: { not: 'demo' } },
  })

  const sections = buildSectionList(fragments)
  const fragById = new Map(fragments.map((f) => [f.id, f]))
  const topByFragment = new Map(fragments.map((f) => [f.id, topPath(f.path)]))
  const annByFragment = new Map<string, FragmentAnnotation>()
  if (analysisResult) {
    for (const ann of analysisResult.annotations) annByFragment.set(ann.fragmentId, ann)
  }
  const sectionNoData = !hasAnalysis || sections.length === 0
  const sectionNoDataReason = !hasAnalysis ? NO_ANALYSIS_REASON : NO_FRAGMENTS_REASON

  const metrics: MetricDefinition[] = []

  // 1. rule-types-by-section (stacked-bar)
  {
    const series = sections.map((sec) => {
      const parts: Record<string, number> = {}
      let total = 0
      for (const ann of annByFragment.values()) {
        if (topByFragment.get(ann.fragmentId) !== sec.path) continue
        for (const layer of ann.layers) {
          parts[layer.layer] = (parts[layer.layer] ?? 0) + 1
          total += 1
        }
      }
      return {
        label: sec.label,
        value: total,
        parts,
        drilldown: [{ kind: 'section' as const, id: sec.fragmentId }],
      }
    })
    metrics.push(
      mkMetric({
        id: 'rule-types-by-section',
        title: 'Слои правил по разделам',
        chartType: 'stacked-bar',
        provenance: 'computed',
        definition:
          'Число постановок каждого слоя (обязательства, запреты, условия и т.д.) в каждом разделе документа.',
        method:
          'Подсчёт фрагментов с данным слоем по разделам из последнего локального структурного анализа версии: верхний раздел определяется по пути фрагмента, доли стека — по слоям аннотаций.',
        limitations:
          'Слои проставлены локальными лексическими эвристиками (LOCAL) — возможны пропуски и ложные срабатывания; это не модельная оценка.',
        sampleSize: analysisResult ? analysisResult.annotations.length : 0,
        versionId,
        series,
        noData: sectionNoData,
        noDataReason: sectionNoDataReason,
      })
    )
  }

  // 2. scenario-coverage (bar)
  {
    const series = sections.map((sec) => {
      const ids: string[] = []
      for (const s of scenarios) {
        if (!s.fragmentId) continue
        const f = fragById.get(s.fragmentId)
        if (f && topByFragment.get(f.id) === sec.path) ids.push(s.id)
      }
      return {
        label: sec.label,
        value: ids.length,
        drilldown: [
          { kind: 'section' as const, id: sec.fragmentId },
          ...ids.map((id) => ({ kind: 'scenario' as const, id })),
        ],
      }
    })
    metrics.push(
      mkMetric({
        id: 'scenario-coverage',
        title: 'Покрытие разделов сценариями',
        chartType: 'bar',
        provenance: 'computed',
        definition:
          'Число проверочных сценариев, привязанных к фрагментам каждого раздела документа.',
        method:
          'Подсчёт реальных сценариев (origin ≠ demo), у которых fragmentId указывает на фрагмент данного раздела; разделы без сценариев входят с нулём.',
        limitations:
          'Учитывается только явная привязка сценария к фрагменту; сценарии без привязки не входят в покрытие разделов.',
        sampleSize: scenarios.length,
        versionId,
        series,
        noData: scenarios.length === 0 || sections.length === 0,
        noDataReason:
          scenarios.length === 0
            ? 'Сценариев нет — покрытие разделов не может быть вычислено'
            : sections.length === 0
              ? 'В этой версии нет фрагментов — привязка сценариев к разделам невозможна'
              : undefined,
      })
    )
  }

  // 3. definition-density (bar)
  {
    const series = sections.map((sec) => {
      let definitions = 0
      let refs = 0
      const fragIds: string[] = []
      for (const ann of annByFragment.values()) {
        if (topByFragment.get(ann.fragmentId) !== sec.path) continue
        if (ann.layers.some((l) => l.layer === 'definition')) {
          definitions += 1
          fragIds.push(ann.fragmentId)
        }
        refs += ann.sectionRefs.length
      }
      return {
        label: sec.label,
        value: definitions + refs,
        parts: { definition: definitions, sectionRefs: refs },
        drilldown: fragIds.map((id) => ({ kind: 'fragment' as const, id })),
      }
    })
    metrics.push(
      mkMetric({
        id: 'definition-density',
        title: 'Плотность определений и ссылок',
        chartType: 'bar',
        provenance: 'computed',
        definition:
          'Сумма числа определений и перекрёстных ссылок на разделы внутри каждого раздела документа.',
        method:
          'По последнему локальному структурному анализу: считаются фрагменты со слоем «Определения» и все ссылки вида «Section N»/«§N» в фрагментах раздела.',
        limitations:
          'Определения распознаются эвристически (связки «is a/means/refers to» и заглавные термины); часть определений может быть пропущена.',
        sampleSize: analysisResult ? analysisResult.annotations.length : 0,
        versionId,
        series,
        noData: sectionNoData,
        noDataReason: sectionNoDataReason,
      })
    )
  }

  // 4. ambiguity-hotspots (bar)
  {
    const series = sections.map((sec) => {
      let markers = 0
      let frags = 0
      const ids: string[] = []
      for (const h of analysisResult?.ambiguityHotspots ?? []) {
        if (topByFragment.get(h.fragmentId) !== sec.path) continue
        markers += h.markers.length
        frags += 1
        ids.push(h.fragmentId)
      }
      return {
        label: sec.label,
        value: markers,
        parts: { fragments: frags },
        drilldown: ids.map((id) => ({ kind: 'fragment' as const, id })),
      }
    })
    metrics.push(
      mkMetric({
        id: 'ambiguity-hotspots',
        title: 'Очаги неоднозначности',
        chartType: 'bar',
        provenance: 'computed',
        definition:
          'Плотность маркеров неоднозначности (may, available, sufficient, unknown и т.п.) по разделам документа.',
        method:
          'По последнему локальному структурному анализу: суммируются маркеры неоднозначности в «горячих» фрагментах каждого раздела.',
        limitations:
          'Маркеры — лексический сигнал, а не доказательство неоднозначности: требуется ручная проверка фрагмента.',
        sampleSize: analysisResult?.ambiguityHotspots.length ?? 0,
        versionId,
        series,
        noData: sectionNoData,
        noDataReason: sectionNoDataReason,
      })
    )
  }

  // 5. findings-distribution (pie)
  {
    const sevTitles: Record<string, string> = {
      info: 'Информационные',
      warning: 'Предупреждения',
      issue: 'Проблемы',
    }
    const counts: Record<string, number> = { info: 0, warning: 0, issue: 0 }
    for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1
    const series: MetricSeriesPoint[] = (['info', 'warning', 'issue'] as const)
      .filter((sev) => counts[sev] > 0)
      .map((sev) => ({
        label: sevTitles[sev],
        value: counts[sev],
        drilldown: findings
          .filter((f) => f.severity === sev)
          .map((f) => ({ kind: 'finding' as const, id: f.id })),
      }))
    metrics.push(
      mkMetric({
        id: 'findings-distribution',
        title: 'Распределение находок',
        chartType: 'pie',
        provenance: 'computed',
        definition: 'Распределение реальных находок по важности (инфо / предупреждение / проблема).',
        method:
          'Подсчёт находок проекта с origin ≠ demo по полю severity; доли диаграммы — только непустые категории.',
        limitations:
          'Важность назначается при создании находки и может отражать субъективную оценку исследователя.',
        sampleSize: findings.length,
        versionId,
        series,
        noData: findings.length === 0,
        noDataReason: 'Находок нет — данных для распределения нет',
      })
    )
  }

  // 6. runs-by-status (bar)
  {
    const order: RunStatus[] = ['planned', 'queued', 'running', 'completed', 'cancelled', 'failed']
    const series: MetricSeriesPoint[] = order.map((st) => ({
      label: RUN_STATUS_TITLES[st],
      value: runs.filter((r) => r.status === st).length,
      drilldown: runs
        .filter((r) => r.status === st)
        .map((r) => ({ kind: 'run' as const, id: r.id })),
    }))
    metrics.push(
      mkMetric({
        id: 'runs-by-status',
        title: 'Запуски по статусам',
        chartType: 'bar',
        provenance: 'computed',
        definition: 'Число реальных запусков по статусам выполнения (жизненный цикл запуска).',
        method:
          'Подсчёт запусков проекта с origin ≠ demo по полю status; статусы без запусков показываются с нулём.',
        limitations:
          'Статус выполнения ≠ вердикт проверки: завершённый запуск может обнаружить дефект (см. метрику вердиктов).',
        sampleSize: runs.length,
        versionId,
        series,
        noData: runs.length === 0,
        noDataReason: 'Запусков нет — выполните запуск в Behavior Lab',
      })
    )
  }

  // 7. runs-by-verdict (bar)
  {
    const evaluated = runs.filter((r) => r.verdict !== null)
    const order: Verdict[] = ['pass', 'fail', 'inconclusive']
    const series: MetricSeriesPoint[] = order.map((v) => ({
      label: VERDICT_TITLES[v],
      value: evaluated.filter((r) => r.verdict === v).length,
      drilldown: evaluated
        .filter((r) => r.verdict === v)
        .map((r) => ({ kind: 'run' as const, id: r.id })),
    }))
    metrics.push(
      mkMetric({
        id: 'runs-by-verdict',
        title: 'Вердикты запусков',
        chartType: 'bar',
        provenance: 'computed',
        definition: 'Распределение вердиктов проверок (pass / fail / inconclusive) по оценённым запускам.',
        method:
          'Подсчёт реальных запусков с заполненным вердиктом (verdict ≠ null, включая пользовательские вердикты verdictBy=user).',
        limitations:
          'Вердикт может быть модельной оценкой (verdictBy=model) — качество зависит от модели и критерия; пользовательские вердикты учитываются наравне с модельными.',
        sampleSize: evaluated.length,
        versionId,
        series,
        noData: evaluated.length === 0,
        noDataReason: 'Выполнено 0 оценённых запусков — данных для вердиктов нет',
      })
    )
  }

  // 8. evaluator-disagreements (list)
  {
    const groups = new Map<string, typeof runs>()
    for (const r of runs) {
      if (r.role !== 'evaluator' || !r.parentRunId) continue
      const list = groups.get(r.parentRunId) ?? []
      list.push(r)
      groups.set(r.parentRunId, list)
    }
    const series: MetricSeriesPoint[] = []
    for (const [parentId, group] of groups) {
      const verdicts = new Set(group.map((g) => g.verdict).filter(Boolean))
      if (verdicts.size < 2) continue
      const parts: Record<string, number> = { pass: 0, fail: 0, inconclusive: 0 }
      for (const g of group) if (g.verdict) parts[g.verdict] = (parts[g.verdict] ?? 0) + 1
      series.push({
        label: `запуск ${parentId.slice(0, 8)}`,
        value: group.length,
        parts,
        drilldown: group.map((g) => ({ kind: 'run' as const, id: g.id })),
      })
    }
    const evaluators = runs.filter((r) => r.role === 'evaluator')
    metrics.push(
      mkMetric({
        id: 'evaluator-disagreements',
        title: 'Расхождения оценщиков',
        chartType: 'list',
        provenance: 'computed',
        definition:
          'Группы запусков-оценщиков (роль evaluator) одного родительского запуска, давшие разные вердикты.',
        method:
          'Группировка реальных evaluator-запусков по parentRunId; в серию входят группы с ≥2 различными вердиктами (pass/fail/inconclusive).',
        limitations:
          'Расхождение фиксирует факт разногласия, но не объясняет причину: требуется разбор промптов и критериев каждой оценки.',
        sampleSize: evaluators.length,
        versionId,
        series,
        noData: series.length === 0,
        noDataReason: 'Расхождений оценщиков не зафиксировано',
      })
    )
  }

  // 9. execution-time (bar, measured)
  {
    const completed = runs.filter((r) => r.status === 'completed' && r.durationMs !== null)
    const groups = new Map<string, { total: number; count: number }>()
    for (const r of completed) {
      const key = `${r.backend} · ${r.model ?? 'модель не указана'}`
      const g = groups.get(key) ?? { total: 0, count: 0 }
      g.total += r.durationMs ?? 0
      g.count += 1
      groups.set(key, g)
    }
    const series: MetricSeriesPoint[] = [...groups.entries()]
      .map(([label, g]) => ({
        label,
        value: Math.round(g.total / g.count),
        parts: { runs: g.count },
        drilldown: completed
          .filter((r) => `${r.backend} · ${r.model ?? 'модель не указана'}` === label)
          .map((r) => ({ kind: 'run' as const, id: r.id })),
      }))
      .sort((a, b) => b.value - a.value)
    metrics.push(
      mkMetric({
        id: 'execution-time',
        title: 'Время выполнения запусков',
        chartType: 'bar',
        provenance: 'measured',
        definition: 'Среднее время выполнения (мс) завершённых запусков по связке «бэкенд + модель».',
        method:
          'Измерение: среднее арифметическое durationMs по реальным запускам со статусом completed (origin ≠ demo), сгруппированным по backend и модели.',
        limitations:
          'Время зависит от нагрузки локальной машины/сервиса и длины контекста; малое число замеров делает среднее нестабильным.',
        sampleSize: completed.length,
        versionId,
        series,
        noData: completed.length === 0,
        noDataReason: 'Нет завершённых запусков с измеренным временем выполнения',
      })
    )
  }

  // 10. version-comparison (bar)
  {
    const allAnalyses = await db.analysis.findMany({
      where: { projectId, type: 'local-structural' },
      orderBy: { createdAt: 'desc' },
    })
    const latestAnalysisByVersion = new Map<string, (typeof allAnalyses)[number]>()
    for (const a of allAnalyses) {
      if (!latestAnalysisByVersion.has(a.versionId)) latestAnalysisByVersion.set(a.versionId, a)
    }
    const fragCounts = await db.fragment.groupBy({
      by: ['versionId'],
      where: { version: { projectId } },
      _count: { _all: true },
    })
    const fragCountByVersion = new Map(fragCounts.map((g) => [g.versionId, g._count._all]))

    const versionsSorted = [...allVersions].sort(
      (a, b) => a.importDate.getTime() - b.importDate.getTime()
    )
    const docById = new Map(documents.map((d) => [d.id, d]))
    const multiDoc = documents.length > 1
    const noAnalysisLabels: string[] = []

    const series: MetricSeriesPoint[] = versionsSorted.map((v) => {
      const doc = docById.get(v.documentId)
      const label = multiDoc ? `${doc?.title ?? 'документ'} — ${v.label}` : v.label
      const versionFindings = findings.filter((f) => f.versionId === v.id)
      const parts: Record<string, number> = {
        findings: versionFindings.length,
        fragments: fragCountByVersion.get(v.id) ?? 0,
      }
      const a = latestAnalysisByVersion.get(v.id)
      if (a) {
        const res = safeParse<LocalAnalysisResult>(a.result, EMPTY_ANALYSIS)
        for (const [layer, count] of Object.entries(res.layerCounts ?? {})) {
          parts[layer] = count
        }
      } else {
        noAnalysisLabels.push(label)
        parts.analysis = 0
      }
      return {
        label,
        value: versionFindings.length,
        parts,
        drilldown: [{ kind: 'version' as const, id: v.id }],
      }
    })

    const limitationsBase =
      'Находки привязаны к версии на момент создания; исторические находки не пересчитываются автоматически при смене активной версии.'
    const limitations =
      noAnalysisLabels.length > 0
        ? `${limitationsBase} Для версий без локального анализа (${noAnalysisLabels.join(', ')}) сравнение слоёв неполное — запустите анализ.`
        : limitationsBase

    metrics.push(
      mkMetric({
        id: 'version-comparison',
        title: 'Сравнение версий',
        chartType: 'bar',
        provenance: 'computed',
        definition:
          'Число находок (столбец) и распределение слоёв/фрагментов (доли) по каждой версии документа.',
        method:
          'Для каждой версии проекта: реальные находки по полю versionId + счётчики слоёв из последнего локального структурного анализа этой версии (если анализ выполнялся).',
        limitations,
        sampleSize: versionsSorted.length,
        versionId,
        series,
        noData: versionsSorted.length === 0,
        noDataReason: 'В проекте нет версий документа',
      })
    )
  }

  return {
    projectId,
    versionId: version.id,
    metrics,
    demoExcluded: true,
    generatedAt,
  }
}

// ---------- static metric catalog (RU definitions) ----------

const METRIC_DEFS: Record<
  string,
  { title: string; chartType: MetricDefinition['chartType']; definition: string; method: string; limitations: string }
> = {
  'rule-types-by-section': {
    title: 'Слои правил по разделам',
    chartType: 'stacked-bar',
    definition: 'Число постановок каждого слоя в каждом разделе документа.',
    method: 'Подсчёт по последнему локальному структурному анализу.',
    limitations: 'Лексические эвристики (LOCAL).',
  },
  'scenario-coverage': {
    title: 'Покрытие разделов сценариями',
    chartType: 'bar',
    definition: 'Число сценариев, привязанных к фрагментам раздела.',
    method: 'Подсчёт реальных сценариев по привязке к фрагментам.',
    limitations: 'Учитывается только явная привязка.',
  },
  'definition-density': {
    title: 'Плотность определений и ссылок',
    chartType: 'bar',
    definition: 'Определения + перекрёстные ссылки на разделы.',
    method: 'Подсчёт по аннотациям локального анализа.',
    limitations: 'Эвристическое распознавание определений.',
  },
  'ambiguity-hotspots': {
    title: 'Очаги неоднозначности',
    chartType: 'bar',
    definition: 'Плотность маркеров неоднозначности по разделам.',
    method: 'Сумма маркеров в горячих фрагментах раздела.',
    limitations: 'Лексический сигнал, не доказательство.',
  },
  'findings-distribution': {
    title: 'Распределение находок',
    chartType: 'pie',
    definition: 'Находки по важности.',
    method: 'Подсчёт по severity.',
    limitations: 'Субъективная оценка важности.',
  },
  'runs-by-status': {
    title: 'Запуски по статусам',
    chartType: 'bar',
    definition: 'Запуски по статусам выполнения.',
    method: 'Подсчёт по status.',
    limitations: 'Статус ≠ вердикт.',
  },
  'runs-by-verdict': {
    title: 'Вердикты запусков',
    chartType: 'bar',
    definition: 'Вердикты оценённых запусков.',
    method: 'Подсчёт по verdict.',
    limitations: 'Вердикт может быть модельной оценкой.',
  },
  'evaluator-disagreements': {
    title: 'Расхождения оценщиков',
    chartType: 'list',
    definition: 'Группы оценщиков с разными вердиктами.',
    method: 'Группировка evaluator-запусков по parentRunId.',
    limitations: 'Факт разногласия без объяснения причины.',
  },
  'execution-time': {
    title: 'Время выполнения запусков',
    chartType: 'bar',
    definition: 'Среднее время по бэкенду и модели.',
    method: 'Среднее durationMs завершённых запусков.',
    limitations: 'Зависит от нагрузки и контекста.',
  },
  'version-comparison': {
    title: 'Сравнение версий',
    chartType: 'bar',
    definition: 'Находки и слои по версиям.',
    method: 'Находки по versionId + слои из анализов версий.',
    limitations: 'Исторические находки не пересчитываются.',
  },
}

const METRIC_IDS = Object.keys(METRIC_DEFS)
