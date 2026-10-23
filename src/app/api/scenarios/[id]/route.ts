// PATCH/DELETE /api/scenarios/[id]. Owned by agent 1-b.

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

async function scenarioWithCounts(scenarioId: string) {
  const scenario = await db.scenario.findUnique({ where: { id: scenarioId } })
  if (!scenario) return null
  const runs = await db.run.findMany({
    where: { scenarioId },
    orderBy: { createdAt: 'desc' },
    select: { status: true },
  })
  return toScenarioDTO(scenario, {
    runCount: runs.length,
    lastRunStatus: runs[0] ? (runs[0].status as RunStatus) : null,
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const scenario = await db.scenario.findUnique({ where: { id } })
  if (!scenario) {
    return NextResponse.json({ error: 'Сценарий не найден' }, { status: 404 })
  }

  const body = (await req.json().catch(() => null)) as {
    title?: unknown
    description?: unknown
    status?: unknown
    stopReason?: unknown
    pinned?: unknown
    fragmentId?: unknown
  } | null
  if (!body) {
    return NextResponse.json({ error: 'Некорректный JSON в теле запроса' }, { status: 400 })
  }

  const data: {
    title?: string
    description?: string | null
    status?: ScenarioStatus
    stopReason?: string | null
    pinned?: boolean
    fragmentId?: string | null
  } = {}

  if (body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) {
      return NextResponse.json({ error: 'Заголовок сценария не может быть пустым' }, { status: 400 })
    }
    data.title = title
  }
  if (body.description !== undefined) {
    data.description =
      typeof body.description === 'string' && body.description.trim() ? body.description : null
  }
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !(SCENARIO_STATUSES as string[]).includes(body.status)) {
      return NextResponse.json({ error: `Недопустимый статус сценария: ${String(body.status)}` }, { status: 400 })
    }
    data.status = body.status as ScenarioStatus
  }
  if (body.stopReason !== undefined) {
    data.stopReason =
      typeof body.stopReason === 'string' && body.stopReason.trim() ? body.stopReason : null
  }
  if (body.pinned !== undefined) {
    data.pinned = body.pinned === true
  }
  if (body.fragmentId !== undefined) {
    if (body.fragmentId === null || body.fragmentId === '') {
      data.fragmentId = null
    } else if (typeof body.fragmentId === 'string') {
      const fragment = await db.fragment.findUnique({ where: { id: body.fragmentId } })
      if (!fragment) {
        return NextResponse.json({ error: 'Указанный фрагмент не найден' }, { status: 400 })
      }
      data.fragmentId = body.fragmentId
    }
  }

  await db.scenario.update({ where: { id }, data })
  return NextResponse.json(await scenarioWithCounts(id))
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const scenario = await db.scenario.findUnique({ where: { id } })
  if (!scenario) {
    return NextResponse.json({ error: 'Сценарий не найден' }, { status: 404 })
  }

  const children = await db.scenario.count({ where: { parentId: id } })
  if (children > 0) {
    return NextResponse.json(
      { error: 'Сначала удалите или переместите дочерние ветви' },
      { status: 400 }
    )
  }

  // Linked runs are detached (scenarioId → null) via the schema's SetNull rule.
  await db.run.updateMany({ where: { scenarioId: id }, data: { scenarioId: null } })
  await db.scenario.delete({ where: { id } })
  return new NextResponse(null, { status: 204 })
}
