import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createDocumentWithVersion, loadDocumentDTO } from '@/lib/import-doc'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  const project = await db.project.findUnique({ where: { id } })
  if (!project) {
    return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
  }

  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const content = typeof body?.content === 'string' ? body.content : ''
  if (!title) {
    return NextResponse.json({ error: 'Укажите название документа (title)' }, { status: 400 })
  }
  if (!content.trim()) {
    return NextResponse.json({ error: 'Содержимое документа пустое' }, { status: 400 })
  }
  const source = body?.source === 'upload' ? 'upload' : 'paste'
  const knownVersion =
    typeof body?.knownVersion === 'string' && body.knownVersion.trim()
      ? body.knownVersion.trim()
      : null
  const sourceUrl =
    typeof body?.sourceUrl === 'string' && body.sourceUrl.trim() ? body.sourceUrl.trim() : null
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null

  const { document } = await createDocumentWithVersion({
    projectId: id,
    title,
    content,
    source,
    sourceUrl,
    knownVersion,
    note,
    label: 'origin',
    kind: 'original',
    completeness: 'full',
    isActive: true,
  })

  const dto = await loadDocumentDTO(document.id)
  return NextResponse.json(dto, { status: 201 })
}
