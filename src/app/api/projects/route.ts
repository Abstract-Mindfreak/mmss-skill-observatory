import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toProjectDTO } from '@/lib/serialize'

export async function GET() {
  const projects = await db.project.findMany({ orderBy: { createdAt: 'asc' } })
  return NextResponse.json(projects.map(toProjectDTO))
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) {
    return NextResponse.json({ error: 'Укажите название проекта (name)' }, { status: 400 })
  }
  const description =
    typeof body?.description === 'string' && body.description.trim() ? body.description.trim() : null
  const project = await db.project.create({
    data: { name, description, origin: 'user' },
  })
  return NextResponse.json(toProjectDTO(project), { status: 201 })
}
