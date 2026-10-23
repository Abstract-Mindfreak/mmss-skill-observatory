import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'
import { parseDocument } from '@/lib/parser'
import {
  analyzeParsed,
  sectionPathOf,
  type AnalysisScenario,
  type AnalyzableFragment,
} from '@/lib/analysis'
import { buildGraph } from '@/lib/graph'
import { diffVersions } from '@/lib/diff'
import type { Fragment } from '@prisma/client'
import type { GraphData, GraphEdge, ImpactResult, LayerId, LocalAnalysisResult } from '@/lib/types'
import { GRAPH_EDGE_KIND_TITLES } from '@/lib/types'

type Params = { params: Promise<{ id: string }> }

const ALL_LAYERS: LayerId[] = [
  'obligation', 'prohibition', 'permission', 'recommendation', 'condition',
  'exception', 'definition', 'identifier', 'evidence', 'unknown', 'ambiguity',
  'repetition', 'conflict', 'missing-link', 'coverage',
]

function mostSpecificCovering(
  fragments: { id: string; path: string; kind: string; startLine: number; endLine: number }[],
  line: number
): { id: string; path: string }[] {
  const covering = fragments.filter((f) => f.startLine <= line && line <= f.endLine)
  if (covering.length === 0) return []
  const maxStart = Math.max(...covering.map((f) => f.startLine))
  return covering.filter((f) => f.startLine === maxStart)
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  const version = await db.documentVersion.findUnique({ where: { id } })
  if (!version) {
    return NextResponse.json({ error: 'Версия не найдена' }, { status: 404 })
  }
  const newContent = typeof body?.newContent === 'string' ? body.newContent : ''
  if (!newContent.trim()) {
    return NextResponse.json(
      { error: 'Передайте новое содержимое (newContent) для оценки последствий' },
      { status: 400 }
    )
  }

  // --- literal diff ---
  const diff = diffVersions(version.content, newContent)

  // --- in-memory parse of the new content ---
  const parsedNew = parseDocument(newContent)
  const newFragments: AnalyzableFragment[] = parsedNew.map((f, i) => ({ ...f, id: `new:${i}` }))
  const newSections = new Map<string, { path: string; title: string | null }>()
  for (const f of newFragments) {
    if (f.kind === 'section' && !newSections.has(f.path)) {
      newSections.set(f.path, { path: f.path, title: f.title })
    }
  }
  const newSectionPaths = new Set(newSections.keys())

  // --- base fragments & analysis ---
  const baseFragmentRows: Fragment[] = await db.fragment.findMany({
    where: { versionId: id },
    orderBy: { order: 'asc' },
  })
  const baseSections = new Map<string, { path: string; title: string | null }>()
  for (const f of baseFragmentRows) {
    if (f.kind === 'section' && !baseSections.has(f.path)) {
      baseSections.set(f.path, { path: f.path, title: f.title })
    }
  }
  const baseSectionPaths = new Set(baseSections.keys())
  const baseAnalysisRow = await db.analysis.findFirst({
    where: { versionId: id, type: 'local-structural' },
    orderBy: { createdAt: 'desc' },
  })
  const baseResult = baseAnalysisRow
    ? safeParse<LocalAnalysisResult | null>(baseAnalysisRow.result, null)
    : null

  // --- changed lines -> changed sections and fragments ---
  const changedBaseIds = new Set<string>()
  const changedNewIds = new Set<string>()
  const changedSections = new Set<string>()
  for (const hunk of diff.hunks) {
    for (const op of hunk.ops) {
      if (op.type === 'remove' && op.aLine !== undefined) {
        for (const f of mostSpecificCovering(baseFragmentRows, op.aLine)) {
          changedBaseIds.add(f.id)
          const sp = sectionPathOf(f.path, baseSectionPaths)
          if (sp) changedSections.add(sp)
        }
      } else if (op.type === 'add' && op.bLine !== undefined) {
        for (const f of mostSpecificCovering(newFragments, op.bLine)) {
          changedNewIds.add(f.id)
          const sp = sectionPathOf(f.path, newSectionPaths)
          if (sp) changedSections.add(sp)
        }
      }
    }
  }

  // --- layer deltas (in-memory analysis of the new content) ---
  const scenarios = await db.scenario.findMany({ where: { projectId: version.projectId } })
  const fragmentById = new Map(baseFragmentRows.map((f) => [f.id, f]))
  const scenarioInput: AnalysisScenario[] = scenarios.map((s) => ({
    id: s.id,
    title: s.title,
    fragmentId: s.fragmentId,
    sectionPath:
      s.fragmentId && fragmentById.has(s.fragmentId)
        ? sectionPathOf(fragmentById.get(s.fragmentId)!.path, baseSectionPaths)
        : null,
  }))
  const newResult = analyzeParsed(newFragments, newSections, scenarioInput)

  const baseCounts = baseResult?.layerCounts ?? {}
  const newAnnotationsById = new Map(newResult.annotations.map((a) => [a.fragmentId, a]))
  const layerChanges = ALL_LAYERS.filter(
    (layer) => (baseCounts[layer] ?? 0) !== (newResult.layerCounts[layer] ?? 0)
  ).map((layer) => {
    const fragmentIds = newResult.annotations
      .filter((a) => a.layers.some((l) => l.layer === layer))
      .map((a) => a.fragmentId)
    return {
      layer,
      baseCount: baseCounts[layer] ?? 0,
      newCount: newResult.layerCounts[layer] ?? 0,
      delta: (newResult.layerCounts[layer] ?? 0) - (baseCounts[layer] ?? 0),
      fragmentIds,
    }
  })

  // --- affected terms of changed fragments ---
  const affectedTerms = new Set<string>()
  if (baseResult) {
    for (const ann of baseResult.annotations) {
      if (!changedBaseIds.has(ann.fragmentId)) continue
      for (const term of ann.terms) affectedTerms.add(term)
    }
  }
  for (const ann of newResult.annotations) {
    if (!changedNewIds.has(ann.fragmentId)) continue
    for (const term of ann.terms) affectedTerms.add(term)
  }

  // --- related fragments: graph neighbours of changed base fragments ---
  const relatedFragments: { fragmentId: string; reason: string }[] = []
  {
    let graph: GraphData | null = null
    try {
      graph = await buildGraph(id)
    } catch {
      graph = null
    }
    if (graph) {
      const reasonsByFragment = new Map<string, string[]>()
      const addReason = (fragmentId: string, reason: string) => {
        if (!reasonsByFragment.has(fragmentId)) reasonsByFragment.set(fragmentId, [])
        const list = reasonsByFragment.get(fragmentId)!
        if (list.length < 3 && !list.includes(reason)) list.push(reason)
      }
      for (const edge of graph.edges) {
        const title = GRAPH_EDGE_KIND_TITLES[edge.kind] ?? edge.kind
        if (changedBaseIds.has(edge.source) && !changedBaseIds.has(edge.target)) {
          addReason(edge.target, `${title}: ${edge.basis.detail}`)
        }
        if (changedBaseIds.has(edge.target) && !changedBaseIds.has(edge.source)) {
          addReason(edge.source, `${title}: ${edge.basis.detail}`)
        }
      }
      for (const [fragmentId, reasons] of reasonsByFragment) {
        relatedFragments.push({ fragmentId, reason: reasons.join('; ') })
      }
      relatedFragments.sort((a, b) => a.fragmentId.localeCompare(b.fragmentId))
    }
  }

  // --- scenarios to re-run: linked to changed sections ---
  const scenariosToRerun = scenarios
    .filter((s) => {
      if (!s.fragmentId) return false
      const f = fragmentById.get(s.fragmentId)
      if (!f) return false
      const sp = sectionPathOf(f.path, baseSectionPaths)
      return sp !== null && changedSections.has(sp)
    })
    .map((s) => {
      const f = fragmentById.get(s.fragmentId!)!
      const sp = sectionPathOf(f.path, baseSectionPaths)
      return {
        scenarioId: s.id,
        title: s.title,
        reason: `сценарий привязан к изменённому разделу ${sp}`,
      }
    })

  // --- stale results bound to this version ---
  const staleResults: ImpactResult['staleResults'] = []
  const versionAnalyses = await db.analysis.findMany({
    where: { versionId: id },
    orderBy: { createdAt: 'desc' },
  })
  for (const a of versionAnalyses) {
    staleResults.push({
      kind: a.type === 'model-interpret' ? 'interpretation' : 'analysis',
      id: a.id,
      label: a.type === 'model-interpret' ? 'интерпретации модели' : 'локальный анализ',
      reason: `анализ «${a.type}» от ${a.createdAt.toISOString().slice(0, 16).replace('T', ' ')} вычислен для предыдущего содержимого и станет устаревшим (STALE) после сохранения правки`,
    })
  }
  const versionRuns = await db.run.findMany({
    where: { versionId: id },
    orderBy: { createdAt: 'desc' },
  })
  for (const r of versionRuns) {
    staleResults.push({
      kind: 'run',
      id: r.id,
      label: 'запуски',
      reason: `запуск роли ${r.role} (${r.status}) от ${r.createdAt.toISOString().slice(0, 16).replace('T', ' ')} относится к предыдущему содержимому`,
    })
  }
  const versionFindings = await db.finding.findMany({
    where: { versionId: id },
    orderBy: { createdAt: 'desc' },
  })
  for (const f of versionFindings) {
    staleResults.push({
      kind: 'finding',
      id: f.id,
      label: 'находки',
      reason: `находка «${f.title}» относится к предыдущему содержимому версии`,
    })
  }

  // --- cost estimate ---
  const connectionCount = await db.connection.count()
  const hasModelBackend = connectionCount > 0
  const rerunCount = scenariosToRerun.length
  const costEstimate: ImpactResult['costEstimate'] = [
    {
      kind: 'A',
      title: 'Локальный пересчёт анализа',
      description:
        'Повторный локальный структурный анализ и граф новой версии — без обращений к модели',
      estimatedRequests: 0,
      estimatedSeconds: 2,
      available: true,
    },
    {
      kind: 'B',
      title: 'Интерпретация изменений моделью',
      description: hasModelBackend
        ? 'Один запрос модели для интерпретации изменённых фрагментов'
        : 'Один запрос модели для интерпретации изменённых фрагментов (подключение модели не настроено)',
      estimatedRequests: 1,
      estimatedSeconds: null,
      available: hasModelBackend,
    },
    {
      kind: 'C',
      title: 'Повторные проверки сценариев',
      description: `Повторные запуски по сценариям изменённых разделов: ${rerunCount}. Оценка времени зависит от модели`,
      estimatedRequests: rerunCount,
      estimatedSeconds: null,
      available: hasModelBackend,
    },
    {
      kind: 'D',
      title: 'Сравнение результатов',
      description:
        'Сопоставление новых и прежних результатов (слои, находки, вердикты) — локальная операция',
      estimatedRequests: 0,
      estimatedSeconds: 1,
      available: true,
    },
  ]

  const result: ImpactResult = {
    analysisId: baseResult?.analysisId ?? 'in-memory',
    baseVersionId: id,
    newVersionId: 'unsaved',
    literalChanges: {
      addedLines: diff.addedLines,
      removedLines: diff.removedLines,
      changedSections: [...changedSections].sort(),
      changedFragmentIds: [...changedBaseIds, ...changedNewIds],
    },
    layerChanges,
    affectedTerms: [...affectedTerms],
    relatedFragments: relatedFragments.slice(0, 100),
    scenariosToRerun,
    staleResults,
    costEstimate,
    limitations: [
      'Правка не сохранена — это предпросмотр последствий',
      'Сопоставление фрагментов выполняется по строкам и структуре разделов; при сильной перестановке текста соответствие приблизительное',
      'Оценка времени запросов к модели зависит от локального сервиса и не может быть предсказана точно',
    ],
  }
  return NextResponse.json(result)
}
