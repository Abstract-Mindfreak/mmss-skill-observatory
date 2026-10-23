import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseResearchDiscrepancy } from '@/lib/research-discrepancy'
import { appendUserDecisionHistory } from '@/lib/user-decision-history'
import { recordUserDecision } from '@/lib/user-decision-note'

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const note = await db.note.findFirst({ where: { id, kind: 'objection', author: 'system-proposal' } })
  if (!note) return NextResponse.json({ error: 'Предложенное расхождение не найдено' }, { status: 404 })
  if (!note.versionId) return NextResponse.json({ error: 'У расхождения не указана версия; решение не сохранено.' }, { status: 409 })
  const payload = parseResearchDiscrepancy(note.body)
  if (!payload) return NextResponse.json({ error: 'Формат записи расхождения повреждён' }, { status: 409 })
  const decision = body?.decision
  if (decision !== 'confirmed' && decision !== 'rejected') return NextResponse.json({ error: 'Укажите решение пользователя: confirmed или rejected.' }, { status: 400 })
  const decisionNote = typeof body?.note === 'string' ? body.note.trim() : ''
  if (!decisionNote) return NextResponse.json({ error: 'Добавьте основание пользовательского решения.' }, { status: 400 })
  const newStatus = decision === 'confirmed' ? 'accepted' as const : 'disputed' as const
  const updatedPayload = { ...appendUserDecisionHistory(payload, payload.status, newStatus, decisionNote), userDecision: { decision, note: decisionNote } }
  await db.note.update({ where: { id }, data: { body: JSON.stringify(updatedPayload) } })
  await recordUserDecision({ projectId: note.projectId, versionId: note.versionId, objectType: 'research-discrepancy', objectId: id, previousStatus: payload.status, newStatus, basis: decisionNote })
  return NextResponse.json({ noteId: id, projectId: note.projectId, versionId: note.versionId, createdAt: note.createdAt.toISOString(), payload: updatedPayload })
}
