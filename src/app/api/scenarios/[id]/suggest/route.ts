// POST /api/scenarios/[id]/suggest — Explorer role: the model proposes
// `count` genuinely different failure mechanisms as child scenarios.
// Honest errors only: no silent fallbacks. Owned by agent 1-b.

import { NextResponse } from 'next/server'
import type { Scenario } from '@prisma/client'
import { db } from '@/lib/db'
import { toScenarioDTO } from '@/lib/serialize'
import { buildRoleMessages } from '@/lib/role-messages'
import { resolveInstructionContext, type InstructionContextSelection } from '@/lib/instruction-context'
import { finishModelCallRecord } from '@/lib/model-call-record'
import {
  buildSkillContext,
  callModel,
  extractFirstJsonObject,
  findSectionFragment,
  resolveActiveVersion,
  RunValidationError,
} from '@/lib/runner'
import { OllamaError } from '@/lib/ollama'
import { SessionCloudError } from '@/lib/session-cloud'
import { FreeLLMApiError } from '@/lib/freellmapi'
import { assignmentForRole } from '@/lib/backend-routing'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const scenario = await db.scenario.findUnique({ where: { id } })
  if (!scenario) {
    return NextResponse.json({ error: 'Сценарий не найден' }, { status: 404 })
  }

  const body = (await req.json().catch(() => null)) as {
    backend?: unknown
    connectionId?: unknown
    model?: unknown
    count?: unknown
    depth?: unknown
    contextSelection?: InstructionContextSelection
  } | null

  const backend = typeof body?.backend === 'string' ? body.backend : ''
  if (backend === 'demo') {
    return NextResponse.json(
      { error: 'Демо-бэкенд доступен только через загрузку DEMO-данных' },
      { status: 400 }
    )
  }
  if (backend === 'session-cloud') {
    return NextResponse.json({ error: 'session-cloud недоступен для локального запуска. Выберите назначение роли или подключение FreeLLMAPI/Ollama.' }, { status: 400 })
  }
  const assigned = await assignmentForRole(scenario.projectId, 'explorer')
  const effectiveBackend = backend || assigned?.backend || ''
  const effectiveConnectionId = (typeof body?.connectionId === 'string' && body.connectionId) || assigned?.connectionId || null
  const effectiveModel = (typeof body?.model === 'string' && body.model.trim()) || assigned?.model || null
  if (effectiveBackend !== 'ollama' && effectiveBackend !== 'freellmapi') {
    return NextResponse.json(
      { error: 'Для Explorer не выбрано подключение. Назначьте роль в «Подключениях» или выберите подключение для этого действия.' },
      { status: 400 }
    )
  }

  const connectionId = effectiveConnectionId
  const model = effectiveModel
  if ((backend === 'ollama' || backend === 'freellmapi') && (!connectionId || !model)) {
    return NextResponse.json(
      { error: `Для ${backend === 'freellmapi' ? 'FreeLLMAPI' : 'Ollama'} укажите подключение и модель` },
      { status: 400 }
    )
  }

  let count = 3
  if (body?.count !== undefined && body?.count !== null) {
    if (
      typeof body.count !== 'number' ||
      !Number.isInteger(body.count) ||
      body.count < 1 ||
      body.count > 5
    ) {
      return NextResponse.json(
        { error: 'count должен быть целым числом от 1 до 5' },
        { status: 400 }
      )
    }
    count = body.count
  }

  // Scenario and linked fragment are task material (C); added instruction text is separately selected (D).
  let fragmentText: string | undefined
  let linkedVersionId: string | null = null
  if (scenario.fragmentId) {
    const fragment = await db.fragment.findUnique({ where: { id: scenario.fragmentId } })
    if (fragment) {
      fragmentText = `[[обязательный материал id=${fragment.id} path=${fragment.path} version=${fragment.versionId}]]\n${fragment.text}`
      linkedVersionId = fragment.versionId
    }
  }
  const instruction = await resolveInstructionContext({ projectId: scenario.projectId, selection: body?.contextSelection ?? { mode: 'none', versionId: linkedVersionId, fragmentIds: [], includeParentSections: false }, fallbackVersionId: linkedVersionId })
  const messages = buildRoleMessages('explorer', {
    scenario: { title: scenario.title, description: scenario.description }, fragmentText, mechanismsCount: count,
  }, instruction)

  try {
    const result = await callModel({
      backend: effectiveBackend,
      connectionId,
      model,
      messages,
      temperature: 0.7,
      numPredict: 1024,
      timeoutMs: 120000,
      provenance: { projectId: scenario.projectId, role: 'explorer', action: 'scenario-tree-suggest', versionId: instruction.versionId, context: instruction },
    })

    const parsed = extractFirstJsonObject(result.content)
    const mechanisms =
      parsed && Array.isArray(parsed.mechanisms) ? (parsed.mechanisms as unknown[]) : null
    if (!mechanisms) {
      return NextResponse.json(
        {
          error: 'Не удалось разобрать ответ модели как JSON со списком механизмов',
          detail: result.content.slice(0, 400),
        },
        { status: 502 }
      )
    }

    const valid = mechanisms
      .filter(
        (m): m is { title: string; description: string } =>
          !!m &&
          typeof m === 'object' &&
          typeof (m as { title?: unknown }).title === 'string' &&
          (m as { title: string }).title.trim().length > 0 &&
          typeof (m as { description?: unknown }).description === 'string'
      )
      .slice(0, count)
      .map((m) => ({
        title: m.title.trim().slice(0, 300),
        description: m.description.trim().slice(0, 2000) || '—',
      }))

    if (!valid.length) {
      return NextResponse.json(
        {
          error: 'Модель не вернула ни одного валидного механизма (нужны поля title и description)',
          detail: result.content.slice(0, 400),
        },
        { status: 502 }
      )
    }

    const maxOrder = await db.scenario.findFirst({
      where: { parentId: scenario.id },
      orderBy: { order: 'desc' },
      select: { order: true },
    })

    const created: Scenario[] = []
    for (let i = 0; i < valid.length; i++) {
      created.push(
        await db.scenario.create({
          data: {
            projectId: scenario.projectId,
            parentId: scenario.id,
            title: valid[i].title,
            description: valid[i].description,
            status: 'unexplored',
            origin: 'model',
            generationMetadata: JSON.stringify({
              modelCallId: result.modelCallId ?? null,
              backend: effectiveBackend,
              connectionId,
              connectionName: result.connectionName,
              requestedModel: model,
              actualProvider: result.actualProvider,
              actualModel: result.actualModel,
            }),
            fragmentId: scenario.fragmentId,
            order: (maxOrder?.order ?? 0) + 1 + i,
          },
        })
      )
    }

    if (result.modelCallId) await finishModelCallRecord(result.modelCallId, { actualProvider: result.actualProvider, actualModel: result.actualModel, relatedEntities: created.map((item) => `scenario:${item.id}`) })

    return NextResponse.json({
      created: created.map((s) => toScenarioDTO(s, { runCount: 0, lastRunStatus: null })),
      raw: result.content,
      backend: effectiveBackend,
      model,
    })
  } catch (err) {
    if (err instanceof RunValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    if (err instanceof OllamaError || err instanceof SessionCloudError || err instanceof FreeLLMApiError) {
      return NextResponse.json(
        { error: `Модель недоступна: ${err.message}` },
        { status: 502 }
      )
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
