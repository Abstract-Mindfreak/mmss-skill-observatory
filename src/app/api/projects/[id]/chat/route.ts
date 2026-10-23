// GET/POST /api/projects/[id]/chat — research assistant chat.
// The user message is saved BEFORE the model call: a model failure
// returns an honest 502 with saved=true. Owned by agent 1-b.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toChatMessageDTO } from '@/lib/serialize'
import { buildRoleMessages } from '@/lib/role-messages'
import { resolveInstructionContext, type InstructionContextSelection } from '@/lib/instruction-context'
import {
  callModel,
  findSectionFragment,
  RunValidationError,
} from '@/lib/runner'
import { OllamaError } from '@/lib/ollama'
import { SessionCloudError } from '@/lib/session-cloud'
import { FreeLLMApiError } from '@/lib/freellmapi'
import { assignmentForRole } from '@/lib/backend-routing'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const project = await db.project.findUnique({ where: { id } })
  if (!project) {
    return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
  }
  const messages = await db.chatMessage.findMany({
    where: { projectId: id },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  // Last 200 in ascending order.
  return NextResponse.json(messages.reverse().map(toChatMessageDTO))
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const project = await db.project.findUnique({ where: { id } })
  if (!project) {
    return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
  }

  const body = (await req.json().catch(() => null)) as {
    content?: unknown
    contextFragmentId?: unknown
    backend?: unknown
    connectionId?: unknown
    model?: unknown
    instructionContext?: InstructionContextSelection
  } | null

  const content = typeof body?.content === 'string' ? body.content.trim() : ''
  if (!content) {
    return NextResponse.json({ error: 'Укажите текст сообщения (content)' }, { status: 400 })
  }

  const assignment = await assignmentForRole(id, 'assistant')
  const backend = typeof body?.backend === 'string' && body.backend ? body.backend : assignment?.backend ?? ''
  if (backend === 'demo') {
    return NextResponse.json(
      { error: 'Демо-бэкенд доступен только через загрузку DEMO-данных' },
      { status: 400 }
    )
  }
  if (backend === 'session-cloud') {
    return NextResponse.json({ error: 'session-cloud недоступен для локального запуска. Выберите назначение роли или подключение FreeLLMAPI/Ollama.' }, { status: 400 })
  }
  if (backend !== 'ollama' && backend !== 'freellmapi') {
    return NextResponse.json(
      { error: 'Укажите backend: ollama или freellmapi' },
      { status: 400 }
    )
  }
  const connectionId = (typeof body?.connectionId === 'string' && body.connectionId ? body.connectionId : null) ?? assignment?.connectionId ?? null
  const model = (typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : null) ?? assignment?.model ?? null
  if ((backend === 'ollama' || backend === 'freellmapi') && (!connectionId || !model)) {
    return NextResponse.json(
      { error: `Для ${backend === 'freellmapi' ? 'FreeLLMAPI' : 'Ollama'} укажите подключение и модель` },
      { status: 400 }
    )
  }

  // Required task material (C), independently validated against this project.
  let contextFragmentId: string | null = null
  let fragmentText: string | undefined
  if (typeof body?.contextFragmentId === 'string' && body.contextFragmentId) {
    const fragment = await db.fragment.findFirst({ where: { id: body.contextFragmentId, version: { projectId: id } } })
    if (!fragment) {
      return NextResponse.json({ error: 'Указанный фрагмент не найден' }, { status: 400 })
    }
    contextFragmentId = fragment.id
    fragmentText = `[[обязательный материал id=${fragment.id} path=${fragment.path} version=${fragment.versionId}]]\n${fragment.text}`
  }

  // History BEFORE the new user message (last 10).
  const historyRows = await db.chatMessage.findMany({
    where: { projectId: id },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
  const history = historyRows
    .reverse()
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  // Save the user message first — it survives model failures.
  const userMessage = await db.chatMessage.create({
    data: {
      projectId: id,
      role: 'user',
      content,
      contextFragmentId,
    },
  })

  try {
    const instruction = await resolveInstructionContext({ projectId: id, selection: body?.instructionContext })
    const baseMessages = buildRoleMessages('assistant', {
      fragmentText,
      task: content,
    }, instruction)
    const messages = [baseMessages[0], ...history, ...baseMessages.slice(1)]
    const result = await callModel({
      backend,
      connectionId,
      model,
      messages,
      timeoutMs: 120000,
      provenance: { projectId: id, role: 'assistant', action: 'assistant-chat', versionId: instruction.versionId, context: instruction },
    })

    const assistantMessage = await db.chatMessage.create({
      data: {
        projectId: id,
        role: 'assistant',
        content: result.content,
        backend,
        connectionName: result.connectionName,
        model,
        responseMetadata: JSON.stringify({ actualProvider: result.actualProvider, actualModel: result.actualModel, modelCallId: result.modelCallId ?? null, contextMode: instruction.mode, contextVersionId: instruction.versionId, contextFragmentIds: instruction.includedFragmentIds, contextSha256: instruction.sentContextSha256, contextChars: instruction.sentContextChars, historyCount: history.length }),
        contextFragmentId,
      },
    })

    return NextResponse.json({
      messages: [userMessage, assistantMessage].map(toChatMessageDTO),
    })
  } catch (err) {
    if (err instanceof RunValidationError) {
      return NextResponse.json({ error: err.message, saved: true }, { status: err.status })
    }
    if (err instanceof OllamaError || err instanceof SessionCloudError || err instanceof FreeLLMApiError) {
      return NextResponse.json(
        { error: `Модель недоступна: ${err.message}`, saved: true },
        { status: 502 }
      )
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message, saved: true }, { status: 500 })
  }
}
