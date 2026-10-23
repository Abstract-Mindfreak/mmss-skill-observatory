import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveInstructionContext, type InstructionContextSelection } from '@/lib/instruction-context'
import { buildRoleMessages, withAssistantHistory } from '@/lib/role-messages'
import type { RolePromptContext } from '@/lib/role-prompts'
import type { RoleId } from '@/lib/types'

const roles: RoleId[] = ['executor', 'explorer', 'evaluator', 'challenger', 'editor', 'assistant', 'interpreter']

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as {
    projectId?: unknown; role?: unknown; contextSelection?: InstructionContextSelection; promptContext?: RolePromptContext; scenarioId?: unknown; fragmentId?: unknown; findingId?: unknown; history?: unknown
  } | null
  if (!body || typeof body.projectId !== 'string' || !roles.includes(body.role as RoleId)) {
    return NextResponse.json({ error: 'Укажите projectId и текстовую роль для предпросмотра' }, { status: 400 })
  }
  const project = await db.project.findUnique({ where: { id: body.projectId }, select: { id: true } })
  if (!project) return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
  try {
    const role = body.role as RoleId
    const context: RolePromptContext = { ...(body.promptContext ?? {}) }
    if (typeof body.scenarioId === 'string') {
      const scenario = await db.scenario.findFirst({ where: { id: body.scenarioId, projectId: project.id } })
      if (!scenario) throw new Error('Обязательный сценарий недоступен в текущем проекте')
      context.scenario = { title: scenario.title, description: scenario.description }
      if (scenario.fragmentId) {
        const fragment = await db.fragment.findFirst({ where: { id: scenario.fragmentId, version: { projectId: project.id } } })
        if (fragment) context.fragmentText = `[[обязательный материал id=${fragment.id} path=${fragment.path} version=${fragment.versionId}]]\n${fragment.text}`
      }
    }
    if (typeof body.fragmentId === 'string') {
      const fragment = await db.fragment.findFirst({ where: { id: body.fragmentId, version: { projectId: project.id } } })
      if (!fragment) throw new Error('Обязательный фрагмент недоступен в текущем проекте')
      context.fragmentText = `[[обязательный материал id=${fragment.id} path=${fragment.path} version=${fragment.versionId}]]\n${fragment.text}`
    }
    if (typeof body.findingId === 'string') {
      const finding = await db.finding.findFirst({ where: { id: body.findingId, projectId: project.id } })
      if (!finding) throw new Error('Находка недоступна в текущем проекте')
      context.finding = { title: finding.title, description: finding.description }
    }
    if (Array.isArray(body.history)) {
      if (body.history.some((item) => !item || typeof item !== 'object' || !['user', 'assistant'].includes((item as { role?: string }).role ?? '') || typeof (item as { content?: unknown }).content !== 'string')) throw new Error('Некорректная история сообщений Assistant')
      context.history = body.history as { role: 'user' | 'assistant'; content: string }[]
    }
    const instruction = await resolveInstructionContext({ projectId: project.id, selection: body.contextSelection })
    const baseMessages = buildRoleMessages(role, context, instruction)
    const messages = role === 'assistant' ? withAssistantHistory(baseMessages, context.history ?? []) : baseMessages
    return NextResponse.json({ messages, instruction, totalChars: messages.reduce((n, m) => n + m.content.length, 0) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
