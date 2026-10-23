// PUT /api/runs/[id]/verdict — user verdict override. The model verdict
// (if any) is preserved in modelVerdict/modelVerdictBy; verdictBy='user'.
// Owned by agent 1-b.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toRunDTO } from '@/lib/serialize'

const VERDICTS = ['pass', 'fail', 'inconclusive'] as const
type VerdictValue = (typeof VERDICTS)[number]

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const run = await db.run.findUnique({ where: { id } })
  if (!run) {
    return NextResponse.json({ error: 'Запуск не найден' }, { status: 404 })
  }

  const body = (await req.json().catch(() => null)) as { verdict?: unknown } | null
  const verdict = body?.verdict
  if (typeof verdict !== 'string' || !(VERDICTS as readonly string[]).includes(verdict)) {
    return NextResponse.json(
      { error: 'verdict должен быть одним из: pass, fail, inconclusive' },
      { status: 400 }
    )
  }

  // Preserve the original model verdict on the first override; keep it on
  // subsequent overrides (it is the historical record of the model's answer).
  const modelVerdict =
    run.modelVerdict ?? (run.verdictBy === 'model' ? run.verdict : null)
  const modelVerdictBy =
    run.modelVerdictBy ?? (run.verdictBy === 'model' ? 'model' : null)

  const updated = await db.run.update({
    where: { id },
    data: {
      verdict: verdict as VerdictValue,
      verdictBy: 'user',
      modelVerdict,
      modelVerdictBy,
    },
  })
  return NextResponse.json(toRunDTO(updated))
}
