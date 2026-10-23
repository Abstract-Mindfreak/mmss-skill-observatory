import { createHash, randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { assignmentForRole } from '@/lib/backend-routing'
import { createRun, executeRun, extractFirstJsonObject, RunValidationError } from '@/lib/runner'
import { buildRolePrompt } from '@/lib/role-prompts'
import { resolveInstructionContext } from '@/lib/instruction-context'
import { parseVector, cosineSimilarity } from '@/lib/semantic-search'
import { cancelRun } from '@/lib/run-registry'
import {
  campaignVersionState,
  campaignFailureAction,
  campaignRunRecovery,
  deriveCampaignConclusion,
  isSourceQuoteVerified,
  validateCampaignPolicy,
  type CampaignDepth,
  type CampaignEvidenceState,
  type CampaignPolicyInput,
} from '@/lib/research-campaign-core'
import { campaignResumeBlock } from '@/lib/research-ui-state'
import { safeParse } from '@/lib/serialize'

const ROLE_BY_DEPTH: Record<CampaignDepth, string[]> = {
  interpretation: ['interpreter'],
  interactions: ['interpreter', 'challenger'],
  scenarios: ['interpreter', 'challenger', 'explorer'],
  full: ['interpreter', 'challenger', 'explorer', 'executor', 'evaluator'],
}

const noneContext = (versionId: string) => ({ mode: 'none' as const, versionId, fragmentIds: [], includeParentSections: false })

export type CampaignCreateInput = {
  projectId: string
  versionId: string
  expectedHash: string
  idempotencyKey?: string
  scopeType: 'version' | 'sections' | 'positions'
  sectionPaths?: string[]
  positionIds?: string[]
  policy: CampaignPolicyInput
}

function textHash(text: string) { return createHash('sha256').update(text, 'utf8').digest('hex') }

function parseObject(text: string): Record<string, unknown> | null {
  const result = extractFirstJsonObject(text)
  return result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : null
}

function sourceText(rows: { id: string; path: string; kind: string; title: string | null; text: string }[]) {
  return rows.map((row) => `[[Fragment id=${row.id} path=${row.path} kind=${row.kind}${row.title ? ` title=${row.title}` : ''}]]\n${row.text}`).join('\n\n')
}

function validQuotes(value: unknown, fragments: { id: string; path: string; text: string }[]) {
  if (!Array.isArray(value)) return false
  const map = new Map(fragments.map((fragment) => [fragment.id, fragment]))
  const quotes = value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
  return quotes.length > 0 && quotes.every((item) => {
    const source = typeof item.fragmentId === 'string' ? map.get(item.fragmentId) : undefined
    return Boolean(source && typeof item.quote === 'string' && isSourceQuoteVerified(source.text, item.quote))
  })
}

function sourceQuotes(parsed: Record<string, unknown> | null): unknown {
  if (!parsed) return null
  if (Array.isArray(parsed.sourceEvidence)) return parsed.sourceEvidence
  if (Array.isArray(parsed.evidence)) return parsed.evidence
  if (Array.isArray(parsed.checks)) return parsed.checks.flatMap((check) => check && typeof check === 'object' && Array.isArray((check as Record<string, unknown>).sourceEvidence) ? (check as Record<string, unknown>).sourceEvidence as unknown[] : [])
  return null
}

function rolePrompt(role: 'interpreter' | 'challenger' | 'explorer' | 'evaluator', userText: string, details?: { criterion?: string; output?: string }) {
  if (role === 'evaluator') return buildRolePrompt('evaluator', {
    task: userText, criterion: details?.criterion, outputToEvaluate: details?.output,
  })
  const roleName = role === 'interpreter' ? 'Interpreter' : role === 'challenger' ? 'Challenger' : 'Explorer'
  const purpose = role === 'interpreter'
    ? 'сверяй положение с исходными фрагментами и отличай дословную цитату от вывода'
    : role === 'challenger'
      ? 'проверяй альтернативные объяснения и пытайся опровергнуть замечание'
      : 'предлагай ограниченные сценарии проверки и объясняй неприменимые случаи'
  return { system: `Ты выполняешь роль ${roleName}: ${purpose}. Используй только переданный материал. Не меняй инструкцию и исследовательские статусы. Верни только JSON и точно соблюдай схему из сообщения пользователя.`, user: userText }
}

export async function createResearchCampaign(input: CampaignCreateInput) {
  const policyErrors = validateCampaignPolicy(input.policy)
  if (policyErrors.length) throw new RunValidationError(policyErrors.join(' '), 400)
  const version = await db.documentVersion.findFirst({
    where: { id: input.versionId, projectId: input.projectId },
    include: { fragments: { orderBy: { order: 'asc' } } },
  })
  if (!version) throw new RunValidationError('Выбранная версия не принадлежит проекту.', 404)
  if (!input.expectedHash || input.expectedHash !== version.contentHash || textHash(version.content) !== version.contentHash) {
    throw new RunValidationError('Содержимое или SHA-256 версии изменились. Обновите страницу и проверьте целевую версию.', 409)
  }

  let selectedFragments = version.fragments
  if (input.scopeType === 'sections') {
    const paths = [...new Set((input.sectionPaths ?? []).map((path) => path.trim()).filter(Boolean))]
    if (!paths.length) throw new RunValidationError('Выберите хотя бы один раздел.')
    selectedFragments = version.fragments.filter((fragment) => paths.some((path) => fragment.path === path || fragment.path.startsWith(`${path}.`)))
    if (!selectedFragments.length) throw new RunValidationError('В выбранных разделах нет исходных фрагментов.', 400)
    input.sectionPaths = paths
  } else if (input.scopeType === 'positions') {
    const ids = [...new Set(input.positionIds ?? [])]
    if (!ids.length) throw new RunValidationError('Выберите хотя бы одно положение.')
    input.positionIds = ids
  } else if (input.scopeType !== 'version') {
    throw new RunValidationError('Неизвестный тип исследовательской области.', 400)
  }

  const eligibleFragmentIds = new Set(selectedFragments.map((fragment) => fragment.id))
  const positions = await db.semanticPosition.findMany({
    where: { projectId: input.projectId, versionId: input.versionId, ...(input.scopeType === 'positions' ? { id: { in: input.positionIds } } : {}) },
    include: { fragments: { include: { fragment: { select: { id: true, path: true, kind: true, title: true, text: true } } } } },
    orderBy: { createdAt: 'asc' },
  })
  const selectedPositions = input.scopeType === 'sections'
    ? positions.filter((position) => position.fragments.some((link) => eligibleFragmentIds.has(link.fragmentId)))
    : positions
  if (input.scopeType === 'positions' && selectedPositions.length !== new Set(input.positionIds).size) throw new RunValidationError('Одно или несколько выбранных положений недоступны в целевой версии.', 400)
  if (!selectedPositions.length) throw new RunValidationError('В выбранной области нет положений с источниками. Сначала выберите существующие положения.', 400)

  const positionSourceIds = new Set(selectedPositions.flatMap((position) => position.fragments.map((link) => link.fragmentId)))
  const scopeFragmentIds = input.scopeType === 'positions'
    ? positionSourceIds
    : eligibleFragmentIds
  const scopedFragments = input.scopeType === 'positions'
    ? version.fragments.filter((fragment) => positionSourceIds.has(fragment.id))
    : selectedFragments
  const unmapped = scopedFragments.filter((fragment) => !positionSourceIds.has(fragment.id)).map((fragment) => fragment.id)
  if (input.scopeType === 'positions') {
    for (const position of selectedPositions) if (!position.fragments.length) unmapped.push(`position:${position.id}`)
  }

  const idempotencyKey = input.idempotencyKey?.trim()
  if (idempotencyKey && !/^[a-zA-Z0-9_-]{12,80}$/.test(idempotencyKey)) throw new RunValidationError('Ключ запуска имеет неверный формат.', 400)
  const matchesRequest = (existing: { projectId: string; versionId: string; contentHash: string; scopeType: string; scopeSnapshot: string; depth: string; maxScenariosPerPosition: number; maxModelActions: number | null; maxAdditionalChecksPerPosition: number; maxRetriesPerAction: number; stopOnQuota: boolean; stopOnTechnicalError: boolean }) => {
    const existingScope = safeParse<{ sectionPaths?: string[]; positionIds?: string[]; fragmentIds?: string[] }>(existing.scopeSnapshot, {})
    return existing.projectId === input.projectId
      && existing.versionId === input.versionId
      && existing.contentHash === version.contentHash
      && existing.scopeType === input.scopeType
      && JSON.stringify(existingScope.sectionPaths ?? []) === JSON.stringify(input.sectionPaths ?? [])
      && JSON.stringify(existingScope.positionIds ?? []) === JSON.stringify(selectedPositions.map((position) => position.id))
      && JSON.stringify(existingScope.fragmentIds ?? []) === JSON.stringify([...scopeFragmentIds])
      && existing.depth === input.policy.depth
      && existing.maxScenariosPerPosition === input.policy.maxScenariosPerPosition
      && existing.maxModelActions === input.policy.maxModelActions
      && existing.maxAdditionalChecksPerPosition === input.policy.maxAdditionalChecksPerPosition
      && existing.maxRetriesPerAction === input.policy.maxRetriesPerAction
      && existing.stopOnQuota === input.policy.stopOnQuota
      && existing.stopOnTechnicalError === input.policy.stopOnTechnicalError
  }
  if (idempotencyKey) {
    const existing = await db.researchCampaign.findUnique({ where: { id: idempotencyKey }, include: campaignInclude })
    if (existing) {
      if (!matchesRequest(existing)) throw new RunValidationError('Ключ уже использован для другой области или политики.', 409)
      return existing
    }
  }

  const roleRows: { role: string; backend: string; connectionId: string; connectionName: string; model: string }[] = []
  for (const role of ROLE_BY_DEPTH[input.policy.depth]) {
    const assignment = await assignmentForRole(input.projectId, role)
    if (!assignment || !assignment.connectionId || !assignment.model || !['ollama', 'freellmapi'].includes(assignment.backend ?? '')) {
      throw new RunValidationError(`Назначьте роль ${role} в «Подключениях» перед созданием кампании.`)
    }
    const connection = await db.connection.findUnique({ where: { id: assignment.connectionId } })
    if (!connection || connection.kind !== assignment.backend) throw new RunValidationError(`Подключение для роли ${role} недоступно. Выберите его заново в «Подключениях».`)
    roleRows.push({ role, backend: assignment.backend!, connectionId: assignment.connectionId, connectionName: connection.name, model: assignment.model })
  }

  let campaign: CampaignRecord
  try {
    campaign = await db.researchCampaign.create({
    data: {
      ...(idempotencyKey ? { id: idempotencyKey } : {}),
      projectId: input.projectId,
      versionId: input.versionId,
      contentHash: version.contentHash,
      scopeType: input.scopeType,
      scopeSnapshot: JSON.stringify({ sectionPaths: input.sectionPaths ?? [], positionIds: selectedPositions.map((position) => position.id), fragmentIds: [...scopeFragmentIds] }),
      depth: input.policy.depth,
      maxScenariosPerPosition: input.policy.maxScenariosPerPosition,
      maxModelActions: input.policy.maxModelActions,
      maxAdditionalChecksPerPosition: input.policy.maxAdditionalChecksPerPosition,
      maxRetriesPerAction: input.policy.maxRetriesPerAction,
      maxConcurrent: 1,
      stopOnQuota: input.policy.stopOnQuota,
      stopOnTechnicalError: input.policy.stopOnTechnicalError,
      allowRewriteExperiment: false,
      status: 'prepared',
      stage: 'interpretation',
      unmappedFragmentsCount: unmapped.length,
      startedAt: null,
      roles: { create: roleRows },
      items: { create: selectedPositions.map((position, order) => ({
        positionId: position.id,
        order,
        status: position.fragments.length ? 'unexplored' : 'blocked',
        stage: position.fragments.length ? 'interpretation' : 'complete',
        conclusion: position.fragments.length ? 'not-explored' : 'insufficient-data',
        limitations: position.fragments.length ? null : 'У положения нет доступных исходных фрагментов.',
      })) },
    },
    include: campaignInclude,
    })
  } catch (error) {
    const uniqueConflict = Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
    if (!idempotencyKey || !uniqueConflict) throw error
    const existing = await db.researchCampaign.findUnique({ where: { id: idempotencyKey }, include: campaignInclude })
    if (!existing) throw error
    if (!matchesRequest(existing)) throw new RunValidationError('Ключ уже использован для другой области или политики.', 409)
    return existing
  }
  return campaign
}

const campaignInclude = {
  version: { select: { contentHash: true } },
  items: {
    orderBy: { order: 'asc' as const },
    include: {
      position: { include: {
        fragments: { include: { fragment: { select: { id: true, path: true, kind: true, title: true, text: true } } } },
        observations: { select: { status: true, observation: true, evidenceText: true, limitations: true } },
      } },
      scenarios: {
        orderBy: { order: 'asc' as const },
        include: {
          campaignCheck: {
            include: {
              sources: {
                include: { fragment: { select: { id: true, path: true, text: true } } },
              },
            },
          },
        },
      },
      notApplicableChecks: { orderBy: { checkType: 'asc' as const } },
      actions: { orderBy: { createdAt: 'asc' as const }, include: { run: true, check: true, sources: true } },
    },
  },
  roles: true,
} satisfies import('@prisma/client').Prisma.ResearchCampaignInclude

type CampaignRecord = import('@prisma/client').Prisma.ResearchCampaignGetPayload<{ include: typeof campaignInclude }>
type CampaignPositionRecord = CampaignRecord['items'][number]
type CampaignActionRecord = CampaignPositionRecord['actions'][number]

export async function getResearchCampaign(projectId: string, versionId: string) {
  const version = await db.documentVersion.findFirst({ where: { id: versionId, projectId }, select: { id: true, label: true, contentHash: true, content: true } })
  if (!version) throw new RunValidationError('Версия не принадлежит проекту.', 404)
  const campaigns = await db.researchCampaign.findMany({
    where: { projectId, versionId }, orderBy: { createdAt: 'desc' }, take: 10,
    include: campaignInclude,
  })
  const runIds = campaigns.flatMap((campaign) => campaign.items.flatMap((item) => item.actions.flatMap((action) => action.run?.id ? [action.run.id] : [])))
  const modelCalls = runIds.length ? await db.modelCall.findMany({ where: { runId: { in: runIds } }, select: { id: true, runId: true, actualProvider: true, actualModel: true }, orderBy: { createdAt: 'desc' } }) : []
  const actualByRun = new Map(modelCalls.map((call) => [call.runId, { modelCallId: call.id, actualProvider: call.actualProvider, actualModel: call.actualModel }]))
  return {
    version: { id: version.id, label: version.label, contentHash: version.contentHash, currentHashValid: textHash(version.content) === version.contentHash },
    campaigns: campaigns.map((campaign) => ({
      ...campaign,
      budgetHistory: safeParse(campaign.budgetHistory, []),
      versionState: campaignVersionState(campaign.contentHash, version.contentHash),
      items: campaign.items.map((item) => ({
        ...item,
        position: { id: item.position.id, title: item.position.title, status: item.position.status, purpose: item.position.purpose, path: item.position.fragments.map((link) => link.fragment.path).join(', '), sourceCount: item.position.fragments.length },
        scenarios: item.scenarios.map((scenario) => ({ ...scenario, campaignCheck: scenario.campaignCheck ? { ...scenario.campaignCheck, sources: scenario.campaignCheck.sources.map((source) => ({ id: source.fragment.id, path: source.fragment.path })) } : null })),
        actions: item.actions.map((action) => ({ ...action, run: action.run ? { id: action.run.id, status: action.run.status, role: action.run.role, verdict: action.run.verdict, output: action.run.output, error: action.run.error, backend: action.run.backend, connectionName: action.run.connectionName, model: action.run.model, ...(actualByRun.get(action.run.id) ?? { modelCallId: null, actualProvider: null, actualModel: null }) } : null })),
      })),
    })),
  }
}

async function interactionCandidates(campaign: CampaignRecord, item: CampaignPositionRecord) {
  const position = await db.semanticPosition.findUniqueOrThrow({ where: { id: item.positionId }, include: { fragments: { include: { fragment: { select: { id: true, path: true, kind: true, title: true, text: true } } } }, outgoingRelations: true, incomingRelations: true } })
  const relatedIds = new Set([...position.outgoingRelations.map((relation) => relation.targetPositionId), ...position.incomingRelations.map((relation) => relation.sourcePositionId)])
  const versionItems = await db.researchCampaignPosition.findMany({ where: { campaignId: campaign.id }, select: { positionId: true } })
  const inScope = new Set(versionItems.map((row) => row.positionId))
  let candidates = [...relatedIds].filter((id) => inScope.has(id))
  const vector = await db.embeddingVector.findFirst({ where: { positionId: position.id, versionId: campaign.versionId, representation: 'functional', status: 'ready' } })
  if (vector) {
    const sourceVector = parseVector(vector.vector)
    if (sourceVector) {
      const rows = await db.embeddingVector.findMany({ where: { versionId: campaign.versionId, representation: 'functional', status: 'ready', model: vector.model, NOT: { positionId: position.id } }, select: { positionId: true, vector: true } })
      const ranked = rows.flatMap((row) => {
        if (!row.positionId) return []
        const similarity = cosineSimilarity(sourceVector, parseVector(row.vector) ?? [])
        return similarity === null ? [] : [{ id: row.positionId, similarity }]
      }).sort((a, b) => b.similarity - a.similarity).slice(0, 5)
      candidates = [...new Set([...candidates, ...ranked.filter((row) => inScope.has(row.id)).map((row) => row.id)])].slice(0, 8)
    }
  }
  const positions = candidates.length ? await db.semanticPosition.findMany({ where: { id: { in: candidates }, versionId: campaign.versionId }, include: { fragments: { include: { fragment: { select: { id: true, path: true, kind: true, title: true, text: true } } } }, outgoingRelations: true, incomingRelations: true } }) : []
  return { position, positions }
}

async function evidenceState(campaign: CampaignRecord, item: CampaignPositionRecord): Promise<CampaignEvidenceState> {
  const checks = item.scenarios.map((scenario) => scenario.campaignCheck).filter(Boolean)
  const evaluations = checks.map((check) => {
    if (check!.status !== 'completed') return 'inconclusive'
    const evaluator = item.actions.find((action) => action.checkId === check!.id && action.actionType === 'evaluator' && action.status === 'completed')?.run
    return evaluator?.verdict === 'pass' || evaluator?.verdict === 'fail' ? evaluator.verdict : 'inconclusive'
  })
  const reviewActions = item.actions.filter((action) => action.role === 'challenger' && action.status === 'completed')
  const actionSources = await db.researchCampaignActionSource.findMany({
    where: { actionId: { in: item.actions.map((action) => action.id) } },
    include: { fragment: { select: { id: true, path: true, text: true } } },
  })
  const sourcesByAction = new Map<string, { id: string; path: string; text: string }[]>()
  for (const source of actionSources) sourcesByAction.set(source.actionId, [...(sourcesByAction.get(source.actionId) ?? []), source.fragment])
  const challengeConfirmed = reviewActions.some((action) => {
    const parsed = action.run?.output ? parseObject(action.run.output) : null
    return parsed?.supportsConcern === true && validQuotes(sourceQuotes(parsed), sourcesByAction.get(action.id) ?? [])
  })
  const sourceEvidence = item.actions.some((action) => {
    const parsed = action.run?.output ? parseObject(action.run.output) : null
    return Boolean(parsed && validQuotes(sourceQuotes(parsed), sourcesByAction.get(action.id) ?? []))
  })
  const quotaBlocked = campaign.pauseReason === 'provider-quota'
  return {
    // This is called only for an item whose applicable stages reached `complete`.
    // The campaign itself may still be running other items, so campaign.status
    // must not suppress this item's final conclusion as `in-progress`.
    status: 'completed',
    depth: campaign.depth as CampaignDepth,
    stageStatuses: {
      interpretation: item.interpretationStatus as CampaignEvidenceState['stageStatuses']['interpretation'],
      interaction: item.interactionStatus as CampaignEvidenceState['stageStatuses']['interaction'],
      scenarios: item.scenarioStatus as CampaignEvidenceState['stageStatuses']['scenarios'],
      evaluations,
    },
    verifiedSourceEvidence: item.verifiedSourceEvidence || sourceEvidence,
    challengerConfirmsConcern: challengeConfirmed,
    blockedByQuota: quotaBlocked,
    exhaustedBudget: campaign.maxModelActions !== null && campaign.modelActionsUsed >= campaign.maxModelActions,
    hasUnmappedSourceContent: campaign.unmappedFragmentsCount > 0,
    hasConflictingObservation: item.position.observations.some((observation) => observation.status !== 'supported'),
  }
}

async function refreshCampaignStatus(campaignId: string) {
  const campaign = await db.researchCampaign.findUniqueOrThrow({ where: { id: campaignId }, include: campaignInclude })
  if (campaign.items.every((item) => item.status === 'completed' || item.status === 'blocked')) {
    await db.researchCampaign.updateMany({ where: { id: campaignId, status: 'running' }, data: { status: 'completed', stage: 'complete', finishedAt: new Date(), workerToken: null, workerLeaseUntil: null } })
  }
  return db.researchCampaign.findUniqueOrThrow({ where: { id: campaignId } })
}

function noneContextRecord(versionId: string, versionContent: string, fragmentIds: string[]) {
  return {
    mode: 'none' as const, versionId, versionLabel: null, fullVersionSha256: textHash(versionContent), fullVersionChars: versionContent.length,
    selectedFragmentIds: fragmentIds, includedFragmentIds: [], sentContextSha256: null, sentContextChars: 0, text: '',
  }
}

async function actionPrompt(campaign: CampaignRecord, item: CampaignPositionRecord, actionType: string, checkId?: string | null) {
  const sources = item.position.fragments.map((link) => link.fragment)
  const sourceIds = new Set(sources.map((source) => source.id))
  const sourceMaterial = sourceText(sources)
  const position = item.position
  const existingRelated = await db.semanticRelation.findMany({ where: { versionId: campaign.versionId, OR: [{ sourcePositionId: position.id }, { targetPositionId: position.id }] }, include: { sourcePosition: { select: { id: true, title: true, purpose: true, conditions: true, expectedBehavior: true, limitations: true } }, targetPosition: { select: { id: true, title: true, purpose: true, conditions: true, expectedBehavior: true, limitations: true } } } })
  const relatedPrompt = existingRelated.map((relation) => `Существующая связь (статус ${relation.status}, это не подтверждённый факт): ${relation.sourcePosition.title} —${relation.kind}→ ${relation.targetPosition.title}; основание: ${relation.rationale}`).join('\n')
  const related = actionType === 'interaction' ? await interactionCandidates(campaign, item) : null
  const retrievedPrompt = related?.positions.map((candidate) => `Кандидат контекста: ${candidate.title}; назначение: ${candidate.purpose}; условия: ${candidate.conditions}; ограничение: ${candidate.limitations}; источники: ${candidate.fragments.map((link) => `${link.fragment.path} ${link.fragment.text}`).join(' | ')}`).join('\n') ?? ''
  const positionText = [
    `Положение ${position.id}: ${position.title}`,
    `Назначение: ${position.purpose}`,
    `Регулируемое решение: ${position.regulatedDecision}`,
    `Условия: ${position.conditions}`,
    `Ожидаемое поведение: ${position.expectedBehavior}`,
    `Исключения и ограничения: ${position.limitations || 'не указаны'}`,
    `Исходные фрагменты:\n${sourceMaterial}`,
    relatedPrompt ? `Связи (не считать проверенными):\n${relatedPrompt}` : '',
    retrievedPrompt ? `Ограниченные retrieval-кандидаты (сходство — только способ отбора):\n${retrievedPrompt}` : '',
  ].filter(Boolean).join('\n\n')

  if (actionType === 'interpretation') return {
    role: 'interpreter' as const,
    prompt: `Проверь соответствие сохранённой интерпретации исходным фрагментам. Не редактируй положение и не создавай вывод от имени пользователя.\n${positionText}\n\nВерни JSON: {"status":"supported"|"concern"|"inconclusive","sourceEvidence":[{"fragmentId":"точный ID","quote":"дословная цитата не короче 12 символов","reason":"почему цитата подтверждает замечание или соответствие"}],"addedObligations":[],"omittedConditions":[],"alternatives":[],"limitations":[]}. Если основание нельзя процитировать дословно — inconclusive.`,
    sourceIds: [...sourceIds],
  }
  if (actionType === 'interaction') return {
    role: 'challenger' as const,
    prompt: `Проверь взаимодействие этого положения с ограниченным контекстом. Не считай существующие связи установленными. Рассмотри область, зависимости, исключения и неоднозначность; не делай вывод только по embedding similarity.\n${positionText}\n\nВерни JSON: {"status":"compatible"|"concern"|"inconclusive","checks":[{"claim":"...","sourceEvidence":[{"fragmentId":"точный ID","quote":"дословная цитата"}],"explanation":"..."}],"alternatives":[],"limitations":[]}. Используй только переданные ID, каждый запрос обоснуй конкретным исходным текстом.`,
    sourceIds: [...new Set([...sourceIds, ...((related?.positions ?? []).flatMap((candidate) => candidate.fragments.map((link) => link.fragment.id)))])],
  }
  if (actionType === 'scenario-plan') return {
    role: 'explorer' as const,
    prompt: `Подготовь не более ${campaign.maxScenariosPerPosition} проверочных сценариев. Не создавай варианты ради количества. Разделяй поля так: objective — требование, которое действительно следует из переданного источника или явно подключённого контекста; input — условие теста, которое может быть гипотетическим и не добавляет норму; expectedBehavior — ожидаемое поведение, выведенное из требования; criterion — наблюдаемая проверка именно этого поведения. Любое дополнительное предположение о контексте укажи в limitations как гипотезу и не используй как обязательный критерий. Не добавляй требования цитирования/ссылки, контексты, определения или обязательства, которых нет в переданных материалах. Связи помечены как неподтверждённые и сами по себе не являются основанием. Если для критерия недостаточно основания — верни пустой список. Сохрани точные source Fragment ID.\n${positionText}\n\nВерни JSON: {"scenarios":[{"title":"...","objective":"...","input":"...","expectedBehavior":"...","criterion":"...","sourceFragmentIds":["точный ID"]}],"notApplicable":[{"type":"...","reason":"..."}],"limitations":[]}. Критерий должен проверяться по ответу Executor и иметь прослеживаемое основание.`,
    sourceIds: [...sourceIds],
  }
  if (actionType === 'concern-review') {
    const priorActions = item.actions.filter((action) => ['interpretation', 'interaction'].includes(action.actionType))
    const priorSourceIds = [...new Set(priorActions.flatMap((action) => action.sources.map((source) => source.fragmentId)))]
    const reviewSourceIds = [...new Set([...sourceIds, ...priorSourceIds])]
    const reviewSources = reviewSourceIds.length ? await db.fragment.findMany({ where: { id: { in: reviewSourceIds }, versionId: campaign.versionId }, select: { id: true, path: true, kind: true, title: true, text: true } }) : sources
    const previous = priorActions.map((action) => `${action.actionType}: ${action.run?.output ?? action.error ?? ''}`).join('\n\n')
    return {
      role: 'challenger' as const,
      prompt: `Попробуй опровергнуть предварительное замечание, проверь альтернативные объяснения. Не создавай Finding и не меняй статусы.\n${positionText}\n\nИсходные материалы, использованные в предварительных проверках:\n${sourceText(reviewSources)}\n\nПредварительные результаты:\n${previous}\n\nВерни JSON: {"supportsConcern":true|false,"arguments":[],"sourceEvidence":[{"fragmentId":"точный ID","quote":"дословная цитата"}],"alternativesConsidered":[],"limitations":[]}. supportsConcern=true допустим только при точной цитате из переданного источника и после рассмотрения альтернатив.`,
      sourceIds: reviewSourceIds,
    }
  }
  if (actionType === 'evaluation-review' && checkId) {
    const check = await db.researchCampaignCheck.findUniqueOrThrow({ where: { id: checkId }, include: { scenario: true, sources: { include: { fragment: true } } } })
    const evaluator = item.actions.find((action) => action.checkId === checkId && action.actionType === 'evaluator')?.run
    const executor = item.actions.find((action) => action.checkId === checkId && action.actionType === 'executor')?.run
    return {
      role: 'challenger' as const,
      prompt: `Проверь, не ошибается ли Evaluator и не является ли замечание проблемой сценария или критерия. Не создавай Finding и не меняй статусы.\nКритерий: ${check.criterion}\nВход: ${check.input}\nОжидаемое поведение: ${check.expectedBehavior}\nОтвет Executor:\n${executor?.output ?? ''}\nОценка Evaluator:\n${evaluator?.output ?? ''}\nИсходные фрагменты:\n${sourceText(check.sources.map((source) => source.fragment))}\n\nВерни JSON: {"supportsConcern":true|false,"arguments":[],"sourceEvidence":[{"fragmentId":"точный ID","quote":"дословная цитата"}],"alternativesConsidered":[],"limitations":[]}. supportsConcern=true допустим только при точной цитате и рассмотрении значимых альтернатив.`,
      sourceIds: check.sources.map((source) => source.fragment.id),
    }
  }
  const check = checkId ? await db.researchCampaignCheck.findUniqueOrThrow({ where: { id: checkId }, include: { sources: { include: { fragment: true } } } }) : null
  if (!check) throw new Error('План сценария не найден')
  if (actionType === 'executor') return {
    role: 'executor' as const,
    prompt: `Выполни вход сценария в соответствии с полной версией инструкции. Не оценивай собственный ответ и не восстанавливай отсутствующие данные догадкой.\nЦель: ${check.objective}\nВход: ${check.input}\nОжидаемое поведение: ${check.expectedBehavior}\nОбязательные исходные фрагменты сценария:\n${sourceText(check.sources.map((source) => source.fragment))}`,
    sourceIds: check.sources.map((source) => source.fragment.id),
    scenarioId: check.scenarioId,
  }
  if (actionType === 'evaluator') {
    const executor = item.actions.find((action) => action.checkId === checkId && action.actionType === 'executor')?.run
    if (!executor || executor.status !== 'completed' || !executor.output) throw new RunValidationError('Нельзя оценить сценарий без полного ответа успешно завершённого Executor.', 409)
    return {
      role: 'evaluator' as const,
      prompt: `Перед оценкой ответа проверь основание самого сценария. Требование и criterion должны следовать из перечисленных исходных фрагментов; input может быть только явно гипотетическим условием теста, а expectedBehavior — выводом из требования. Не превращай гипотезу или выдуманный контекст в норму. Если критерий добавляет не подтверждённое источниками обязательство (например, обязательную ссылку на цитату), либо опирается на отсутствующий контекст, верни criterionBasis=unsupported или unclear и verdict=inconclusive. Не требуй буквального совпадения с цитатой для логического вывода, но укажи основание. Лишь после проверки основания оцени ответ Executor по критерию. Не создавай Finding и не меняй SemanticPosition. Верни JSON: {"criterionBasis":"supported"|"unsupported"|"unclear","verdict":"pass"|"fail"|"inconclusive","reasons":["..."]}.\nТребование/objective: ${check.objective}\nУсловие теста/input: ${check.input}\nВыведенное ожидаемое поведение: ${check.expectedBehavior}\nИсходные материалы:\n${sourceText(check.sources.map((source) => source.fragment))}`,
      criterion: check.criterion,
      outputToEvaluate: executor.output,
      parentRunId: executor.id,
      scenarioId: check.scenarioId,
      sourceIds: check.sources.map((source) => source.fragment.id),
    }
  }
  throw new Error(`Неизвестный этап кампании: ${actionType}`)
}

async function markStageAfterResult(campaignId: string, itemId: string, action: CampaignActionRecord) {
  const campaign = await db.researchCampaign.findUniqueOrThrow({ where: { id: campaignId }, include: campaignInclude })
  const item = campaign.items.find((row) => row.id === itemId)
  if (!item) return
  const run = action.run
  const output = run?.output ?? ''
  const parsed = parseObject(output)
  const sourceIds = action.sources.map((source) => source.fragmentId)
  const sourceRows = sourceIds.length ? await db.fragment.findMany({ where: { id: { in: sourceIds }, versionId: campaign.versionId }, select: { id: true, path: true, text: true } }) : item.position.fragments.map((link) => link.fragment)
  const citationOk = Boolean(parsed && validQuotes(sourceQuotes(parsed), sourceRows))
  if (action.actionType === 'interpretation') {
    const status = parsed?.status
    await db.researchCampaignPosition.update({ where: { id: itemId }, data: {
      interpretationStatus: status === 'supported' && citationOk ? 'supported' : status === 'concern' && citationOk ? 'concern' : 'inconclusive',
      verifiedSourceEvidence: citationOk,
      stage: (status === 'concern' && citationOk) ? 'interactions' : 'interactions',
      status: 'in-progress',
    } })
    return
  }
  if (action.actionType === 'interaction') {
    const status = parsed?.status
    await db.researchCampaignPosition.update({ where: { id: itemId }, data: {
      interactionStatus: status === 'compatible' ? 'compatible' : status === 'concern' ? 'concern' : 'inconclusive',
      verifiedSourceEvidence: item.verifiedSourceEvidence || citationOk,
      stage: 'concern-review', status: 'in-progress',
    } })
    return
  }
  if (action.actionType === 'concern-review') {
    const confirms = parsed?.supportsConcern === true && citationOk
    await db.researchCampaignPosition.update({ where: { id: itemId }, data: {
      reviewStatus: confirms ? 'confirmed' : 'not-confirmed',
      verifiedSourceEvidence: item.verifiedSourceEvidence || citationOk,
      stage: 'scenario-plan', status: 'in-progress',
    } })
    return
  }
  if (action.actionType === 'scenario-plan') {
    const scenarios = Array.isArray(parsed?.scenarios) ? parsed.scenarios : []
    const allowed = new Set(sourceRows.map((fragment) => fragment.id))
    const valid = scenarios.slice(0, campaign.maxScenariosPerPosition).flatMap((raw, index) => {
      if (!raw || typeof raw !== 'object') return []
      const row = raw as Record<string, unknown>
      const ids = Array.isArray(row.sourceFragmentIds) ? row.sourceFragmentIds.filter((id): id is string => typeof id === 'string') : []
      if (![row.title, row.objective, row.input, row.expectedBehavior, row.criterion].every((text) => typeof text === 'string' && text.trim().length >= 8)) return []
      if (!ids.length || ids.some((id) => !allowed.has(id))) return []
      return [{ row, ids, index }]
    })
    for (const { row, ids, index } of valid) {
      const existing = await db.researchCampaignCheck.findFirst({ where: { campaignPositionId: itemId, ordinal: index + 1 } })
      if (existing) continue
      await db.scenario.create({ data: {
        projectId: campaign.projectId, title: `[VALIDATION] [AUTO-RESEARCH] ${String(row.title).trim()}`,
        description: `Требование источника / цель: ${String(row.objective).trim()}\n\nУсловие теста (может быть гипотетическим): ${String(row.input).trim()}\n\nВыведенное ожидаемое поведение: ${String(row.expectedBehavior).trim()}\n\nКритерий проверки: ${String(row.criterion).trim()}\n\nИсточники: ${ids.join(', ')}`,
        status: 'unexplored', origin: 'model', fragmentId: ids[0], order: index, campaignPositionId: itemId,
        campaignCheck: { create: {
          campaignPositionId: itemId, ordinal: index + 1,
          objective: String(row.objective).trim(), input: String(row.input).trim(),
          expectedBehavior: String(row.expectedBehavior).trim(), criterion: String(row.criterion).trim(),
          sources: { create: ids.map((fragmentId) => ({ fragmentId })) },
        } },
      } })
    }
    const notApplicable = Array.isArray(parsed?.notApplicable) ? parsed.notApplicable : []
    for (const raw of notApplicable) {
      if (!raw || typeof raw !== 'object') continue
      const row = raw as Record<string, unknown>
      if (typeof row.type !== 'string' || typeof row.reason !== 'string' || !row.type.trim() || !row.reason.trim()) continue
      const existingSkip = await db.researchCampaignNotApplicableCheck.findFirst({ where: { campaignPositionId: itemId, checkType: row.type.trim() } })
      if (!existingSkip) await db.researchCampaignNotApplicableCheck.create({ data: { campaignPositionId: itemId, checkType: row.type.trim(), rationale: row.reason.trim() } })
    }
    const scenarioLimitations = Array.isArray(parsed?.limitations)
      ? parsed.limitations.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim())
      : []
    const savedLimitations = [
      item.limitations,
      scenarioLimitations.length ? `Допущения/ограничения Explorer (не являются требованиями источника): ${scenarioLimitations.join('; ')}` : null,
    ].filter(Boolean).join('\n')
    await db.researchCampaignPosition.update({ where: { id: itemId }, data: {
      scenarioStatus: valid.length ? 'completed' : 'empty', stage: 'execution', status: 'in-progress',
      limitations: valid.length ? savedLimitations || null : [savedLimitations, 'Explorer не выдал валидных сценариев с проверяемым критерием и источниками.'].filter(Boolean).join('\n'),
    } })
    return
  }
  if (action.actionType === 'executor' || action.actionType === 'evaluator' || action.actionType === 'evaluation-review') {
    const checkId = action.checkId
    if (!checkId) return
    const latest = await db.researchCampaignCheck.findUniqueOrThrow({ where: { id: checkId } })
    if (action.actionType === 'executor' && run?.status === 'completed') await db.researchCampaignCheck.update({ where: { id: checkId }, data: { status: 'running' } })
    if (action.actionType === 'evaluator') await db.researchCampaignCheck.update({ where: { id: checkId }, data: { status: parsed?.criterionBasis === 'supported' && (run?.verdict === 'pass' || run?.verdict === 'fail') ? 'completed' : 'inconclusive' } })
    if (action.actionType === 'evaluation-review') await db.researchCampaignCheck.update({ where: { id: checkId }, data: { status: latest.status === 'completed' ? 'completed' : 'inconclusive' } })
    if (action.actionType === 'evaluation-review' && parsed?.supportsConcern === true && citationOk) {
      await db.researchCampaignPosition.update({ where: { id: itemId }, data: { verifiedSourceEvidence: true, reviewStatus: 'confirmed' } })
    }
  }
}

