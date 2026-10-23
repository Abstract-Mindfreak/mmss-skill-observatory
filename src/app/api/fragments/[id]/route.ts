import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { safeParse, toFindingDTO, toFragmentDTO, toNoteDTO, toRunDTO, toScenarioDTO } from '@/lib/serialize'
import { sectionPathOf } from '@/lib/analysis'
import { buildGraph } from '@/lib/graph'
import type {
  FragmentAnnotation,
  FragmentCardDTO,
  InterpretationDTO,
  LayerBasis,
  LocalAnalysisResult,
  ProvenanceStatus,
} from '@/lib/types'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  const fragment = await db.fragment.findUnique({ where: { id } })
  if (!fragment) {
    return NextResponse.json({ error: 'Фрагмент не найден' }, { status: 404 })
  }
  const version = await db.documentVersion.findUnique({
    where: { id: fragment.versionId },
  })
  if (!version) {
    return NextResponse.json({ error: 'Версия фрагмента не найдена' }, { status: 404 })
  }

  // sections + structural ancestors
  const versionFragments = await db.fragment.findMany({
    where: { versionId: version.id },
    orderBy: { order: 'asc' },
  })
  const sectionPaths = new Set(
    versionFragments.filter((f) => f.kind === 'section').map((f) => f.path)
  )
  const components = fragment.path.split('.')
  const ancestors: FragmentCardDTO['ancestors'] = []
  for (let k = 1; k < components.length; k++) {
    const prefix = components.slice(0, k).join('.')
    const parent = versionFragments.find(
      (f) =>
        f.path === prefix && (f.kind === 'section' || f.kind === 'paragraph')
    )
    if (parent) {
      ancestors.push({
        id: parent.id,
        kind: parent.kind as 'section' | 'paragraph',
        title: parent.title,
        text: parent.text,
        path: parent.path,
      })
    }
  }

  // latest local analysis of the version
  const analysisRow = await db.analysis.findFirst({
    where: { versionId: version.id, type: 'local-structural' },
    orderBy: { createdAt: 'desc' },
  })
  const analysisResult = analysisRow
    ? safeParse<LocalAnalysisResult | null>(analysisRow.result, null)
    : null
  const annotation: FragmentAnnotation | null =
    analysisResult?.annotations.find((a) => a.fragmentId === id) ?? null
  const layers: LayerBasis[] = annotation?.layers ?? []

  // interpretations: model-interpret analyses mentioning this fragment
  const interpretations: InterpretationDTO[] = []
  const interpretRows = await db.analysis.findMany({
    where: { versionId: version.id, type: 'model-interpret' },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  for (const row of interpretRows) {
    const parsed = safeParse<{ items?: { fragmentId?: string }[] } | null>(row.result, null)
    const item = parsed?.items?.find((it) => it.fragmentId === id)
    if (!item) continue
    interpretations.push({
      id: row.id,
      backend: row.backend,
      model: row.model,
      createdAt: row.createdAt.toISOString(),
      interpretation: String(
        (item as Record<string, unknown>).interpretation ?? ''
      ),
      alternatives: Array.isArray((item as Record<string, unknown>).alternatives)
        ? ((item as Record<string, unknown>).alternatives as string[])
        : [],
      scopeNote: String((item as Record<string, unknown>).scope ?? ''),
      limitations: String((item as Record<string, unknown>).limitations ?? ''),
      analysisType: 'model-interpret',
    })
  }

  // notes attached to this fragment
  const noteRows = await db.note.findMany({
    where: { fragmentId: id },
    orderBy: { createdAt: 'asc' },
  })
  const notes = noteRows.map(toNoteDTO)

  // scenarios: bound to this fragment or to fragments of the same section
  const fragmentSection = sectionPathOf(fragment.path, sectionPaths)
  const fragmentById = new Map(versionFragments.map((f) => [f.id, f]))
  const scenarioRows = await db.scenario.findMany({
    where: { projectId: version.projectId },
    orderBy: { createdAt: 'asc' },
  })
  const scenarioFragmentIds = new Set<string>()
  for (const s of scenarioRows) {
    if (!s.fragmentId) continue
    if (s.fragmentId === id) {
      scenarioFragmentIds.add(s.fragmentId)
      continue
    }
    const f = fragmentById.get(s.fragmentId)
    if (f && fragmentSection && sectionPathOf(f.path, sectionPaths) === fragmentSection) {
      scenarioFragmentIds.add(s.fragmentId)
    }
  }
  const scenarios = scenarioRows
    .filter((s) => s.fragmentId && scenarioFragmentIds.has(s.fragmentId))
    .map((s) => toScenarioDTO(s))

  // latest runs of those scenarios
  const runRows = await db.run.findMany({
    where: { scenarioId: { in: scenarios.map((s) => s.id) } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  const runs = runRows.map(toRunDTO)

  // findings on this fragment
  const findingRows = await db.finding.findMany({
    where: { fragmentId: id },
    orderBy: { createdAt: 'desc' },
  })
  const findings = findingRows.map(toFindingDTO)

  // graph edges touching this fragment
  let graphEdges: FragmentCardDTO['graphEdges'] = []
  try {
    const graph = await buildGraph(version.id)
    if (graph) {
      graphEdges = graph.edges.filter((e) => e.source === id || e.target === id)
    }
  } catch {
    graphEdges = []
  }

  const analysisProvenance: ProvenanceStatus = analysisRow ? 'LOCAL' : 'PLACEHOLDER'
  const limitations = analysisResult?.limitations ?? ['локальный анализ не выполнялся']

  const dto: FragmentCardDTO = {
    fragment: toFragmentDTO(fragment),
    ancestors,
    annotation,
    layers,
    interpretations,
    notes,
    scenarios,
    runs,
    findings,
    graphEdges,
    analysisProvenance,
    limitations,
  }
  return NextResponse.json(dto)
}
