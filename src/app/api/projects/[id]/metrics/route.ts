// GET /api/projects/[id]/metrics?versionId= — MetricsBundle (owner: agent 1-c)
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { computeMetrics } from '@/lib/metrics'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const versionId = new URL(req.url).searchParams.get('versionId') ?? undefined
    const project = await db.project.findUnique({ where: { id } })
    if (!project) {
      return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
    }
    if (versionId) {
      const version = await db.documentVersion.findFirst({
        where: { id: versionId, projectId: id },
      })
      if (!version) {
        return NextResponse.json(
          { error: 'Версия не найдена в этом проекте' },
          { status: 404 }
        )
      }
    }
    const bundle = await computeMetrics(id, versionId)
    if (!bundle) {
      return NextResponse.json(
        { error: 'Не удалось вычислить метрики: проект или версия не найдены' },
        { status: 404 }
      )
    }
    return NextResponse.json(bundle)
  } catch (e) {
    console.error('metrics route error', e)
    return NextResponse.json(
      { error: 'Ошибка вычисления метрик', detail: String(e) },
      { status: 500 }
    )
  }
}
