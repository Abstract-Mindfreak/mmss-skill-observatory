// POST /api/runs/[id]/retry — create a NEW run with the same parameters
// and execute it (the original run is never mutated). Owned by agent 1-b.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { safeParse, toRunDTO } from '@/lib/serialize'
import type { RoleId, RunInputDTO } from '@/lib/types'
import {
  createAndRunRun,
  RunValidationError,
  type CreateRunOptions,
  type StoredRunInput,
} from '@/lib/runner'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => null) as { projectId?: unknown } | null
  const run = await db.run.findUnique({ where: { id } })
  if (!run) {
    return NextResponse.json({ error: 'Запуск не найден' }, { status: 404 })
  }
  if (typeof body?.projectId === 'string' && body.projectId !== run.projectId) return NextResponse.json({ error: 'Run не принадлежит выбранному проекту.' }, { status: 404 })
  if (run.status === 'running' || run.status === 'queued') return NextResponse.json({ error: 'Исходный Run ещё выполняется; повтор запрещён, чтобы не создать дубликат.' }, { status: 409 })
  if (run.origin === 'demo' || run.backend === 'demo') {
    return NextResponse.json(
      { error: 'DEMO-запуски нельзя повторить — создайте реальный запуск' },
      { status: 400 }
    )
  }
  if (run.backend === 'session-cloud') {
    const assignment = await db.assignment.findUnique({ where: { projectId_role: { projectId: run.projectId, role: run.role } } })
    const currentAssignment = assignment?.backend === 'ollama' || assignment?.backend === 'freellmapi'
      ? ` Текущее назначение роли: ${assignment.backend} · ${assignment.model ?? 'модель не выбрана'}.`
      : ''
    return NextResponse.json(
      { error: `Этот запуск сохранён с недоступным session-cloud и не изменён. Создайте новый запуск с явным выбором подключения или текущим назначением роли.${currentAssignment}` },
      { status: 409 }
    )
  }

  const input = safeParse<StoredRunInput | null>(run.input, null)
  if (!Array.isArray(input?.sentMessages) || input.sentMessages.length === 0) {
    return NextResponse.json(
      { error: 'Состав отправленных сообщений этого исторического запуска неизвестен, поэтому точный повтор невозможен. История сохранена; создайте новый запуск и явно выберите версию и режим контекста.' },
      { status: 409 }
    )
  }
  const recentRetries = await db.run.findMany({ where: { projectId: run.projectId, role: run.role }, orderBy: { createdAt: 'desc' }, take: 100, select: { status: true, input: true } })
  const existingRetry = recentRetries.some((candidate) => {
    const retryInput = safeParse<StoredRunInput | null>(candidate.input, null)
    return retryInput?.processControlHistory?.some((entry) => entry.action === 'retry-created' && entry.relatedRunId === run.id) && ['queued', 'running'].includes(candidate.status)
  })
  if (existingRetry) return NextResponse.json({ error: 'Повтор этого Run уже выполняется. Дождитесь его завершения перед новым повтором.' }, { status: 409 })
  const taskContext = (input?.taskContext ?? {}) as NonNullable<RunInputDTO['taskContext']>

  const opts: CreateRunOptions = {
    projectId: run.projectId,
    role: run.role as RoleId,
    backend: run.backend as CreateRunOptions['backend'],
    connectionId: run.connectionId,
    model: run.model,
    scenarioId: run.scenarioId,
    versionId: run.versionId,
    fragmentId: taskContext.fragmentId ?? null,
    parentRunId: run.parentRunId,
    prompt: input?.prompt,
    messages: input?.messages,
    sentMessages: input.sentMessages,
    contextProvenance: input.contextProvenance,
    retryOfRunId: run.id,
    action: 'retry-saved-context',
    preserveMissingVersion: true,
    settings: input?.settings
      ? {
          temperature: input.settings.temperature,
          numPredict: input.settings.numPredict,
          timeoutMs: input.settings.timeoutMs,
          programChecks: input.settings.programChecks,
        }
      : undefined,
    taskContext,
    origin: 'real',
  }

  try {
    const retry = await createAndRunRun(opts)
    return NextResponse.json({ run: toRunDTO(retry) })
  } catch (err) {
    if (err instanceof RunValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
