import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordUserDecision } from '@/lib/user-decision-note'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const position = await db.semanticPosition.findUnique({ where: { id } })
  if (!position) return NextResponse.json({ error: 'Смысловое положение не найдено' }, { status: 404 })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 })
  const fields = ['title', 'purpose', 'regulatedDecision', 'conditions', 'expectedBehavior', 'limitations'] as const
  const data: Record<string, string> = {}
  for (const field of fields) if (typeof body[field] === 'string') data[field] = body[field] as string
  if (body.status === 'proposed' || body.status === 'accepted' || body.status === 'disputed') {
    if (body.status !== position.status) {
      const basis = typeof body.decisionBasis === 'string' ? body.decisionBasis.trim() : ''
      if (!basis) return NextResponse.json({ error: 'Для изменения статуса укажите основание решения.' }, { status: 400 })
      data.status = body.status
      await recordUserDecision({ projectId: position.projectId, versionId: position.versionId, objectType: 'semantic-position', objectId: id, previousStatus: position.status, newStatus: body.status, basis })
    }
  }
  if (Array.isArray(body.fragmentIds)) {
    const ids = body.fragmentIds.filter((x): x is string => typeof x === 'string')
    const fragments = ids.length ? await db.fragment.findMany({ where: { id: { in: ids }, versionId: position.versionId } }) : []
    if (fragments.length !== new Set(ids).size) return NextResponse.json({ error: 'Фрагменты должны принадлежать версии положения' }, { status: 400 })
    await db.$transaction([
      db.semanticPositionFragment.deleteMany({ where: { semanticPositionId: id } }),
      ...fragments.map((fragment) => db.semanticPositionFragment.create({ data: { semanticPositionId: id, fragmentId: fragment.id } })),
    ])
  }
  const updated = await db.semanticPosition.update({ where: { id }, data })
  return NextResponse.json({ position: updated })
}
