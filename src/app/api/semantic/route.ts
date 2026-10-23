import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'
import { hasDiagnosticMarker, isDiagnosticObservation } from '@/lib/semantic-filters'

const required = (v: unknown) => typeof v === 'string' && v.trim().length > 0

export async function GET(req: Request) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId') ?? ''
  const versionId = url.searchParams.get('versionId') ?? ''
  const includeDiagnostics = url.searchParams.get('includeDiagnostics') === '1'
  if (!projectId || !versionId) return NextResponse.json({ error: 'Укажите projectId и versionId' }, { status: 400 })
  const version = await db.documentVersion.findFirst({ where: { id: versionId, projectId } })
  if (!version) return NextResponse.json({ error: 'Версия не принадлежит проекту' }, { status: 404 })
  const [positions, analyses] = await Promise.all([
    db.semanticPosition.findMany({ where: { projectId, versionId }, orderBy: { updatedAt: 'desc' }, include: {
      fragments: { include: { fragment: { select: { id: true, path: true, text: true, title: true } } } },
      outgoingRelations: { include: { targetPosition: { select: { id: true, title: true, status: true } } } },
      incomingRelations: { include: { sourcePosition: { select: { id: true, title: true, status: true } } } },
      observations: { include: { run: { select: { id: true, role: true, origin: true, input: true, output: true, status: true } }, note: { select: { id: true, body: true, origin: true, kind: true } } }, orderBy: { createdAt: 'desc' } },
    } }),
    db.analysis.findMany({ where: { versionId, type: { in: ['model-interpret', 'functional-semantic-contour'] } }, orderBy: { createdAt: 'desc' }, select: { id: true, model: true, backend: true, summary: true, result: true, createdAt: true, type: true } }),
  ])
  const interpretations = analyses.flatMap((analysis) => {
    const result = safeParse<{ items?: Record<string, unknown>[] }>(analysis.result, {})
    if (analysis.type === 'functional-semantic-contour') return (result as unknown as { proposals?: { positions?: Record<string, unknown>[] } }).proposals?.positions?.flatMap((item, proposalIndex) => {
      const fragmentIds = Array.isArray(item.fragmentIds) ? item.fragmentIds.filter((id): id is string => typeof id === 'string') : []
      const fragmentId = fragmentIds[0]
      if (typeof item.purpose !== 'string' || typeof fragmentId !== 'string') return []
      return [{ proposalKey: `${analysis.id}|${proposalIndex}`, analysisId: analysis.id, fragmentId, interpretation: item.purpose, alternatives: [], scopeNote: typeof item.conditions === 'string' ? item.conditions : '', limitations: typeof item.limitations === 'string' ? item.limitations : '', backend: typeof item.requestedBackend === 'string' ? item.requestedBackend : analysis.backend, requestedModel: typeof item.requestedModel === 'string' ? item.requestedModel : analysis.model, actualProvider: typeof item.actualProvider === 'string' ? item.actualProvider : null, actualModel: typeof item.actualModel === 'string' ? item.actualModel : null, createdAt: analysis.createdAt, positionProposal: item }]
    }) ?? []
    return (result.items ?? []).flatMap((item, itemIndex) => (!includeDiagnostics && hasDiagnosticMarker(analysis.summary, item) ? [] : typeof item.fragmentId === 'string' && typeof item.interpretation === 'string' ? [{
      proposalKey: `${analysis.id}|${itemIndex}`, analysisId: analysis.id, fragmentId: item.fragmentId, interpretation: item.interpretation,
      alternatives: Array.isArray(item.alternatives) ? item.alternatives : [],
      scopeNote: typeof item.scopeNote === 'string' ? item.scopeNote : '',
      limitations: typeof item.limitations === 'string' ? item.limitations : '',
      backend: typeof item.backend === 'string' ? item.backend : analysis.backend,
      requestedModel: typeof item.requestedModel === 'string' ? item.requestedModel : analysis.model,
      actualProvider: typeof item.actualProvider === 'string' ? item.actualProvider : null,
      actualModel: typeof item.actualModel === 'string' ? item.actualModel : null,
      createdAt: analysis.createdAt,
    }] : []))
  })
  const visiblePositions = positions.map((position) => ({
    ...position,
    observations: includeDiagnostics ? position.observations : position.observations.filter((observation) => !isDiagnosticObservation({
      observation: observation.observation,
      evidenceText: observation.evidenceText,
      run: observation.run ? { input: safeParse(observation.run.input, {}), output: observation.run.output } : null,
      note: observation.note,
    })),
  }))
  return NextResponse.json({ positions: visiblePositions, interpretations, includeDiagnostics })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || !required(body.projectId) || !required(body.versionId)) return NextResponse.json({ error: 'Укажите проект и версию' }, { status: 400 })
  const projectId = String(body.projectId), versionId = String(body.versionId)
  if (![body.title, body.purpose, body.regulatedDecision, body.conditions, body.expectedBehavior].every(required)) return NextResponse.json({ error: 'Заполните название, назначение, регулируемое решение, условия и ожидаемое поведение' }, { status: 400 })
  const version = await db.documentVersion.findFirst({ where: { id: versionId, projectId } })
  if (!version) return NextResponse.json({ error: 'Версия не принадлежит проекту' }, { status: 400 })
  const fragmentIds = Array.isArray(body.fragmentIds) ? body.fragmentIds.filter((x): x is string => typeof x === 'string') : []
  const fragments = fragmentIds.length ? await db.fragment.findMany({ where: { id: { in: fragmentIds }, versionId } }) : []
  if (fragments.length !== new Set(fragmentIds).size) return NextResponse.json({ error: 'Один или несколько фрагментов не принадлежат выбранной версии' }, { status: 400 })
  const status = 'proposed'
  const provenance = body.provenance === 'model-interpret' ? 'model-interpret' : 'user'
  const provenanceRef = typeof body.provenanceRef === 'string' ? body.provenanceRef : null
  if (provenance === 'model-interpret' && provenanceRef) {
    const analysis = await db.analysis.findFirst({ where: { id: provenanceRef, versionId, type: { in: ['model-interpret', 'functional-semantic-contour'] } } })
    if (!analysis) return NextResponse.json({ error: 'Интерпретация не найдена в выбранной версии' }, { status: 400 })
  }
  const position = await db.semanticPosition.create({ data: {
    projectId, versionId, title: String(body.title).trim(), purpose: String(body.purpose).trim(),
    regulatedDecision: String(body.regulatedDecision).trim(), conditions: String(body.conditions).trim(),
    expectedBehavior: String(body.expectedBehavior).trim(), limitations: typeof body.limitations === 'string' ? body.limitations.trim() : '',
    provenance, provenanceRef, status,
    fragments: { create: fragments.map((fragment) => ({ fragmentId: fragment.id })) },
  } })
  return NextResponse.json({ position }, { status: 201 })
}
