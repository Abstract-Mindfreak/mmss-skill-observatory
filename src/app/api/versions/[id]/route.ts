import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { loadVersionDTO } from '@/lib/import-doc'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  const version = await db.documentVersion.findUnique({ where: { id } })
  if (!version) {
    return NextResponse.json({ error: 'Версия не найдена' }, { status: 404 })
  }
  return NextResponse.json({ version: await loadVersionDTO(version), content: version.content })
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  const version = await db.documentVersion.findUnique({ where: { id } })
  if (!version) {
    return NextResponse.json({ error: 'Версия не найдена' }, { status: 404 })
  }

  if (body?.isActive === true) {
    await db.documentVersion.updateMany({
      where: { documentId: version.documentId, isActive: true, NOT: { id: version.id } },
      data: { isActive: false },
    })
  }

  const data: { label?: string; note?: string; isActive?: boolean } = {}
  if (typeof body?.label === 'string' && body.label.trim()) data.label = body.label.trim()
  if (typeof body?.note === 'string') data.note = body.note.trim() || null
  if (typeof body?.isActive === 'boolean') data.isActive = body.isActive

  const updated = await db.documentVersion.update({ where: { id }, data })
  return NextResponse.json({
    version: await loadVersionDTO(updated),
    content: updated.content,
  })
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params
  const version = await db.documentVersion.findUnique({ where: { id } })
  if (!version) {
    return NextResponse.json({ error: 'Версия не найдена' }, { status: 404 })
  }
  if (version.kind !== 'experimental') {
    return NextResponse.json(
      { error: 'Удалять можно только экспериментальные версии — базовый документ сохраняется' },
      { status: 400 }
    )
  }
  await db.documentVersion.delete({ where: { id } })
  return new NextResponse(null, { status: 204 })
}
