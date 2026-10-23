// GET/POST /api/runs — run list (with stale sweeper) and run creation
// (single or series 1..10). Owned by agent 1-b.

import { NextResponse } from 'next/server'
import type { Run } from '@prisma/client'
import { db } from '@/lib/db'
import { toRunDTO } from '@/lib/serialize'
import type { RoleId } from '@/lib/types'
import {
  createAndRunRun,
  RunValidationError,
  type CreateRunOptions,
  type RunBackend,
} from '@/lib/runner'

const ROLES: RoleId[] = [
  'executor',
  'explorer',
  'evaluator',
  'challenger',
  'editor',
  'assistant',
  'interpreter',
]

export async function GET(req: Request) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  if (!projectId) {
    return NextResponse.json({ error: 'Укажите projectId' }, { status: 400 })
  }
  const limitRaw = Number(url.searchParams.get('limit') ?? '200')
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 500) : 200

  const runs = await db.run.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return NextResponse.json(runs.map(toRunDTO))
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) {
    return NextResponse.json({ error: 'Некорректный JSON в теле запроса' }, { status: 400 })
  }

  const projectId = typeof body.projectId === 'string' ? body.projectId : ''
  const role = typeof body.role === 'string' ? body.role : ''
  const backend = typeof body.backend === 'string' ? body.backend : ''

  if (!projectId) {
    return NextResponse.json({ error: 'Укажите projectId' }, { status: 400 })
  }
  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project) {
    return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
  }
  if (!(ROLES as string[]).includes(role)) {
    return NextResponse.json({ error: `Неизвестная роль: ${role || '(пусто)'}` }, { status: 400 })
  }
  if (backend === 'demo') {
    return NextResponse.json(
      { error: 'Демо-бэкенд доступен только через загрузку DEMO-данных' },
      { status: 400 }
    )
  }
  if (backend === 'session-cloud') {
    return NextResponse.json({ error: 'session-cloud недоступен для локального запуска. Выберите назначение роли в проекте или подключение FreeLLMAPI/Ollama.' }, { status: 400 })
  }
  if (backend !== 'ollama' && backend !== 'freellmapi') {
    return NextResponse.json(
      { error: 'Укажите backend: ollama или freellmapi' },
      { status: 400 }
    )
  }

  const series = body.series as { count?: unknown } | undefined
  let count = 1
  if (series && typeof series === 'object') {
    const raw = series.count
    if (raw === undefined || raw === null) {
      count = 1
    } else if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 10) {
      return NextResponse.json(
        { error: 'Серия запусков: count должен быть целым числом от 1 до 10' },
        { status: 400 }
      )
    } else {
      count = raw
    }
  }

  const settings = (body.settings ?? {}) as {
    temperature?: unknown
    numPredict?: unknown
    timeoutMs?: unknown
    programChecks?: unknown
  }
  const taskContext = (body.taskContext ?? {}) as NonNullable<
    CreateRunOptions['taskContext']
  >

  if (backend === 'ollama' || backend === 'freellmapi') {
    const connectionId = typeof body.connectionId === 'string' ? body.connectionId : ''
    const conn = connectionId ? await db.connection.findUnique({ where: { id: connectionId } }) : null
    if (!conn || (backend === 'freellmapi') !== (conn.kind === 'freellmapi')) {
      return NextResponse.json({ error: `Провайдер ${backend === 'freellmapi' ? 'FreeLLMAPI' : 'Ollama'} не совпадает с выбранным подключением` }, { status: 400 })
    }
  }

  const opts: CreateRunOptions = {
    projectId,
    role: role as RoleId,
    action: typeof body.action === 'string' ? body.action : 'behavior-lab-run',
    backend: backend as RunBackend,
    connectionId: typeof body.connectionId === 'string' && body.connectionId ? body.connectionId : null,
    model: typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null,
    scenarioId: typeof body.scenarioId === 'string' && body.scenarioId ? body.scenarioId : null,
    versionId: typeof body.versionId === 'string' && body.versionId ? body.versionId : null,
    fragmentId: typeof body.fragmentId === 'string' && body.fragmentId ? body.fragmentId : null,
    parentRunId: typeof body.parentRunId === 'string' && body.parentRunId ? body.parentRunId : null,
    prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
    messages: Array.isArray(body.messages)
      ? (body.messages as { role: 'user' | 'assistant'; content: string }[])
      : undefined,
    settings: {
      temperature: typeof settings.temperature === 'number' ? settings.temperature : undefined,
      numPredict: typeof settings.numPredict === 'number' ? settings.numPredict : undefined,
      timeoutMs: typeof settings.timeoutMs === 'number' ? settings.timeoutMs : undefined,
      programChecks: typeof settings.programChecks === 'boolean' ? settings.programChecks : undefined,
    },
    taskContext: {
      scenarioId: typeof taskContext.scenarioId === 'string' ? taskContext.scenarioId : undefined,
      fragmentId: typeof taskContext.fragmentId === 'string' ? taskContext.fragmentId : undefined,
      versionId: typeof taskContext.versionId === 'string' ? taskContext.versionId : undefined,
      criterion: typeof taskContext.criterion === 'string' ? taskContext.criterion : undefined,
      outputToEvaluate:
        typeof taskContext.outputToEvaluate === 'string' ? taskContext.outputToEvaluate : undefined,
      findingId: typeof taskContext.findingId === 'string' ? taskContext.findingId : undefined,
      skillContextMode: taskContext.skillContextMode === 'full' || taskContext.skillContextMode === 'relevant' ? taskContext.skillContextMode : undefined,
      instructionContext: taskContext.instructionContext && typeof taskContext.instructionContext === 'object'
        ? taskContext.instructionContext as NonNullable<CreateRunOptions['taskContext']>['instructionContext']
        : undefined,
    },
    origin: 'real',
  }

  try {
    const runs: Run[] = []
    for (let i = 0; i < count; i++) {
      // Sequential execution: each series item is a separate honest run.
      runs.push(await createAndRunRun(opts))
    }
    return NextResponse.json({ runs: runs.map(toRunDTO) })
  } catch (err) {
    if (err instanceof RunValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
