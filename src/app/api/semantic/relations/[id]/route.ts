import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordUserDecision } from '@/lib/user-decision-note'

const STATUSES = ['proposed', 'accepted', 'disputed']

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body.status !== 'string' || !STATUSES.includes(body.status)) {
    return NextResponse.json({ error: 'Укажите статус: proposed, accepted или disputed' }, { status: 400 })
  }
  const relation = await db.semanticRelation.findUnique({ where: { id } })
  if (!relation) return NextResponse.json({ error: 'Смысловая связь не найдена' }, { status: 404 })
  const basis = typeof body.basis === 'string' ? body.basis.trim() : ''
  if (body.status !== relation.status && !basis) return NextResponse.json({ error: 'Для изменения статуса укажите основание решения.' }, { status: 400 })
  if (body.status !== relation.status) await recordUserDecision({ projectId: relation.projectId, versionId: relation.versionId, objectType: 'semantic-relation', objectId: id, previousStatus: relation.status, newStatus: body.status, basis })
  const updated = await db.semanticRelation.update({ where: { id }, data: { status: body.status } })
  return NextResponse.json({ relation: updated })
}