export type CampaignRunExecutor = (runId: string) => ReturnType<typeof executeRun>

async function executeAction(campaignId: string, itemId: string, actionType: string, checkId: string | null, runExecutor: CampaignRunExecutor = executeRun) {
  let campaign = await db.researchCampaign.findUniqueOrThrow({ where: { id: campaignId }, include: campaignInclude })
  let item = campaign.items.find((row) => row.id === itemId)
  if (!item) throw new RunValidationError('Положение кампании не найдено.', 404)
  const latest = await db.researchCampaignAction.findFirst({ where: { campaignPositionId: itemId, actionType, checkId }, orderBy: { attempt: 'desc' }, include: { run: true, check: true, sources: true } })
  const recovery = campaignRunRecovery(latest?.run?.status)
  if (recovery === 'use-existing-result' && latest?.run) {
    if (latest.status !== 'completed') await db.researchCampaignAction.update({ where: { id: latest.id }, data: { status: 'completed', finishedAt: latest.run.finishedAt ?? new Date() } })
    await markStageAfterResult(campaignId, itemId, { ...latest, status: 'completed' })
    return { kind: 'stage-updated' as const, action: latest }
  }
  if (recovery === 'inspect-failure' && latest?.run && latest.status !== 'failed') {
    latest.status = 'failed'
    latest.error = latest.run.error ?? `Run завершился со статусом ${latest.run.status}.`
    await db.researchCampaignAction.update({ where: { id: latest.id }, data: { status: 'failed', error: latest.error, finishedAt: latest.run.finishedAt ?? new Date() } })
  }
  if (recovery === 'execute-existing' || recovery === 'wait-existing') {
    if (!latest?.run) throw new RunValidationError('Сохранённое действие потеряло связь с Run.', 409)
    if (recovery === 'wait-existing') return { kind: 'waiting' as const, action: latest }
    const run = await runExecutor(latest.run.id)
    if (!run) return { kind: 'waiting' as const, action: latest }
    const finished = await db.researchCampaignAction.update({ where: { id: latest.id }, data: { status: run.status === 'completed' ? 'completed' : run.status === 'cancelled' ? 'cancelled' : 'failed', error: run.error, finishedAt: run.finishedAt ?? new Date() }, include: { run: true, check: true, sources: true } })
    if (run.status === 'completed') await markStageAfterResult(campaignId, itemId, finished)
    else await handleFailedAction(campaignId, itemId, finished.error ?? run.error ?? 'Неизвестная ошибка', run.status)
    return { kind: run.status === 'completed' ? 'action-completed' as const : 'action-failed' as const, action: finished }
  }
  if (latest?.status === 'failed') {
    const error = latest.error ?? latest.run?.error ?? 'Модельное действие завершилось ошибкой.'
    const failureAction = campaignFailureAction(error, latest.attempt, campaign.maxRetriesPerAction)
    if (failureAction === 'pause-for-quota') {
      await pauseForProviderBlock(campaignId, itemId, error)
      return { kind: 'blocked' as const, error }
    }
    if (failureAction === 'inconclusive') {
      await markActionInconclusive(campaignId, itemId, actionType, error)
      if (campaign.stopOnTechnicalError) await db.researchCampaign.update({ where: { id: campaignId }, data: { status: 'paused', pauseReason: 'technical-error', lastError: error } })
      return { kind: 'action-failed' as const, error }
    }
  }

  campaign = await db.researchCampaign.findUniqueOrThrow({ where: { id: campaignId }, include: campaignInclude })
  item = campaign.items.find((row) => row.id === itemId)!
  if (campaign.maxModelActions !== null && campaign.modelActionsUsed >= campaign.maxModelActions) {
    await db.researchCampaign.update({ where: { id: campaignId }, data: { status: 'paused', pauseReason: 'policy-budget-exhausted', lastError: 'Предел текстовых модельных действий исчерпан.' } })
    await db.researchCampaignPosition.update({ where: { id: itemId }, data: { status: 'blocked', conclusion: 'blocked', limitations: 'Предел текстовых действий кампании исчерпан до завершения проверки.' } })
    return { kind: 'blocked' as const, error: 'Предел текстовых модельных действий исчерпан.' }
  }

  const previousAttempts = await db.researchCampaignAction.findMany({ where: { campaignPositionId: itemId, actionType, checkId }, select: { attempt: true } })
  const retryPlanned = latest?.status === 'planned' && !latest.run ? latest : null
  const attempt = retryPlanned?.attempt ?? (Math.max(0, ...previousAttempts.map((row) => row.attempt)) + 1)
  const role = actionType === 'interaction' || actionType.endsWith('review') ? 'challenger'
    : actionType === 'interpretation' ? 'interpreter'
      : actionType === 'scenario-plan' ? 'explorer'
        : actionType
  const roleSnapshot = campaign.roles.find((row) => row.role === role)
  if (!roleSnapshot) throw new RunValidationError(`В снимке политики нет назначения роли ${role}.`)
  const connection = await db.connection.findUnique({ where: { id: roleSnapshot.connectionId } })
  if (!connection || connection.kind !== roleSnapshot.backend) {
    await pauseForProviderBlock(campaignId, itemId, `Подключение ${roleSnapshot.connectionName} для ${role} недоступно. Выберите подключение для новой кампании.`)
    return { kind: 'blocked' as const, error: `Подключение для роли ${role} недоступно.` }
  }
  const spec = await actionPrompt(campaign, item, actionType, checkId)
  if (!await db.researchCampaign.findFirst({ where: { id: campaignId, status: 'running' }, select: { id: true } })) return { kind: 'campaign-stopped' as const }
  const actionKey = `${campaignId}:${itemId}:${actionType}:${checkId ?? 'none'}:${attempt}`
  const action = retryPlanned ?? await db.researchCampaignAction.create({ data: {
    actionKey, campaignId, campaignPositionId: itemId, checkId, scenarioId: checkId ? item.scenarios.find((scenario) => scenario.campaignCheck?.id === checkId)?.id ?? null : null,
    actionType, role, attempt, status: 'planned', startedAt: new Date(),
    sources: { create: [...new Set(spec.sourceIds)].map((fragmentId) => ({ fragmentId })) },
  } })
  if (!retryPlanned) await db.researchCampaign.update({ where: { id: campaignId }, data: { modelActionsUsed: { increment: 1 }, stage: actionType } })
  const instruction = await resolveInstructionContext({ projectId: campaign.projectId, selection: noneContext(campaign.versionId), fallbackVersionId: campaign.versionId })
  let messages: { role: 'system' | 'user' | 'assistant'; content: string }[] | undefined
  if (spec.role !== 'executor') {
    const built = spec.role === 'evaluator'
      ? rolePrompt('evaluator', spec.prompt, { criterion: spec.criterion, output: spec.outputToEvaluate })
      : rolePrompt(spec.role, spec.prompt)
    messages = [{ role: 'system', content: built.system }, { role: 'user', content: built.user }]
  }
  const taskContext = spec.role === 'evaluator'
    ? { versionId: campaign.versionId, scenarioId: spec.scenarioId, criterion: spec.criterion, outputToEvaluate: spec.outputToEvaluate, instructionContext: noneContext(campaign.versionId) }
    : { versionId: campaign.versionId, ...(spec.scenarioId ? { scenarioId: spec.scenarioId } : {}), instructionContext: spec.role === 'executor' ? { mode: 'full' as const, versionId: campaign.versionId, fragmentIds: [], includeParentSections: false } : noneContext(campaign.versionId) }
  let run
  try {
    run = await createRun({
      projectId: campaign.projectId,
      role: spec.role,
      backend: roleSnapshot.backend as 'ollama' | 'freellmapi',
      connectionId: roleSnapshot.connectionId,
      model: roleSnapshot.model,
      scenarioId: spec.scenarioId ?? null,
      versionId: campaign.versionId,
      parentRunId: 'parentRunId' in spec ? spec.parentRunId : null,
      prompt: spec.prompt,
      sentMessages: messages,
      contextProvenance: spec.role === 'executor' ? undefined : instruction,
      action: `automated-research-${actionType}`,
      campaignActionId: action.id,
      settings: { temperature: 0, timeoutMs: 120000, programChecks: false },
      taskContext,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db.researchCampaignAction.update({ where: { id: action.id }, data: { status: 'failed', error: message, finishedAt: new Date() } })
    await handleFailedAction(campaignId, itemId, message)
    return { kind: 'action-failed' as const, error: message }
  }
  await db.researchCampaignAction.update({ where: { id: action.id }, data: { status: 'running' } })
  const finishedRun = await runExecutor(run.id)
  if (!finishedRun) return { kind: 'waiting' as const, action }
  const finishedAction = await db.researchCampaignAction.update({ where: { id: action.id }, data: {
    status: finishedRun.status === 'completed' ? 'completed' : finishedRun.status === 'cancelled' ? 'cancelled' : 'failed',
    error: finishedRun.error, finishedAt: finishedRun.finishedAt ?? new Date(),
  }, include: { run: true, check: true, sources: true } })
  const campaignState = await db.researchCampaign.findUnique({ where: { id: campaignId }, select: { status: true } })
  if (finishedRun.status === 'completed' && campaignState?.status === 'running') await markStageAfterResult(campaignId, itemId, finishedAction)
  else if (finishedRun.status !== 'completed' && campaignState?.status === 'running') await handleFailedAction(campaignId, itemId, finishedRun.error ?? 'Провайдер вернул пустой результат.', finishedRun.status)
  return { kind: finishedRun.status === 'completed' ? 'action-completed' as const : 'action-failed' as const, action: finishedAction }
}

async function pauseForProviderBlock(campaignId: string, itemId: string, message: string) {
  await db.researchCampaign.update({ where: { id: campaignId }, data: { status: 'paused', pauseReason: 'provider-quota', lastError: message } })
  await db.researchCampaignPosition.update({ where: { id: itemId }, data: { status: 'in-progress', conclusion: 'blocked', limitations: message } })
}

async function handleFailedAction(campaignId: string, itemId: string, message: string, runStatus?: string | null) {
  const campaign = await db.researchCampaign.findUniqueOrThrow({ where: { id: campaignId } })
  const latest = await db.researchCampaignAction.findFirst({ where: { campaignPositionId: itemId }, orderBy: { createdAt: 'desc' } })
  const failureAction = campaignFailureAction(message, latest?.attempt ?? campaign.maxRetriesPerAction, campaign.maxRetriesPerAction, runStatus)
  if (failureAction === 'pause-for-quota') { await pauseForProviderBlock(campaignId, itemId, message); return }
  if (failureAction === 'retry') return
  const type = latest?.actionType ?? 'unknown'
  await markActionInconclusive(campaignId, itemId, type, message)
  if (campaign.stopOnTechnicalError) await db.researchCampaign.update({ where: { id: campaignId }, data: { status: 'paused', pauseReason: 'technical-error', lastError: message } })
}

async function markActionInconclusive(campaignId: string, itemId: string, type: string, error: string) {
  const data: Record<string, unknown> = { status: 'in-progress', limitations: error }
  if (type === 'interpretation') { data.interpretationStatus = 'inconclusive'; data.stage = 'interactions' }
  else if (type === 'interaction') { data.interactionStatus = 'inconclusive'; data.stage = 'concern-review' }
  else if (type === 'concern-review') { data.reviewStatus = 'not-confirmed'; data.stage = 'scenario-plan' }
  else if (type === 'scenario-plan') { data.scenarioStatus = 'empty'; data.stage = 'execution' }
  else if (type === 'executor' || type === 'evaluator' || type === 'evaluation-review') { data.executionStatus = 'inconclusive'; data.stage = 'execution' }
  await db.researchCampaignPosition.update({ where: { id: itemId }, data })
  if (type === 'executor' || type === 'evaluator') {
    const latest = await db.researchCampaignAction.findFirst({ where: { campaignPositionId: itemId, actionType: type, checkId: { not: null } }, orderBy: { createdAt: 'desc' } })
    if (latest?.checkId) await db.researchCampaignCheck.update({ where: { id: latest.checkId }, data: { status: 'inconclusive' } })
  }
  await db.researchCampaign.update({ where: { id: campaignId }, data: { lastError: error } })
}

async function nextActionForItem(campaign: CampaignRecord, itemId: string, runExecutor: CampaignRunExecutor = executeRun) {
  let current = await db.researchCampaign.findUniqueOrThrow({ where: { id: campaign.id }, include: campaignInclude })
  if (current.status !== 'running') return { kind: 'campaign-stopped' as const }
  let item = current.items.find((row) => row.id === itemId)!
  const depth = current.depth as CampaignDepth
  const skipStage = async (stage: string, next: string, field?: string) => {
    const data: Record<string, unknown> = { stage: next }
    if (field) data[field] = 'skipped'
    await db.researchCampaignPosition.update({ where: { id: item.id }, data })
    return { kind: 'stage-skipped' as const, action: stage }
  }
  if (item.stage === 'interpretation') {
    if (depth === 'interpretation') return skipStage('interpretation', 'complete')
    return executeAction(current.id, item.id, 'interpretation', null, runExecutor)
  }
  if (item.stage === 'interactions') {
    if (!['interactions', 'scenarios', 'full'].includes(depth)) return skipStage('interactions', 'complete', 'interactionStatus')
    return executeAction(current.id, item.id, 'interaction', null, runExecutor)
  }
  if (item.stage === 'concern-review') {
    const concern = item.interpretationStatus === 'concern' || item.interactionStatus === 'concern'
    const prior = await db.researchCampaignAction.findFirst({ where: { campaignPositionId: item.id, actionType: 'concern-review' }, orderBy: { attempt: 'desc' } })
    const retryPending = prior?.status === 'failed'
    if (!concern || current.maxAdditionalChecksPerPosition <= 0 || (item.additionalChecksUsed >= current.maxAdditionalChecksPerPosition && !retryPending)) {
      return skipStage('concern-review', 'scenario-plan')
    }
    if (!prior) await db.researchCampaignPosition.update({ where: { id: item.id }, data: { additionalChecksUsed: { increment: 1 } } })
    return executeAction(current.id, item.id, 'concern-review', null, runExecutor)
  }
  if (item.stage === 'scenario-plan') {
    if (!['scenarios', 'full'].includes(depth)) return skipStage('scenario-plan', 'complete', 'scenarioStatus')
    return executeAction(current.id, item.id, 'scenario-plan', null, runExecutor)
  }
  if (item.stage === 'execution') {
    if (depth !== 'full') return skipStage('execution', 'complete', 'executionStatus')
    const checks = item.scenarios.map((scenario) => scenario.campaignCheck).filter((check): check is NonNullable<typeof check> => Boolean(check)).sort((a, b) => a.ordinal - b.ordinal)
    if (!checks.length) {
      await db.researchCampaignPosition.update({ where: { id: item.id }, data: { executionStatus: 'inconclusive', stage: 'complete', status: 'in-progress' } })
      return { kind: 'stage-empty' as const }
    }
    for (const check of checks) {
      const checkActions = item.actions.filter((action) => action.checkId === check.id)
      const executor = checkActions.filter((action) => action.actionType === 'executor').sort((a, b) => b.attempt - a.attempt)[0]
      if (!executor || executor.status !== 'completed') return executeAction(current.id, item.id, 'executor', check.id, runExecutor)
      const evaluator = checkActions.filter((action) => action.actionType === 'evaluator').sort((a, b) => b.attempt - a.attempt)[0]
      if (!evaluator || evaluator.status !== 'completed') return executeAction(current.id, item.id, 'evaluator', check.id, runExecutor)
      if (evaluator.run?.verdict === 'fail') {
        const used = item.additionalChecksUsed
        const challenge = checkActions.filter((action) => action.actionType === 'evaluation-review').sort((a, b) => b.attempt - a.attempt)[0]
        if (challenge && challenge.status !== 'completed') return executeAction(current.id, item.id, 'evaluation-review', check.id, runExecutor)
        if (!challenge && used < current.maxAdditionalChecksPerPosition) {
          await db.researchCampaignPosition.update({ where: { id: item.id }, data: { additionalChecksUsed: { increment: 1 } } })
          return executeAction(current.id, item.id, 'evaluation-review', check.id, runExecutor)
        }
      }
      if (check.status === 'running') await db.researchCampaignCheck.update({ where: { id: check.id }, data: { status: evaluator.run?.verdict ? 'completed' : 'inconclusive' } })
    }
    // Keep the item eligible for the next advance, which records its conclusion.
    await db.researchCampaignPosition.update({ where: { id: item.id }, data: { executionStatus: 'completed', stage: 'complete', status: 'in-progress' } })
    return { kind: 'stage-completed' as const }
  }
  if (item.stage === 'complete') {
    const conclusion = deriveCampaignConclusion(await evidenceState(current, item))
    await db.researchCampaignPosition.update({ where: { id: item.id }, data: { status: 'completed', stage: 'complete', conclusion: conclusion.conclusion, conclusionSummary: conclusion.summary, finishedAt: new Date() } })
    return { kind: 'conclusion-saved' as const, conclusion }
  }
  return skipStage(item.stage, 'complete')
}

export async function advanceResearchCampaign(projectId: string, versionId: string, campaignId: string, runExecutor: CampaignRunExecutor = executeRun) {
  const campaign = await db.researchCampaign.findFirst({ where: { id: campaignId, projectId, versionId }, include: { version: { select: { content: true, contentHash: true } }, items: { orderBy: { order: 'asc' } } } })
  if (!campaign) throw new RunValidationError('Кампания не найдена в этой версии.', 404)
  if (campaignVersionState(campaign.contentHash, campaign.version.contentHash) === 'stale' || textHash(campaign.version.content) !== campaign.contentHash) {
    await db.researchCampaign.update({ where: { id: campaign.id }, data: { status: 'blocked', pauseReason: 'version-changed', lastError: 'Хэш версии отличается от сохранённого снимка. Кампания остановлена.' } })
    return { kind: 'blocked', error: 'Версия инструкции изменилась; результаты кампании нельзя продолжать как актуальные.' }
  }
  if (campaign.status !== 'running') throw new RunValidationError('Кампания не выполняется. Используйте «Возобновить» после проверки блокировки.', 409)
  const token = randomUUID()
  const now = new Date()
  const claim = await db.researchCampaign.updateMany({
    where: { id: campaign.id, status: 'running', OR: [{ workerLeaseUntil: null }, { workerLeaseUntil: { lt: now } }] },
    data: { workerToken: token, workerLeaseUntil: new Date(now.getTime() + 180000) },
  })
  if (!claim.count) return { kind: 'waiting', error: 'Другой ограниченный шаг кампании ещё выполняется.' }
  try {
    const current = await db.researchCampaign.findUniqueOrThrow({ where: { id: campaign.id }, include: campaignInclude })
    for (const item of current.items) {
      if (item.status === 'completed' || item.status === 'blocked') continue
      if (!item.position.fragments.length) {
        await db.researchCampaignPosition.update({ where: { id: item.id }, data: { status: 'blocked', stage: 'complete', conclusion: 'insufficient-data', limitations: 'Нет исходных Fragment для проверки.', finishedAt: new Date() } })
        continue
      }
      await db.researchCampaignPosition.updateMany({ where: { id: item.id, startedAt: null }, data: { startedAt: new Date(), status: 'in-progress' } })
      const result = await nextActionForItem(current as unknown as CampaignRecord, item.id, runExecutor)
      if (result.kind === 'waiting') return { ...result, campaignId }
      const updated = await refreshCampaignStatus(campaign.id)
      return { ...result, campaign: await getCampaignById(updated.id) }
    }
    const updated = await refreshCampaignStatus(current.id)
    return { kind: 'campaign-complete', campaign: await getCampaignById(updated.id) }
  } finally {
    await db.researchCampaign.updateMany({ where: { id: campaign.id, workerToken: token }, data: { workerToken: null, workerLeaseUntil: null } }).catch(() => undefined)
  }
}

async function getCampaignById(id: string) {
  const campaign = await db.researchCampaign.findUniqueOrThrow({ where: { id }, include: campaignInclude })
  const runIds = campaign.items.flatMap((item) => item.actions.flatMap((action) => action.run?.id ? [action.run.id] : []))
  const modelCalls = runIds.length ? await db.modelCall.findMany({ where: { runId: { in: runIds } }, select: { id: true, runId: true, actualProvider: true, actualModel: true }, orderBy: { createdAt: 'desc' } }) : []
  const actualByRun = new Map(modelCalls.map((call) => [call.runId, { modelCallId: call.id, actualProvider: call.actualProvider, actualModel: call.actualModel }]))
  return {
    ...campaign,
    budgetHistory: safeParse(campaign.budgetHistory, []),
    versionState: campaignVersionState(campaign.contentHash, campaign.version.contentHash),
    items: campaign.items.map((item) => ({
      ...item,
      position: { id: item.position.id, title: item.position.title, status: item.position.status, purpose: item.position.purpose, path: item.position.fragments.map((link) => link.fragment.path).join(', '), sourceCount: item.position.fragments.length },
      scenarios: item.scenarios.map((scenario) => scenario),
      actions: item.actions.map((action) => ({ ...action, run: action.run ? { id: action.run.id, status: action.run.status, role: action.run.role, verdict: action.run.verdict, output: action.run.output, error: action.run.error, backend: action.run.backend, connectionName: action.run.connectionName, model: action.run.model, ...(actualByRun.get(action.run.id) ?? { modelCallId: null, actualProvider: null, actualModel: null }) } : null })),
    })),
  }
}

export async function controlResearchCampaign(projectId: string, versionId: string, campaignId: string, action: 'start' | 'pause' | 'resume' | 'cancel') {
  const campaign = await db.researchCampaign.findFirst({ where: { id: campaignId, projectId, versionId }, include: { items: { include: { actions: { include: { run: true } } } }, version: { select: { content: true, contentHash: true } } } })
  if (!campaign) throw new RunValidationError('Кампания не найдена.', 404)
  const versionState = campaignVersionState(campaign.contentHash, campaign.version.contentHash)
  if ((action === 'resume' || action === 'start') && versionState === 'stale') throw new RunValidationError('Версия изменилась; эту кампанию нельзя запускать или возобновлять.', 409)
  if (action === 'start') {
    if (campaign.status === 'running') return getCampaignById(campaign.id)
    const block = campaignResumeBlock({ ...campaign, versionState, latestFailedAttempt: null })
    if (campaign.status !== 'prepared' || block) throw new RunValidationError(block ?? 'Запустить можно только подготовленную кампанию.', 409)
    const roleConnections = await db.connection.findMany({ where: { id: { in: (await db.researchCampaignRole.findMany({ where: { campaignId }, select: { connectionId: true, backend: true } })).map((row) => row.connectionId) } }, select: { id: true, kind: true } })
    const liveConnections = new Map(roleConnections.map((row) => [row.id, row.kind]))
    const roleRows = await db.researchCampaignRole.findMany({ where: { campaignId }, select: { role: true, connectionId: true, backend: true } })
    const missing = roleRows.find((row) => liveConnections.get(row.connectionId) !== row.backend)
    if (missing) throw new RunValidationError(`Подключение роли ${missing.role} изменилось или недоступно. Проверьте «Подключения» и создайте новую кампанию.`, 409)
    await db.researchCampaign.update({ where: { id: campaign.id }, data: { status: 'running', stage: 'interpretation', pauseReason: null, lastError: null, startedAt: new Date(), finishedAt: null } })
  } else if (action === 'pause' || action === 'cancel') {
    if (action === 'pause' && campaign.status !== 'running') throw new RunValidationError('Приостановить можно только выполняющуюся кампанию.', 409)
    if (action === 'cancel' && !['prepared', 'running', 'paused'].includes(campaign.status)) throw new RunValidationError('В этом состоянии кампанию нельзя отменить.', 409)
    for (const item of campaign.items) for (const row of item.actions) {
      if (row.run?.status === 'running') cancelRun(row.run.id)
    }
    const history = safeParse<CampaignProcessHistory[]>(campaign.processHistory, [])
    history.push({ at: new Date().toISOString(), action: action === 'pause' ? 'paused-by-user' : 'stopped-by-user', basis: 'Явное действие пользователя; текущий внешний запрос мог завершиться позже.' })
    await db.researchCampaign.update({ where: { id: campaign.id }, data: { status: action === 'pause' ? 'paused' : 'cancelled', pauseReason: action === 'pause' ? 'user-paused' : 'user-cancelled', finishedAt: action === 'cancel' ? new Date() : null, processHistory: JSON.stringify(history) } })
  } else {
    const latestFailedAttempt = campaign.items.flatMap((item) => item.actions.filter((row) => row.status === 'failed').map((row) => row.attempt)).sort((a, b) => b - a)[0] ?? null
    const block = campaignResumeBlock({ ...campaign, versionState, latestFailedAttempt })
    if (campaign.status === 'running') return getCampaignById(campaign.id)
    if (campaign.status !== 'paused' || block) throw new RunValidationError(block ?? 'Возобновить можно только кампанию на паузе.', 409)
    await db.researchCampaign.update({ where: { id: campaign.id }, data: { status: 'running', pauseReason: null, lastError: null, startedAt: campaign.startedAt ?? new Date(), finishedAt: null } })
  }
  return getCampaignById(campaign.id)
}

export async function updateCampaignActionBudget(projectId: string, versionId: string, campaignId: string, maxModelActions: number | null) {
  const campaign = await db.researchCampaign.findFirst({ where: { id: campaignId, projectId, versionId }, select: { id: true, status: true, pauseReason: true, maxModelActions: true, budgetHistory: true, modelActionsUsed: true, workerLeaseUntil: true } })
  if (!campaign) throw new RunValidationError('Кампания не найдена.', 404)
  if (campaign.status !== 'paused' || campaign.workerLeaseUntil || campaign.pauseReason === 'import-reconciliation') throw new RunValidationError('Бюджет можно изменить только у остановленной и сверенной кампании без активного шага.', 409)
  if (maxModelActions !== null && (!Number.isSafeInteger(maxModelActions) || maxModelActions < campaign.modelActionsUsed || maxModelActions < 1)) {
    throw new RunValidationError(`Ограниченный предел должен быть положительным безопасным целым числом и не меньше уже использованного количества (${campaign.modelActionsUsed}).`, 400)
  }
  if (campaign.maxModelActions === maxModelActions) throw new RunValidationError('Выберите режим или значение бюджета, отличающееся от сохранённого.', 400)
  const history = safeParse<Array<{ changedAt: string; before: { mode: 'limited' | 'unlimited'; maxModelActions: number | null }; after: { mode: 'limited' | 'unlimited'; maxModelActions: number | null }; modelActionsUsed: number }>>(campaign.budgetHistory, [])
  history.push({
    changedAt: new Date().toISOString(),
    before: { mode: campaign.maxModelActions === null ? 'unlimited' : 'limited', maxModelActions: campaign.maxModelActions },
    after: { mode: maxModelActions === null ? 'unlimited' : 'limited', maxModelActions },
    modelActionsUsed: campaign.modelActionsUsed,
  })
  await db.researchCampaign.update({ where: { id: campaign.id }, data: { maxModelActions, budgetHistory: JSON.stringify(history) } })
  return getCampaignById(campaign.id)
}

type CampaignProcessHistory = { at: string; action: string; basis: string; relatedCampaignId?: string }

export async function restartResearchCampaign(projectId: string, versionId: string, campaignId: string) {
  const source = await db.researchCampaign.findFirst({
    where: { id: campaignId, projectId, versionId },
    include: { items: { orderBy: { order: 'asc' }, include: { position: { include: { fragments: { select: { fragmentId: true } } } } } }, roles: true, version: { select: { contentHash: true } } },
  })
  if (!source) throw new RunValidationError('Кампания не найдена в этой версии.', 404)
  if (source.status === 'running' || source.status === 'prepared' || source.workerLeaseUntil && source.workerLeaseUntil > new Date()) throw new RunValidationError('Новое исследование можно создать только после остановки или завершения исходной кампании.', 409)
  if (source.contentHash !== source.version.contentHash) throw new RunValidationError('Версия изменилась. Создайте кампанию по актуальной версии, не копируя устаревший снимок.', 409)
  const basis = 'Пользователь явно создал новое исследование с исходной областью, политикой и сохранёнными снимками назначений.'
  const restarted = await db.researchCampaign.create({
    data: {
      projectId, versionId, predecessorCampaignId: source.id,
      processHistory: JSON.stringify([{ at: new Date().toISOString(), action: 'created-from-predecessor', basis, relatedCampaignId: source.id } satisfies CampaignProcessHistory]),
      contentHash: source.contentHash, scopeType: source.scopeType, scopeSnapshot: source.scopeSnapshot, depth: source.depth,
      maxScenariosPerPosition: source.maxScenariosPerPosition, maxModelActions: source.maxModelActions,
      budgetHistory: source.budgetHistory, maxAdditionalChecksPerPosition: source.maxAdditionalChecksPerPosition,
      maxRetriesPerAction: source.maxRetriesPerAction, maxConcurrent: source.maxConcurrent,
      stopOnQuota: source.stopOnQuota, stopOnTechnicalError: source.stopOnTechnicalError,
      allowRewriteExperiment: source.allowRewriteExperiment, status: 'prepared', stage: 'interpretation',
      modelActionsUsed: 0, unmappedFragmentsCount: source.unmappedFragmentsCount,
      roles: { create: source.roles.map(({ role, backend, connectionId, connectionName, model }) => ({ role, backend, connectionId, connectionName, model })) },
      items: { create: source.items.map((item) => ({
        positionId: item.positionId, order: item.order,
        status: item.position.fragments.length ? 'unexplored' : 'blocked', stage: item.position.fragments.length ? 'interpretation' : 'complete',
        conclusion: item.position.fragments.length ? 'not-explored' : 'insufficient-data',
        limitations: item.position.fragments.length ? null : 'У положения нет доступных исходных фрагментов.',
      })) },
    },
    select: { id: true },
  })
  return getCampaignById(restarted.id)
}

export async function reconcileResearchCampaign(projectId: string, versionId: string, campaignId: string, basis: string, activeRunIds: ReadonlySet<string>) {
  const campaign = await db.researchCampaign.findFirst({ where: { id: campaignId, projectId, versionId }, include: { actions: { include: { run: true } } } })
  if (!campaign) throw new RunValidationError('Кампания не найдена в этой версии.', 404)
  if (campaign.status !== 'running') throw new RunValidationError('Сверка доступна только для кампании со статусом running.', 409)
  if (campaign.workerLeaseUntil && campaign.workerLeaseUntil > new Date()) throw new RunValidationError('У кампании ещё действует lease. Запрос не закрыт; повторите сверку после проверки активного шага.', 409)
  const runningRuns = campaign.actions.flatMap((action) => action.run?.status === 'running' ? [action.run] : [])
  if (runningRuns.some((run) => activeRunIds.has(run.id))) throw new RunValidationError('Обнаружен живой локальный Run. Сначала остановите его штатной кнопкой.', 409)
  const trimmedBasis = basis.trim()
  if (trimmedBasis.length < 8) throw new RunValidationError('Укажите основание сверки (не менее 8 символов).', 400)
  const now = new Date().toISOString()
  for (const run of runningRuns) {
    const input = safeParse<Record<string, unknown>>(run.input, {})
    const history = Array.isArray(input.processControlHistory) ? input.processControlHistory : []
    const processControlHistory = [...history, { at: now, action: 'force-close-after-reconciliation', basis: trimmedBasis, result: 'local-execution-owner-not-found; provider-result-unknown' }]
    const changed = await db.run.updateMany({ where: { id: run.id, status: 'running' }, data: { status: 'failed', error: `Принудительно закрыт после сверки: ${trimmedBasis}. Фактическое завершение у провайдера неизвестно.`, finishedAt: new Date(), input: JSON.stringify({ ...input, processControlHistory }) } })
    if (changed.count) await db.researchCampaignAction.updateMany({ where: { run: { id: run.id }, status: 'running' }, data: { status: 'failed', error: `Run закрыт после явной сверки: ${trimmedBasis}`, finishedAt: new Date() } })
  }
  const history = safeParse<CampaignProcessHistory[]>(campaign.processHistory, [])
  history.push({ at: now, action: 'force-close-after-reconciliation', basis: trimmedBasis })
  const updated = await db.researchCampaign.updateMany({
    where: { id: campaign.id, projectId, versionId, status: 'running', OR: [{ workerLeaseUntil: null }, { workerLeaseUntil: { lt: new Date() } }] },
    data: { status: 'paused', pauseReason: 'process-reconciliation', lastError: 'Пользователь остановил неподтверждённое выполнение после сверки. Итог внешнего провайдера неизвестен.', workerToken: null, workerLeaseUntil: null, processHistory: JSON.stringify(history) },
  })
  if (!updated.count) throw new RunValidationError('Состояние кампании изменилось во время сверки. Обновите список и проверьте её снова.', 409)
  return getCampaignById(campaign.id)
}

export async function buildCampaignPreview(projectId: string, versionId: string) {
  const version = await db.documentVersion.findFirst({ where: { id: versionId, projectId }, include: { fragments: { select: { id: true, path: true } } } })
  if (!version) throw new RunValidationError('Версия не найдена.', 404)
  const positions = await db.semanticPosition.findMany({ where: { projectId, versionId }, include: { fragments: { include: { fragment: { select: { id: true, path: true } } } } }, orderBy: { title: 'asc' } })
  const sections = [...new Set(version.fragments.map((fragment) => fragment.path.split('.')[0]))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  return {
    projectId, versionId, contentHash: version.contentHash, versionLabel: version.label,
    sections,
    positions: positions.map((position) => ({ id: position.id, title: position.title, status: position.status, sourceCount: position.fragments.length, paths: position.fragments.map((link) => link.fragment.path) })),
  }
}

export async function campaignCounts(projectId: string, versionId: string) {
  const rows = await db.researchCampaign.findMany({ where: { projectId, versionId }, select: { status: true, modelActionsUsed: true, maxModelActions: true, items: { select: { conclusion: true, status: true } } } })
  return { campaigns: rows.length, active: rows.filter((row) => row.status === 'running').length, modelActionsUsed: rows.reduce((sum, row) => sum + row.modelActionsUsed, 0), outcomes: rows.flatMap((row) => row.items.map((item) => item.conclusion)) }
}
