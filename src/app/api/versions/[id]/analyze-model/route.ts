// POST /api/versions/[id]/analyze-model — Interpreter role: model
// interpretations of up to 12 fragments per request, saved as an
// Analysis row (type='model-interpret'). Owned by agent 1-b.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { analysisMeta } from '@/lib/serialize'
import { buildRoleMessages } from '@/lib/role-messages'
import { resolveInstructionContext, type InstructionContextSelection } from '@/lib/instruction-context'
import { callModel, extractFirstJsonObject, RunValidationError } from '@/lib/runner'
import { OllamaError } from '@/lib/ollama'
import { SessionCloudError } from '@/lib/session-cloud'
import { assignmentForRole } from '@/lib/backend-routing'

interface InterpretationItem {
  fragmentId: string
  interpretation: string | null
  alternatives: string[]
  scopeNote: string | null
  limitations: string | null
  actualProvider?: string | null
  actualModel?: string | null
  backend?: string
  connectionName?: string | null
  requestedModel?: string | null
  modelCallId?: string
  error?: string
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const version = await db.documentVersion.findUnique({ where: { id } })
  if (!version) {
    return NextResponse.json({ error: 'Версия не найдена' }, { status: 404 })
  }

  const body = (await req.json().catch(() => null)) as {
    backend?: unknown
    connectionId?: unknown
    model?: unknown
    fragmentIds?: unknown
    focus?: unknown
    instructionContext?: InstructionContextSelection
  } | null

  const assigned = await assignmentForRole(version.projectId, 'interpreter')
  const backend = typeof body?.backend === 'string' && body.backend ? body.backend : assigned?.backend ?? ''
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

  const connectionId = (typeof body?.connectionId === 'string' && body.connectionId ? body.connectionId : null) ?? assigned?.connectionId ?? null
  const model = (typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : null) ?? assigned?.model ?? null
  if ((backend === 'ollama' || backend === 'freellmapi') && (!connectionId || !model)) {
    return NextResponse.json(
      { error: `Для ${backend === 'freellmapi' ? 'FreeLLMAPI' : 'Ollama'} укажите подключение и модель` },
      { status: 400 }
    )
  }

  if (!Array.isArray(body?.fragmentIds) || body.fragmentIds.length === 0) {
    return NextResponse.json({ error: 'Укажите список fragmentIds' }, { status: 400 })
  }
  const fragmentIds = body.fragmentIds.filter(
    (f): f is string => typeof f === 'string' && f.length > 0
  )
  if (fragmentIds.length === 0) {
    return NextResponse.json({ error: 'Список fragmentIds пуст' }, { status: 400 })
  }
  if (fragmentIds.length > 12) {
    return NextResponse.json(
      { error: 'За один запрос — не более 12 фрагментов' },
      { status: 400 }
    )
  }

  const focus = typeof body?.focus === 'string' && body.focus.trim() ? body.focus.trim() : undefined

  // Only fragments that belong to this version; missing ids are skipped honestly.
  const fragments = await db.fragment.findMany({
    where: { id: { in: fragmentIds }, versionId: version.id },
    orderBy: { order: 'asc' },
  })
  if (fragments.length !== new Set(fragmentIds).size) {
    return NextResponse.json({ error: 'Один или несколько обязательных фрагментов не принадлежат выбранной версии' }, { status: 400 })
  }
  if (fragments.length === 0) {
    return NextResponse.json(
      { error: 'Не найдено ни одного фрагмента из списка в указанной версии' },
      { status: 400 }
    )
  }

  const started = Date.now()
  const items: InterpretationItem[] = []
  const instruction = await resolveInstructionContext({ projectId: version.projectId, selection: body?.instructionContext, fallbackVersionId: version.id })

  for (const fragment of fragments) {
    const messages = buildRoleMessages('interpreter', {
      fragmentText: `[[обязательный материал id=${fragment.id} path=${fragment.path} version=${version.id}]]\n${fragment.text}`,
      focus,
    }, instruction)
    try {
      const result = await callModel({
        backend,
        connectionId,
        model,
        messages,
        temperature: 0.2,
        timeoutMs: 120000,
        provenance: { projectId: version.projectId, role: 'interpreter', action: 'atlas-interpret-fragment', versionId: version.id, context: instruction, relatedEntities: [`analysis-version:${version.id}`, `fragment:${fragment.id}`] },
      })
      const parsed = extractFirstJsonObject(result.content)
      if (parsed) {
        const interpretation =
          typeof parsed.interpretation === 'string' && parsed.interpretation.trim()
            ? parsed.interpretation
            : null
        const alternatives = Array.isArray(parsed.alternatives)
          ? parsed.alternatives.filter(
              (a): a is string => typeof a === 'string' && a.trim().length > 0
            )
          : []
        const scopeNote = typeof parsed.scope === 'string' && parsed.scope.trim() ? parsed.scope : null
        const limitations =
          typeof parsed.limitations === 'string' && parsed.limitations.trim()
            ? parsed.limitations
            : null
        items.push({
          fragmentId: fragment.id,
          interpretation,
          alternatives,
          scopeNote,
          limitations,
          actualProvider: result.actualProvider,
          actualModel: result.actualModel,
          backend,
          connectionName: result.connectionName,
          requestedModel: model,
          modelCallId: result.modelCallId,
          ...(interpretation === null
            ? { error: 'Модель не вернула поле interpretation' }
            : {}),
        })
      } else {
        items.push({
          fragmentId: fragment.id,
          interpretation: null,
          alternatives: [],
          scopeNote: null,
          limitations: null,
          actualProvider: result.actualProvider,
          actualModel: result.actualModel,
          backend,
          connectionName: result.connectionName,
          requestedModel: model,
          modelCallId: result.modelCallId,
          error: 'Не удалось разобрать ответ модели как JSON',
        })
      }
    } catch (err) {
      // Individual failures are recorded per-item, honestly; the rest continues.
      items.push({
        fragmentId: fragment.id,
        interpretation: null,
        alternatives: [],
        scopeNote: null,
        limitations: null,
          modelCallId: undefined,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const failedCount = items.filter((i) => i.error).length
  const allFailed = failedCount === items.length
  const backendLabel = backend === 'freellmapi' ? 'FreeLLMAPI' : 'Ollama'
  const summary = allFailed
    ? `Интерпретация фрагментов через ${backendLabel} — все ${items.length} запросов завершились ошибкой`
    : `Интерпретация ${items.length} фрагмент(ов)${model ? ` моделью ${model}` : ''} через ${backendLabel}${
        failedCount > 0 ? ` (ошибок: ${failedCount})` : ''
      }`

  const analysis = await db.analysis.create({
    data: {
      versionId: version.id,
      projectId: version.projectId,
      type: 'model-interpret',
      backend,
      model,
      status: allFailed ? 'failed' : 'completed',
      summary,
      result: JSON.stringify({ items, contextMode: instruction.mode, contextVersionId: instruction.versionId, contextFragmentIds: instruction.includedFragmentIds, contextSha256: instruction.sentContextSha256, contextChars: instruction.sentContextChars }),
      fragmentCount: items.length,
      durationMs: Date.now() - started,
      ...(allFailed ? { error: items.find((i) => i.error)?.error ?? null } : {}),
    },
  })

  return NextResponse.json({ analysis: analysisMeta(analysis), items })
}
