import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { runLocalAnalysis } from '@/lib/analysis'
import { reparseAndAnalyze } from '@/lib/import-doc'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  await req.json().catch(() => null)
  const version = await db.documentVersion.findUnique({ where: { id } })
  if (!version) {
    return NextResponse.json({ error: 'Версия не найдена' }, { status: 404 })
  }

  const fragmentCount = await db.fragment.count({ where: { versionId: id } })
  if (fragmentCount === 0) {
    await reparseAndAnalyze(id)
  } else {
    await runLocalAnalysis(id)
  }

  const analysis = await db.analysis.findFirst({
    where: { versionId: id, type: 'local-structural' },
    orderBy: { createdAt: 'desc' },
  })
  if (!analysis) {
    return NextResponse.json(
      { error: 'Анализ не был сохранён — внутренняя ошибка' },
      { status: 500 }
    )
  }
  const result = JSON.parse(analysis.result) as {
    analysisId: string
    createdAt: string
    durationMs: number
    fragmentCount: number
    [key: string]: unknown
  }
  return NextResponse.json({
    analysis: {
      id: analysis.id,
      createdAt: analysis.createdAt.toISOString(),
      durationMs: analysis.durationMs ?? result.durationMs ?? 0,
      fragmentCount: analysis.fragmentCount ?? result.fragmentCount ?? 0,
    },
    result,
  })
}
