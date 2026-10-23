import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const STATUSES = ['unverified', 'error', 'suspected', 'confirmed-instruction-issue', 'supported', 'app-or-check-error']

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const positionId = typeof body?.positionId === 'string' ? body.positionId : ''
  const observation = typeof body?.observation === 'string' ? body.observation.trim() : ''
  const runId = typeof body?.runId === 'string' ? body.runId : null
  const noteId = typeof body?.noteId === 'string' ? body.noteId : null
  if (!positionId || !observation || Boolean(runId) === Boolean(noteId)) return NextResponse.json({ error: 'Укажите положение, наблюдение и ровно один источник Run или Note' }, { status: 400 })
  const position = await db.semanticPosition.findUnique({ where: { id: positionId } })
  if (!position) return NextResponse.json({ error: 'Смысловое положение не найдено' }, { status: 404 })
  const source = runId
    ? await db.run.findFirst({ where: { id: runId, projectId: position.projectId, versionId: position.versionId } })
    : await db.note.findFirst({ where: { id: noteId!, projectId: position.projectId, OR: [{ versionId: null }, { versionId: position.versionId }] } })
  if (!source) return NextResponse.json({ error: 'Источник наблюдения не принадлежит проекту и версии' }, { status: 400 })
  const status = typeof body?.status === 'string' && STATUSES.includes(body.status) ? body.status : 'unverified'
  const row = await db.positionObservation.create({ data: {
    projectId: position.projectId, versionId: position.versionId, positionId,
    runId, noteId, observation, evidenceText: typeof body?.evidenceText === 'string' ? body.evidenceText : '',
    conditions: typeof body?.conditions === 'string' ? body.conditions : '', criterion: typeof body?.criterion === 'string' ? body.criterion : '',
    status, limitations: typeof body?.limitations === 'string' ? body.limitations : '',
  } })
  return NextResponse.json({ observation: row }, { status: 201 })
}
