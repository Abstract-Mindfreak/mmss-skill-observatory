import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildGraph } from '@/lib/graph'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  const version = await db.documentVersion.findUnique({ where: { id } })
  if (!version) {
    return NextResponse.json({ error: 'Версия не найдена' }, { status: 404 })
  }
  const graph = await buildGraph(id)
  if (!graph) {
    return NextResponse.json(
      { error: 'Сначала выполните локальный анализ версии' },
      { status: 404 }
    )
  }
  return NextResponse.json(graph)
}
