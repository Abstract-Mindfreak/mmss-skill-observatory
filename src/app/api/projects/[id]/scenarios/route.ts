// GET/POST /api/projects/[id]/scenarios — scenario tree (flat list with
// runCount/lastRunStatus) and scenario creation. Owned by agent 1-b.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toScenarioDTO } from '@/lib/serialize'
import type { RunStatus, ScenarioStatus } from '@/lib/types'

const SCENARIO_STATUSES: ScenarioStatus[] = [
  'unexplored',
  'explored',
  'synthetic',
  'run-verified',
  'disputed',
  'stopped',
]

const SCENARIO_ORIGINS = ['user', 'model', 'seed', 'demo'] as const

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const project = await db.project.findUnique({ where: { id } })
  if (!project) {
    return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
  }

  const scenarios = await db.scenario.findMany({
    where: { projectId: id },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })
  const ids = scenarios.map((s) => s.id)
  const runs = ids.length
    ? await db.run.findMany({
        where: { scenarioId: { in: ids } },
        orderBy: { createdAt: 'desc' },
        select: { scenarioId: true, status: true },
      })
    : []

  const countMap = new Map<string, number>()
  const lastStatusMap = new Map<string, RunStatus>()
  for (const r of runs) {
    if (!r.scenarioId) continue
    countMap.set(r.scenarioId, (countMap.get(r.scenarioId) ?? 0) + 1)
    if (!lastStatusMap.has(r.scenarioId)) {
      lastStatusMap.set(r.scenarioId, r.status as RunStatus)
    }
  }

  return NextResponse.json(
    scenarios.map((s) =>
      toScenarioDTO(s, {
        runCount: countMap.get(s.id) ?? 0,
        lastRunStatus: lastStatusMap.get(s.id) ?? null,
      })
    )
  )
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const project = await db.project.findUnique({ where: { id } })
  if (!project) {
    return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
  }

  const body = (await req.json().catch(() => null)) as {
    parentId?: unknown
    title?: unknown
    description?: unknown
    fragmentId?: unknown
    status?: unknown
    origin?: unknown
  } | null
  if (!body) {
    return NextResponse.json({ error: 'Некорректный JSON в теле запроса' }, { status: 400 })
  }

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) {
    return NextResponse.json({ error: 'Укажите заголовок сценария (title)' }, { status: 400 })
  }

  const parentId = typeof body.parentId === 'string' && body.parentId ? body.parentId : null
  if (parentId) {
    const parent = await db.scenario.findUnique({ where: { id: parentId } })
    if (!parent || parent.projectId !== id) {
      return NextResponse.json(
        { error: 'Родительский сценарий не найден в этом проекте' },
        { status: 400 }
      )
    }
  }

  const status =
    typeof body.status === 'string' && (SCENARIO_STATUSES as string[]).includes(body.status)
      ? (body.status as ScenarioStatus)
      : 'unexplored'
  const origin =
    typeof body.origin === 'string' && (SCENARIO_ORIGINS as readonly string[]).includes(body.origin)
      ? (body.origin as (typeof SCENARIO_ORIGINS)[number])
      : 'user'

  const fragmentId = typeof body.fragmentId === 'string' && body.fragmentId ? body.fragmentId : null
  if (fragmentId) {
    const fragment = await db.fragment.findUnique({ where: { id: fragmentId } })
    if (!fragment) {
      return NextResponse.json({ error: 'Указанный фрагмент не найден' }, { status: 400 })
    }
  }

  const created = await db.scenario.create({
    data: {
      projectId: id,
      parentId,
      title,
      description: typeof body.description === 'string' && body.description.trim() ? body.description : null,
      status,
      origin,
      fragmentId,
      order: 0,
    },
  })
  return NextResponse.json(toScenarioDTO(created, { runCount: 0, lastRunStatus: null }))
}
