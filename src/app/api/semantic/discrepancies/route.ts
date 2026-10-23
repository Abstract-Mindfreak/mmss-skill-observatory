import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'
import { makeResearchDiscrepancy, parseResearchDiscrepancy, type DiscrepancyAssessment, type DiscrepancyEvidence } from '@/lib/research-discrepancy'

const ASSESSMENTS = new Set<DiscrepancyAssessment>(['different-criteria', 'potential-contradiction', 'insufficient-basis'])
const strArray = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))] : []

export async function GET(req: Request) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId') ?? ''
  const versionId = url.searchParams.get('versionId') ?? ''
  if (!projectId || !versionId) return NextResponse.json({ error: 'Укажите projectId и versionId' }, { status: 400 })
  const version = await db.documentVersion.findFirst({ where: { id: versionId, projectId }, select: { id: true } })
  if (!version) return NextResponse.json({ error: 'Версия не принадлежит проекту' }, { status: 404 })
  const notes = await db.note.findMany({ where: { projectId, versionId, kind: 'objection', author: 'system-proposal' }, orderBy: { createdAt: 'desc' } })
  return NextResponse.json({ discrepancies: notes.flatMap((note) => { const payload = parseResearchDiscrepancy(note.body); return payload ? [{ noteId: note.id, projectId, versionId, createdAt: note.createdAt.toISOString(), payload }] : [] }) })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  const versionId = typeof body?.versionId === 'string' ? body.versionId : ''
  const assessmentValue = typeof body?.assessment === 'string' ? body.assessment : ''
  const assessment = assessmentValue as DiscrepancyAssessment
  const criterion = typeof body?.criterion === 'string' ? body.criterion.trim() : ''
  const summary = typeof body?.summary === 'string' ? body.summary.trim() : ''
  const runIds = strArray(body?.runIds), observationIds = strArray(body?.observationIds)
  const positionIds = strArray(body?.positionIds), fragmentIds = strArray(body?.fragmentIds)
  const evidence = Array.isArray(body?.evidence) ? body.evidence.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const kinds = new Set(['scenario-criterion', 'run-output', 'local-check', 'observation', 'fragment'])
    if (typeof row.kind !== 'string' || !kinds.has(row.kind) || typeof row.id !== 'string' || !row.id || typeof row.label !== 'string' || !row.label.trim()) return []
    return [{ kind: row.kind as DiscrepancyEvidence['kind'], id: row.id, label: row.label.trim().slice(0, 500), ...(typeof row.excerpt === 'string' ? { excerpt: row.excerpt.slice(0, 4000) } : {}), ...(typeof row.path === 'string' ? { path: row.path.slice(0, 300) } : {}) }]
  }).slice(0, 50) : []
  const limitations = strArray(body?.limitations)
  if (!projectId || !versionId || !ASSESSMENTS.has(assessment) || !criterion || !summary || runIds.length < 2) return NextResponse.json({ error: 'Укажите проект, версию, тип расхождения, критерий, описание и не менее двух Run-оснований.' }, { status: 400 })
  const version = await db.documentVersion.findFirst({ where: { id: versionId, projectId }, select: { id: true } })
  if (!version) return NextResponse.json({ error: 'Версия не принадлежит проекту' }, { status: 400 })
  const [runs, observations, positions, fragments] = await Promise.all([
    db.run.findMany({ where: { id: { in: runIds }, projectId, versionId }, select: { id: true, role: true, input: true } }),
    observationIds.length ? db.positionObservation.findMany({ where: { id: { in: observationIds }, projectId, versionId }, select: { id: true } }) : Promise.resolve([]),
    positionIds.length ? db.semanticPosition.findMany({ where: { id: { in: positionIds }, projectId, versionId }, select: { id: true } }) : Promise.resolve([]),
    fragmentIds.length ? db.fragment.findMany({ where: { id: { in: fragmentIds }, versionId }, select: { id: true } }) : Promise.resolve([]),
  ])
  if (runs.length !== runIds.length || observations.length !== observationIds.length || positions.length !== positionIds.length || fragments.length !== fragmentIds.length) return NextResponse.json({ error: 'Все ссылки расхождения должны принадлежать выбранным проекту и версии.' }, { status: 400 })
  const evaluator = runs.find((run) => run.role === 'evaluator')
  if (!evaluator) return NextResponse.json({ error: 'Для сопоставления требуется сохранённый Evaluator Run.' }, { status: 400 })
  const evaluatorInput = safeParse<{ prompt?: string; sentMessages?: { content: string }[]; taskContext?: { criterion?: string } }>(evaluator.input, {})
  const criterionSources = [evaluatorInput.taskContext?.criterion, evaluatorInput.prompt, ...(evaluatorInput.sentMessages ?? []).map((message) => message.content)].filter((value): value is string => typeof value === 'string')
  if (!criterionSources.some((source) => source.includes(criterion))) return NextResponse.json({ error: 'Критерий не найден в сохранённом Evaluator Run. Скопируйте фактический критерий из карточки запуска.' }, { status: 400 })
  const payload = makeResearchDiscrepancy({ assessment, criterion: criterion.slice(0, 30000), summary: summary.slice(0, 5000), runIds, observationIds, positionIds, fragmentIds, evidence, limitations: limitations.map((item) => item.slice(0, 1000)).slice(0, 50) })
  const note = await db.note.create({ data: { projectId, versionId, kind: 'objection', author: 'system-proposal', origin: 'real', linkedRunId: runIds[0] ?? null, fragmentId: fragmentIds[0] ?? null, body: JSON.stringify(payload) } })
  return NextResponse.json({ noteId: note.id, projectId, versionId, createdAt: note.createdAt.toISOString(), payload }, { status: 201 })
}
