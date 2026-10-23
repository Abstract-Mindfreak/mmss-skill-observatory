import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toNoteDTO } from '@/lib/serialize'

const NOTE_KINDS = ['note', 'interpretation', 'objection', 'user-verdict', 'todo']

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  const noteBody = typeof body?.body === 'string' ? body.body.trim() : ''
  if (!projectId) {
    return NextResponse.json({ error: 'Укажите проект (projectId)' }, { status: 400 })
  }
  if (!noteBody) {
    return NextResponse.json({ error: 'Текст заметки обязателен' }, { status: 400 })
  }
  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project) {
    return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
  }

  const kind =
    typeof body?.kind === 'string' && NOTE_KINDS.includes(body.kind) ? body.kind : 'note'
  const fragmentId =
    typeof body?.fragmentId === 'string' && body.fragmentId ? body.fragmentId : null
  const versionId =
    typeof body?.versionId === 'string' && body.versionId ? body.versionId : null

  if (fragmentId) {
    const fragment = await db.fragment.findUnique({ where: { id: fragmentId } })
    if (!fragment) {
      return NextResponse.json({ error: 'Фрагмент не найден' }, { status: 400 })
    }
    const fragmentVersion = await db.documentVersion.findUnique({
      where: { id: fragment.versionId },
    })
    if (!fragmentVersion || fragmentVersion.projectId !== projectId) {
      return NextResponse.json(
        { error: 'Фрагмент принадлежит другому проекту' },
        { status: 400 }
      )
    }
  }
  if (versionId) {
    const version = await db.documentVersion.findUnique({ where: { id: versionId } })
    if (!version || version.projectId !== projectId) {
      return NextResponse.json(
        { error: 'Версия принадлежит другому проекту' },
        { status: 400 }
      )
    }
  }

  const note = await db.note.create({
    data: {
      projectId,
      versionId,
      fragmentId,
      kind,
      body: noteBody,
      author: 'user',
      origin: 'real',
    },
  })
  return NextResponse.json(toNoteDTO(note), { status: 201 })
}
