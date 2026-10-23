// POST/DELETE /api/projects/[id]/demo — load / purge DEMO data
// (origin='demo' only; idempotent on load). Owned by agent 1-b.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { purgeDemoData, seedDemoData } from '@/lib/demo-data'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const project = await db.project.findUnique({ where: { id } })
  if (!project) {
    return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
  }
  try {
    const { counts, existed } = await seedDemoData(id)
    return NextResponse.json({
      counts,
      ...(existed ? { note: 'DEMO-данные уже загружены' } : {}),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const project = await db.project.findUnique({ where: { id } })
  if (!project) {
    return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
  }
  try {
    const counts = await purgeDemoData(id)
    return NextResponse.json({ counts })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
