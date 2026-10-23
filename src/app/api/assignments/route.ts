// GET/PUT /api/assignments — role → backend/model assignments per project.
// Owned by agent 1-b.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { AssignmentDTO } from '@/lib/types'
import type { Assignment, Connection } from '@prisma/client'

const ALL_ROLES = [
  'executor',
  'explorer',
  'evaluator',
  'challenger',
  'editor',
  'assistant',
  'interpreter',
  'embedding',
] as const

type AssignmentRole = (typeof ALL_ROLES)[number]

function toAssignmentDTO(
  role: AssignmentRole,
  assignment: Assignment | null,
  connections: Map<string, Connection>
): AssignmentDTO {
  const connectionId = assignment?.connectionId ?? null
  return {
    role,
    backend: (assignment?.backend as AssignmentDTO['backend']) ?? null,
    connectionId,
    connectionName: connectionId
      ? (() => {
          const connection = connections.get(connectionId)
      return connection?.name ?? null
        })()
      : null,
    model: assignment?.model ?? null,
  }
}

export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get('projectId')
  if (!projectId) {
    return NextResponse.json({ error: 'Укажите projectId' }, { status: 400 })
  }
  const assignments = await db.assignment.findMany({ where: { projectId } })
  const byRole = new Map(assignments.map((a) => [a.role, a]))
  const connections = await db.connection.findMany()
  const connectionMap = new Map(connections.map((c) => [c.id, c]))

  return NextResponse.json(
    ALL_ROLES.map((role) =>
      toAssignmentDTO(role, byRole.get(role) ?? null, connectionMap)
    )
  )
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | {
        projectId?: unknown
        role?: unknown
        backend?: unknown
        connectionId?: unknown
        model?: unknown
      }
    | null
  if (!body) {
    return NextResponse.json({ error: 'Некорректный JSON в теле запроса' }, { status: 400 })
  }

  const projectId = typeof body.projectId === 'string' ? body.projectId : ''
  const role = typeof body.role === 'string' ? body.role : ''
  const backend = body.backend === null ? null : typeof body.backend === 'string' ? body.backend : undefined
  const connectionId = typeof body.connectionId === 'string' && body.connectionId ? body.connectionId : null
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null

  if (!projectId) {
    return NextResponse.json({ error: 'Укажите projectId' }, { status: 400 })
  }
  if (!(ALL_ROLES as readonly string[]).includes(role)) {
    return NextResponse.json({ error: `Неизвестная роль: ${String(role)}` }, { status: 400 })
  }
  if (backend === 'session-cloud') {
    return NextResponse.json({ error: 'session-cloud недоступен для локального проекта. Выберите Ollama или FreeLLMAPI.' }, { status: 400 })
  }
  if (backend !== null && backend !== 'ollama' && backend !== 'freellmapi') {
    return NextResponse.json(
      { error: 'backend должен быть «ollama», «freellmapi» или null' },
      { status: 400 }
    )
  }
  if (role === 'embedding' && backend === 'freellmapi') {
    return NextResponse.json({ error: 'Для embedding-проб поддерживается назначение Ollama.' }, { status: 400 })
  }

  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project) {
    return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
  }

  let connection: Connection | null = null
  if (backend === 'ollama' || backend === 'freellmapi') {
    if (!connectionId) {
      return NextResponse.json({ error: `Для ${backend === 'freellmapi' ? 'FreeLLMAPI' : 'Ollama'} укажите подключение (connectionId)` }, { status: 400 })
    }
    connection = await db.connection.findUnique({ where: { id: connectionId } })
    if (!connection || (backend === 'freellmapi' && connection.kind !== 'freellmapi') || (backend === 'ollama' && connection.kind === 'freellmapi')) {
      return NextResponse.json({ error: 'Указанное подключение не найдено' }, { status: 400 })
    }
  }

  const data = {
    backend,
    connectionId: backend === 'ollama' || backend === 'freellmapi' ? connectionId : null,
    model: backend === 'ollama' || backend === 'freellmapi' ? model : null,
  }

  const assignment = await db.assignment.upsert({
    where: { projectId_role: { projectId, role } },
    create: { projectId, role, ...data },
    update: data,
  })

  const connections = connection ? [connection] : []
  const connectionMap = new Map(connections.map((c) => [c.id, c]))
  return NextResponse.json(
    toAssignmentDTO(role as AssignmentRole, assignment, connectionMap)
  )
}
