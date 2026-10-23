import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toNoteDTO } from '@/lib/serialize'

type Params = { params: Promise<{ id: string }> }

const NOTE_KINDS = ['note', 'interpretation', 'objection', 'user-verdict', 'todo']

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  const note = await db.note.findUnique({ where: { id } })
  if (!note) {
    return NextResponse.json({ error: 'Заметка не найдена' }, { status: 404 })
  }
  const data: { body?: string; kind?: string } = {}
  if (typeof body?.body === 'string') {
    if (!body.body.trim()) {
      return NextResponse.json({ error: 'Текст заметки не может быть пустым' }, { status: 400 })
    }
    data.body = body.body.trim()
  }
  if (typeof body?.kind === 'string') {
    if (!NOTE_KINDS.includes(body.kind)) {
      return NextResponse.json(
        { error: `Недопустимый тип заметки. Допустимо: ${NOTE_KINDS.join(', ')}` },
        { status: 400 }
      )
    }
    data.kind = body.kind
  }
  const updated = await db.note.update({ where: { id }, data })
  return NextResponse.json(toNoteDTO(updated))
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params
  const note = await db.note.findUnique({ where: { id } })
  if (!note) {
    return NextResponse.json({ error: 'Заметка не найдена' }, { status: 404 })
  }
  await db.note.delete({ where: { id } })
  return new NextResponse(null, { status: 204 })
}
