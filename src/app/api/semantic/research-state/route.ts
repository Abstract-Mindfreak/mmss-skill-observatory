import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'
import { parseResearchDiscrepancy } from '@/lib/research-discrepancy'
import { buildResearchState } from '@/lib/research-state'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId') ?? ''
  const versionId = url.searchParams.get('versionId') ?? ''
  if (!projectId || !versionId) return NextResponse.json({ error: 'Укажите projectId и versionId' }, { status: 400 })
  const version = await db.documentVersion.findFirst({ where: { id: versionId, projectId }, select: { id: true } })
  if (!version) return NextResponse.json({ error: 'Версия не принадлежит проекту' }, { status: 404 })
  const fragments = await db.fragment.findMany({ where: { versionId }, select: { id: true } })
  const [positions, relations, versionRuns, observations, vectors, findings, notes, contour] = await Promise.all([
    db.semanticPosition.findMany({ where: { projectId, versionId }, include: { fragments: { select: { fragmentId: true } } } }),
    db.semanticRelation.findMany({ where: { projectId, versionId }, select: { id: true, sourcePositionId: true, targetPositionId: true, status: true } }),
    db.run.findMany({ where: { projectId, versionId, origin: { not: 'demo' } }, select: { id: true, role: true, status: true, scenarioId: true, parentRunId: true, verdict: true, verdictBy: true, input: true } }),
    db.positionObservation.findMany({ where: { projectId, versionId }, select: { id: true, positionId: true, runId: true, status: true } }),
    db.embeddingVector.findMany({ where: { projectId, versionId }, select: { representation: true, positionId: true, status: true, model: true } }),
    db.finding.findMany({ where: { projectId, versionId: versionId }, select: { status: true } }),
    db.note.findMany({ where: { projectId, versionId, kind: 'objection', author: 'system-proposal' }, select: { id: true, body: true } }),
    db.analysis.findFirst({ where: { projectId, versionId, type: 'functional-semantic-contour' }, orderBy: { createdAt: 'desc' }, select: { result: true } }),
  ])
  // Filter against the version's fragment IDs in memory. The version can contain
  // more IDs than SQLite's bind-parameter limit, and Prisma cannot batch this
  // query while a negation filter is present.
  const fragmentIds = new Set(fragments.map((fragment) => fragment.id))
  const projectScenarios = await db.scenario.findMany({ where: { projectId }, select: { id: true, fragmentId: true, origin: true } })
  const linkedScenarios = projectScenarios.filter((scenario) => scenario.origin !== 'demo' && scenario.fragmentId !== null && fragmentIds.has(scenario.fragmentId))
  const scenarioIds = [...new Set([...versionRuns.flatMap((run) => run.scenarioId ? [run.scenarioId] : []), ...linkedScenarios.map((row) => row.id)])]
  const scenarios = scenarioIds.length ? await db.scenario.findMany({ where: { projectId, id: { in: scenarioIds }, origin: { not: 'demo' } }, select: { id: true, title: true, status: true, origin: true, fragmentId: true } }) : []
  const discrepancies = notes.flatMap((note) => { const payload = parseResearchDiscrepancy(note.body); return payload ? [{ noteId: note.id, payload }] : [] })
  const contourState = contour ? safeParse<{ coverage?: { status?: string }[] } | null>(contour.result, null) : null
  const contourCoverage = contourState?.coverage?.reduce<Record<string, number>>((result, row) => { const key = row.status ?? 'unknown'; result[key] = (result[key] ?? 0) + 1; return result }, {}) ?? null
  const runRows = versionRuns.map((run) => ({ ...run, programChecks: safeParse<{ programChecks?: { passed: boolean; status?: string }[] }>(run.input, {}).programChecks ?? [] }))
  const state = buildResearchState({
    projectId, versionId,
    positions: positions.map((position) => ({ id: position.id, title: position.title, status: position.status, fragmentIds: position.fragments.map((link) => link.fragmentId) })),
    relations, scenarios, runs: runRows, observations, vectors, findings, discrepancies, contourCoverage,
  })
  return NextResponse.json(state)
}
