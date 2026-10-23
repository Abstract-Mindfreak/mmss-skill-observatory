import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toNoteDTO } from '@/lib/serialize'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: Params) {
  const { id } = await params
  const project = await db.project.findUnique({ where: { id } })
  if (!project) {
    return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
  }
  const searchParams = new URL(req.url).searchParams
  const fragmentId = searchParams.get('fragmentId')
  const kind = searchParams.get('kind')

  const notes = await db.note.findMany({
    where: {
      projectId: id,
      ...(fragmentId ? { fragmentId } : {}),
      ...(kind ? { kind } : {}),
    },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json(notes.map(toNoteDTO))
}
