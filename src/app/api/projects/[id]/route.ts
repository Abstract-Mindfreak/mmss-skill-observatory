import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toProjectDTO } from '@/lib/serialize'
import { loadDocumentDTOs } from '@/lib/import-doc'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  const project = await db.project.findUnique({ where: { id } })
  if (!project) {
    return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
  }
  const documents = await loadDocumentDTOs(id)
  return NextResponse.json({ project: toProjectDTO(project), documents })
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Некорректное тело запроса' }, { status: 400 })
  }
  const project = await db.project.findUnique({ where: { id } })
  if (!project) {
    return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
  }

  if (body.activeVersionId !== undefined && body.activeVersionId !== null) {
    const version = await db.documentVersion.findUnique({
      where: { id: String(body.activeVersionId) },
    })
    if (!version || version.projectId !== id) {
      return NextResponse.json(
        { error: 'Версия не принадлежит этому проекту' },
        { status: 400 }
      )
    }
    await db.documentVersion.updateMany({
      where: { documentId: version.documentId, isActive: true },
      data: { isActive: false },
    })
    await db.documentVersion.update({
      where: { id: version.id },
      data: { isActive: true },
    })
  }

  const data: { name?: string; description?: string } = {}
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim()
  if (typeof body.description === 'string') data.description = body.description.trim() || null
  const updated = await db.project.update({ where: { id }, data })
  const documents = await loadDocumentDTOs(id)
  return NextResponse.json({ project: toProjectDTO(updated), documents })
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params
  const project = await db.project.findUnique({ where: { id } })
  if (!project) {
    return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
  }
  await db.project.delete({ where: { id } })
  return new NextResponse(null, { status: 204 })
}
