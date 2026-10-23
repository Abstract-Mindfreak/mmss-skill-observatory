// POST /api/runs/[id]/cancel — abort a running run. Owned by agent 1-b.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toRunDTO } from '@/lib/serialize'
import { cancelRun } from '@/lib/run-registry'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const run = await db.run.findUnique({ where: { id } })
  if (!run) {
    return NextResponse.json({ error: 'Запуск не найден' }, { status: 404 })
  }
  if (run.status !== 'running') {
    return NextResponse.json({ error: 'Запуск не выполняется' }, { status: 400 })
  }

  // Abort the in-flight request if a live controller exists (it may be
  // missing after a server restart — then only the row state is updated).
  cancelRun(id)

  const updated = await db.run.update({
    where: { id },
    data: { status: 'cancelled', error: null, finishedAt: new Date() },
  })
  return NextResponse.json(toRunDTO(updated))
}
