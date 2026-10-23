import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const KINDS = ['clarifies', 'limits', 'requires', 'excludes', 'supports', 'potential-conflict']

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const sourceId = typeof body?.sourcePositionId === 'string' ? body.sourcePositionId : ''
  const targetId = typeof body?.targetPositionId === 'string' ? body.targetPositionId : ''
  const kind = typeof body?.kind === 'string' ? body.kind : ''
  const rationale = typeof body?.rationale === 'string' ? body.rationale.trim() : ''
  if (!sourceId || !targetId || sourceId === targetId || !KINDS.includes(kind) || !rationale) return NextResponse.json({ error: 'Укажите разные положения, тип связи и основание' }, { status: 400 })
  const [source, target] = await Promise.all([db.semanticPosition.findUnique({ where: { id: sourceId } }), db.semanticPosition.findUnique({ where: { id: targetId } })])
  if (!source || !target || source.projectId !== target.projectId || source.versionId !== target.versionId) return NextResponse.json({ error: 'Связь можно создать только между положениями одного проекта и версии' }, { status: 400 })
  const relation = await db.semanticRelation.create({ data: {
    projectId: source.projectId, versionId: source.versionId, sourcePositionId: source.id, targetPositionId: target.id,
    kind, rationale, provenance: 'user', status: 'proposed',
  } })
  return NextResponse.json({ relation }, { status: 201 })
}
