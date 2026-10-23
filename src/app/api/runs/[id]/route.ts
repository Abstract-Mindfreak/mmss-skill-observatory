// GET /api/runs/[id] — full run (input/output) with stale sweeper.
// Owned by agent 1-b.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toRunDTO } from '@/lib/serialize'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const run = await db.run.findUnique({ where: { id } })
  if (!run) {
    return NextResponse.json({ error: 'Запуск не найден' }, { status: 404 })
  }
  return NextResponse.json(toRunDTO(run))
}
