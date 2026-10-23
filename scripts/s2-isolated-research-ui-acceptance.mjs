import fs from 'node:fs'
import path from 'node:path'
import Module, { createRequire } from 'node:module'
import crypto from 'node:crypto'

const repo = process.argv[2]
const dbFile = process.argv[3]
const load = createRequire(path.join(repo, 'package.json'))
const ts = load(path.join(repo, 'node_modules/typescript'))
process.env.DATABASE_URL = `file:${dbFile.replaceAll('\\', '/')}`
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) request = path.join(repo, 'src', request.slice(2))
  return originalResolve.call(this, request, parent, isMain, options)
}
load.extensions['.ts'] = (mod, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  mod._compile(output, filename)
}
const check = (ok, message) => { if (!ok) throw new Error(message) }
const originalConsoleLog = console.log
console.log = (...args) => { if (!String(args[0]).startsWith('prisma:query')) originalConsoleLog(...args) }
const call = (handler, body) => handler(new Request('http://local/api/research-campaign', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
const json = async (response) => ({ status: response.status, body: await response.json() })

async function main() {
  const { db } = load(path.join(repo, 'src/lib/db.ts'))
  const { buildFragmentsForVersion } = load(path.join(repo, 'src/lib/parser.ts'))
  const { createResearchCampaignHandlers } = load(path.join(repo, 'src/app/api/research-campaign/route.ts'))
  const { createSemanticSearchHandler } = load(path.join(repo, 'src/app/api/semantic/search/route.ts'))
  const { PATCH: patchPosition } = load(path.join(repo, 'src/app/api/semantic/positions/[id]/route.ts'))
  const project = await db.project.create({ data: { name: '[DIAGNOSTIC] Research UI campaign fixture', description: 'Изолированный synthetic fixture; не результат исследования.', origin: 'user' } })
  const document = await db.document.create({ data: { projectId: project.id, title: '[DIAGNOSTIC] Fixture' } })
  const content = '# Fixture\n\nСохраняй исходное сообщение и не восстанавливай отсутствующее значение догадкой.'
  const version = await db.documentVersion.create({ data: { projectId: project.id, documentId: document.id, label: 'fixture', kind: 'original', source: 'user-fixture', content, contentHash: crypto.createHash('sha256').update(content).digest('hex'), isActive: true } })
  await db.fragment.createMany({ data: buildFragmentsForVersion(version.id, content) })
  const fragment = await db.fragment.findFirstOrThrow({ where: { versionId: version.id, kind: 'paragraph' } })
  const position = await db.semanticPosition.create({ data: {
    projectId: project.id, versionId: version.id, title: 'Synthetic source position', purpose: 'Fixture only.', regulatedDecision: 'Check no invented value.', conditions: 'Input may omit message.', expectedBehavior: 'Preserve absence.', limitations: 'Not an actual research claim.', provenance: 'user', status: 'proposed', fragments: { create: { fragmentId: fragment.id } },
  } })
  const connection = await db.connection.create({ data: { projectId: project.id, name: 'FreeLLMAPI fixture (mock only)', kind: 'freellmapi', baseUrl: 'http://127.0.0.1:9' } })
  const embeddingConnection = await db.connection.create({ data: { projectId: project.id, name: 'Ollama embedding fixture (mock only)', kind: 'ollama', baseUrl: 'http://127.0.0.1:9' } })
  await db.assignment.create({ data: { projectId: project.id, role: 'interpreter', backend: 'freellmapi', connectionId: connection.id, model: 'auto' } })
  await db.assignment.create({ data: { projectId: project.id, role: 'challenger', backend: 'freellmapi', connectionId: connection.id, model: 'auto' } })
  for (const role of ['explorer', 'executor', 'evaluator']) await db.assignment.create({ data: { projectId: project.id, role, backend: 'freellmapi', connectionId: connection.id, model: 'auto' } })
  await db.assignment.create({ data: { projectId: project.id, role: 'embedding', backend: 'ollama', connectionId: embeddingConnection.id, model: 'qwen3-embedding:0.6b' } })
  const readOnlyHandler = createResearchCampaignHandlers()
  const before = await db.researchCampaign.count({ where: { projectId: project.id } })
  await readOnlyHandler.GET(new Request(`http://local/api/research-campaign?projectId=${project.id}&versionId=${version.id}`))
  check(await db.researchCampaign.count({ where: { projectId: project.id } }) === before, 'GET/preview creates no campaign')

  const vector = await db.embeddingVector.create({ data: { projectId: project.id, versionId: version.id, representation: 'functional', model: 'qwen3-embedding:0.6b', dimensions: 2, textHash: 'outdated-hash', formatVersion: 1, vector: '[1,0]', status: 'ready', positionId: position.id } })
  const searchHandler = createSemanticSearchHandler({ vectorize: async () => ({ vector: [1, 0], dimensions: 2, textHash: 'query-hash', model: 'qwen3-embedding:0.6b' }) })
  const search = await json(await searchHandler.POST(new Request('http://local/api/semantic/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.id, versionId: version.id, query: 'fixture query', representation: 'functional', topK: 3 }) })))
  const vectorAfterSearch = await db.embeddingVector.findUniqueOrThrow({ where: { id: vector.id } })
  check(search.status === 200 && search.body.index.stale === 1 && vectorAfterSearch.status === 'ready', 'search reports incompatible vector as stale without mutating index')

  const decision = await json(await patchPosition(new Request('http://local/api/semantic/positions/fixture', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'accepted', decisionBasis: 'Synthetic fixture only; verified route contract.' }) }), { params: Promise.resolve({ id: position.id }) }))
  const decisionNote = await db.note.findFirstOrThrow({ where: { projectId: project.id, kind: 'user-verdict' }, orderBy: { createdAt: 'desc' } })
  check(decision.status === 200 && decision.body.position.status === 'accepted' && JSON.parse(decisionNote.body).objectId === position.id, 'explicit user decision writes its own history note in the isolated fixture')

  const base = { projectId: project.id, versionId: version.id, expectedHash: version.contentHash, idempotencyKey: crypto.randomUUID().replaceAll('-', ''), scope: { type: 'positions', positionIds: [position.id] }, policy: { depth: 'interactions', maxScenariosPerPosition: 1, maxModelActions: 3, maxAdditionalChecksPerPosition: 0, maxRetriesPerAction: 2, maxConcurrent: 1, stopOnQuota: true, stopOnTechnicalError: true, allowRewriteExperiment: false } }
  const first = await json(await call(readOnlyHandler.POST, { action: 'create', ...base }))
  const second = await json(await call(readOnlyHandler.POST, { action: 'create', ...base }))
  check(first.status === 201 && second.status === 201 && first.body.campaign.id === second.body.campaign.id, 'idempotent create returns exactly one prepared campaign')
  check(first.body.campaign.status === 'prepared', 'create does not start execution')

  const noExternalModelCalls = async (runId) => {
    const run = await db.run.update({ where: { id: runId }, data: { status: 'completed', output: JSON.stringify({ status: 'supported', sourceEvidence: [{ fragmentId: fragment.id, quote: fragment.text.slice(0, 24), reason: 'Synthetic exact source quote.' }] }), finishedAt: new Date() } })
    return run
  }
  const handlers = createResearchCampaignHandlers({ runExecutor: noExternalModelCalls })
  const started = await json(await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: first.body.campaign.id, action: 'start' }))
  check(started.status === 200 && started.body.campaign.status === 'running', 'explicit start transitions prepared to running')
  const repeatedStart = await json(await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: first.body.campaign.id, action: 'start' }))
  check(repeatedStart.status === 200 && repeatedStart.body.campaign.id === started.body.campaign.id && await db.researchCampaignAction.count({ where: { campaignId: first.body.campaign.id } }) === 0, 'repeated start is idempotent and does not create duplicate actions')
  const action = await json(await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: first.body.campaign.id, action: 'advance' }))
  check(action.status === 200 && action.body.kind === 'action-completed', `mocked interpreter action completes via the actual API handler: ${JSON.stringify(action)}`)
  const actionRow = await db.researchCampaignAction.findFirstOrThrow({ where: { campaignId: first.body.campaign.id }, include: { run: true } })
  check(actionRow.role === 'interpreter' && actionRow.run.status === 'completed', 'campaign action keeps linked Run provenance')
  check(await db.modelCall.count({ where: { projectId: project.id } }) === 0, 'mocked run created no ModelCall')
  check((await db.semanticPosition.findUniqueOrThrow({ where: { id: position.id } })).title === 'Synthetic source position', 'campaign execution does not apply an instruction or position edit')

  const paused = await json(await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: first.body.campaign.id, action: 'pause' }))
  check(paused.status === 200 && paused.body.campaign.status === 'paused', 'pause transitions running to paused')
  const resumed = await json(await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: first.body.campaign.id, action: 'resume' }))
  check(resumed.status === 200 && resumed.body.campaign.status === 'running' && resumed.body.campaign.modelActionsUsed === 1, 'resume preserves used-action budget')
  const cancelled = await json(await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: first.body.campaign.id, action: 'cancel' }))
  check(cancelled.status === 200 && cancelled.body.campaign.status === 'cancelled', 'cancel control marks only the isolated campaign cancelled')

  const cancelSetupCount = await db.researchCampaign.count({ where: { projectId: project.id } })
  // Setup cancellation is a client-only transition; deliberately make no create request.
  check(await db.researchCampaign.count({ where: { projectId: project.id } }) === cancelSetupCount, 'cancel setup creates no record')

  const quotaInput = { ...base, idempotencyKey: crypto.randomUUID().replaceAll('-', ''), policy: { ...base.policy, maxModelActions: 2 } }
  const quotaCampaign = await json(await call(readOnlyHandler.POST, { action: 'create', ...quotaInput }))
  await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: quotaCampaign.body.campaign.id, action: 'start' })
  const quotaHandler = createResearchCampaignHandlers({ runExecutor: async (runId) => db.run.update({ where: { id: runId }, data: { status: 'failed', error: 'HTTP 429 rate_limit', finishedAt: new Date() } }) })
  await call(quotaHandler.POST, { projectId: project.id, versionId: version.id, campaignId: quotaCampaign.body.campaign.id, action: 'advance' })
  const quotaSaved = await db.researchCampaign.findUniqueOrThrow({ where: { id: quotaCampaign.body.campaign.id } })
  check(quotaSaved.status === 'paused' && quotaSaved.pauseReason === 'provider-quota', 'mocked 429 persists quota stop')
  const resumeQuota = await json(await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: quotaCampaign.body.campaign.id, action: 'resume' }))
  check(resumeQuota.status === 200, 'quota campaign can resume when attempts/budget allow')
  await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: quotaCampaign.body.campaign.id, action: 'pause' })
  const budget = await json(await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: quotaCampaign.body.campaign.id, action: 'update-budget', maxModelActions: 3 }))
  check(budget.status === 200 && budget.body.campaign.maxModelActions === 3 && budget.body.campaign.modelActionsUsed === 1, 'explicit budget extension preserves used actions')
  const unlimitedBudget = await json(await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: quotaCampaign.body.campaign.id, action: 'update-budget', maxModelActions: null }))
  check(unlimitedBudget.status === 200 && unlimitedBudget.body.campaign.maxModelActions === null && unlimitedBudget.body.campaign.modelActionsUsed === 1 && unlimitedBudget.body.campaign.status === 'paused', 'explicit unlimited budget preserves used actions and does not resume')
  const boundedAgain = await json(await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: quotaCampaign.body.campaign.id, action: 'update-budget', maxModelActions: 2 }))
  check(boundedAgain.status === 200 && boundedAgain.body.campaign.maxModelActions === 2 && boundedAgain.body.campaign.budgetHistory.length === 3 && boundedAgain.body.campaign.status === 'paused', `returning to a finite budget preserves history and pause state: ${JSON.stringify(boundedAgain)}`)
  const tooSmallBudget = await json(await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: quotaCampaign.body.campaign.id, action: 'update-budget', maxModelActions: 0 }))
  check(tooSmallBudget.status === 400, 'invalid finite budget is rejected explicitly')

  const beyondTwentyInput = { ...base, idempotencyKey: crypto.randomUUID().replaceAll('-', ''), policy: { ...base.policy, maxModelActions: 21 } }
  const beyondTwenty = await json(await call(readOnlyHandler.POST, { action: 'create', ...beyondTwentyInput }))
  await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: beyondTwenty.body.campaign.id, action: 'start' })
  await db.researchCampaign.update({ where: { id: beyondTwenty.body.campaign.id }, data: { modelActionsUsed: 20 } })
  const afterTwentyAction = await json(await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: beyondTwenty.body.campaign.id, action: 'advance' }))
  check(afterTwentyAction.status === 200 && afterTwentyAction.body.kind === 'action-completed' && afterTwentyAction.body.campaign.modelActionsUsed === 21, 'mock action executes after the twentieth action under a finite limit of 21')

  const timeoutInput = { ...base, idempotencyKey: crypto.randomUUID().replaceAll('-', ''), policy: { ...base.policy, maxModelActions: 3, maxRetriesPerAction: 3 } }
  const timeoutCampaign = await json(await call(readOnlyHandler.POST, { action: 'create', ...timeoutInput }))
  await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: timeoutCampaign.body.campaign.id, action: 'start' })
  const timeoutHandler = createResearchCampaignHandlers({ runExecutor: async (runId) => db.run.update({ where: { id: runId }, data: { status: 'failed', error: 'Истекло время ожидания ответа FreeLLMAPI', finishedAt: new Date() } }) })
  await call(timeoutHandler.POST, { projectId: project.id, versionId: version.id, campaignId: timeoutCampaign.body.campaign.id, action: 'advance' })
  const timeoutSaved = await db.researchCampaign.findUniqueOrThrow({ where: { id: timeoutCampaign.body.campaign.id } })
  const timeoutFirstAction = await db.researchCampaignAction.findFirstOrThrow({ where: { campaignId: timeoutCampaign.body.campaign.id } })
  check(timeoutSaved.status === 'running' && timeoutSaved.pauseReason == null && timeoutFirstAction.error === 'Истекло время ожидания ответа FreeLLMAPI', 'localized FreeLLMAPI timeout stays a retryable temporary failure, not a quota pause')
  const timeoutRetry = createResearchCampaignHandlers({ runExecutor: async (runId) => db.run.update({ where: { id: runId }, data: { status: 'completed', output: JSON.stringify({ status: 'supported', sourceEvidence: [{ fragmentId: fragment.id, quote: fragment.text.slice(0, 24), reason: 'Synthetic exact source quote.' }] }), finishedAt: new Date() } }) })
  await call(timeoutRetry.POST, { projectId: project.id, versionId: version.id, campaignId: timeoutCampaign.body.campaign.id, action: 'advance' })
  const timeoutAttempts = await db.researchCampaignAction.findMany({ where: { campaignId: timeoutCampaign.body.campaign.id }, orderBy: { attempt: 'asc' } })
  check(timeoutAttempts.length === 2 && timeoutAttempts[0].attempt === 1 && timeoutAttempts[1].attempt === 2 && (await db.researchCampaign.findUniqueOrThrow({ where: { id: timeoutCampaign.body.campaign.id } })).modelActionsUsed === 2, 'temporary failure retry creates one sequential attempt and each attempt consumes one budget action')

  const originalFetch = globalThis.fetch
  const originalFreeLlmKey = process.env.FREELLMAPI_API_KEY
  let providerReplies = []
  let providerTransportCalls = 0
  process.env.FREELLMAPI_API_KEY = '[DIAGNOSTIC] isolated transport only'
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url !== `${connection.baseUrl}/chat/completions`) throw new Error(`[DIAGNOSTIC] blocked unexpected network request: ${new URL(url).host}`)
    providerTransportCalls += 1
    const reply = providerReplies.shift()
    if (reply === 'timeout') throw new DOMException('Synthetic transport timeout.', 'AbortError')
    if (reply !== 'success') throw new Error('[DIAGNOSTIC] no mocked provider response was configured')
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ supportsConcern: false, arguments: [], sourceEvidence: [], alternativesConsidered: [], limitations: ['[DIAGNOSTIC] mocked provider result'] }) }, finish_reason: 'stop' }], model: '[DIAGNOSTIC] mock-model', usage: { prompt_tokens: 8, completion_tokens: 5 } }), { status: 200, headers: { 'content-type': 'application/json', 'x-routed-via': '[DIAGNOSTIC] mock-provider' } })
  }
  const actualExecutionHandlers = createResearchCampaignHandlers()
  const concernRetryInput = { ...base, idempotencyKey: crypto.randomUUID().replaceAll('-', ''), policy: { ...base.policy, maxModelActions: 4, maxAdditionalChecksPerPosition: 1, maxRetriesPerAction: 3 } }
  const concernRetryCampaign = await json(await call(readOnlyHandler.POST, { action: 'create', ...concernRetryInput }))
  await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: concernRetryCampaign.body.campaign.id, action: 'start' })
  const concernRetryItem = concernRetryCampaign.body.campaign.items[0]
  await db.researchCampaignPosition.update({ where: { id: concernRetryItem.id }, data: { stage: 'concern-review', status: 'in-progress', interactionStatus: 'concern' } })
  providerReplies = ['timeout', 'success']
  const firstConcernFailure = await json(await call(actualExecutionHandlers.POST, { projectId: project.id, versionId: version.id, campaignId: concernRetryCampaign.body.campaign.id, action: 'advance' }))
  const persistedFirstConcern = await db.researchCampaignAction.findFirstOrThrow({ where: { campaignId: concernRetryCampaign.body.campaign.id }, include: { run: true } })
  const failedConcernModelCall = await db.modelCall.findFirstOrThrow({ where: { runId: persistedFirstConcern.run.id } })
  const afterConcernFailure = await db.researchCampaignPosition.findUniqueOrThrow({ where: { id: concernRetryItem.id } })
  check(firstConcernFailure.status === 200 && persistedFirstConcern.actionType === 'concern-review' && persistedFirstConcern.attempt === 1 && persistedFirstConcern.status === 'failed' && persistedFirstConcern.run.status === 'failed' && persistedFirstConcern.run.error === 'Истекло время ожидания ответа FreeLLMAPI' && failedConcernModelCall.status === 'failed' && failedConcernModelCall.backend === 'freellmapi' && failedConcernModelCall.requestedModel === 'auto' && failedConcernModelCall.actualProvider == null && afterConcernFailure.additionalChecksUsed === 1 && afterConcernFailure.stage === 'concern-review', 'provider transport AbortError flows through executeRun and persists the real localized timeout across action, Run, and failed ModelCall')
  const restartedConcernRetryTransport = createResearchCampaignHandlers()
  const concernRetryBody = { projectId: project.id, versionId: version.id, campaignId: concernRetryCampaign.body.campaign.id, action: 'advance' }
  const concurrentConcernAdvances = await Promise.all([call(restartedConcernRetryTransport.POST, concernRetryBody), call(restartedConcernRetryTransport.POST, concernRetryBody)].map(async (response) => json(await response)))
  const concernAttempts = await db.researchCampaignAction.findMany({ where: { campaignId: concernRetryCampaign.body.campaign.id }, include: { run: true }, orderBy: { attempt: 'asc' } })
  const afterConcernRetry = await db.researchCampaign.findUniqueOrThrow({ where: { id: concernRetryCampaign.body.campaign.id }, include: { items: true } })
  check(concernAttempts.length === 2 && concernAttempts[1].actionType === 'concern-review' && concernAttempts[1].attempt === 2 && concernAttempts[1].status === 'completed' && afterConcernRetry.items[0].stage === 'scenario-plan' && afterConcernRetry.modelActionsUsed === 2 && concurrentConcernAdvances.some((result) => result.body.kind === 'waiting') && concurrentConcernAdvances.some((result) => result.body.kind === 'action-completed'), 'retryable concern-review failure survives a new handler instance, creates one completed attempt 2 under concurrent advance, and consumes exactly one more budget action')

  const lateConcernInput = { ...base, idempotencyKey: crypto.randomUUID().replaceAll('-', ''), policy: { ...base.policy, maxModelActions: 3, maxAdditionalChecksPerPosition: 1, maxRetriesPerAction: 3 } }
  const lateConcern = await json(await call(readOnlyHandler.POST, { action: 'create', ...lateConcernInput }))
  await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: lateConcern.body.campaign.id, action: 'start' })
  await db.researchCampaignPosition.update({ where: { id: lateConcern.body.campaign.items[0].id }, data: { stage: 'concern-review', status: 'in-progress', interactionStatus: 'concern' } })
  providerReplies = ['timeout']
  const lateConcernFailureTransport = createResearchCampaignHandlers()
  await call(lateConcernFailureTransport.POST, { projectId: project.id, versionId: version.id, campaignId: lateConcern.body.campaign.id, action: 'advance' })
  const lateConcernAction = await db.researchCampaignAction.findFirstOrThrow({ where: { campaignId: lateConcern.body.campaign.id }, include: { run: true } })
  await db.run.update({ where: { id: lateConcernAction.run.id }, data: { status: 'completed', error: null, output: JSON.stringify({ supportsConcern: false, arguments: [], sourceEvidence: [], alternativesConsidered: [], limitations: ['[DIAGNOSTIC] first attempt completed late'] }), finishedAt: new Date() } })
  await db.modelCall.updateMany({ where: { runId: lateConcernAction.run.id }, data: { status: 'completed', actualProvider: '[DIAGNOSTIC] mock-provider', actualModel: '[DIAGNOSTIC] mock-model' } })
  let lateConcernTransportCalls = 0
  const lateConcernRecovery = createResearchCampaignHandlers({ runExecutor: async (runId) => { lateConcernTransportCalls += 1; return db.run.findUniqueOrThrow({ where: { id: runId } }) } })
  await call(lateConcernRecovery.POST, { projectId: project.id, versionId: version.id, campaignId: lateConcern.body.campaign.id, action: 'advance' })
  const lateConcernSaved = await db.researchCampaign.findUniqueOrThrow({ where: { id: lateConcern.body.campaign.id }, include: { items: { include: { actions: { include: { run: true } } } } } })
  check(lateConcernSaved.items[0].actions.length === 1 && lateConcernSaved.items[0].actions[0].attempt === 1 && lateConcernSaved.items[0].actions[0].status === 'completed' && lateConcernSaved.items[0].stage === 'scenario-plan' && lateConcernSaved.modelActionsUsed === 1 && lateConcernTransportCalls === 0, 'late successful concern-review Run is reused through the retry-eligible stage without a duplicate attempt or transport call')

  const exhaustedConcernInput = { ...base, idempotencyKey: crypto.randomUUID().replaceAll('-', ''), policy: { ...base.policy, maxModelActions: 4, maxAdditionalChecksPerPosition: 1, maxRetriesPerAction: 3 } }
  const exhaustedConcern = await json(await call(readOnlyHandler.POST, { action: 'create', ...exhaustedConcernInput }))
  await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: exhaustedConcern.body.campaign.id, action: 'start' })
  await db.researchCampaignPosition.update({ where: { id: exhaustedConcern.body.campaign.items[0].id }, data: { stage: 'concern-review', status: 'in-progress', interactionStatus: 'concern' } })
  providerReplies = ['timeout', 'timeout', 'timeout']
  const exhaustedConcernFailureTransport = createResearchCampaignHandlers()
  for (let attempt = 0; attempt < 3; attempt += 1) await call(exhaustedConcernFailureTransport.POST, { projectId: project.id, versionId: version.id, campaignId: exhaustedConcern.body.campaign.id, action: 'advance' })
  await call(exhaustedConcernFailureTransport.POST, { projectId: project.id, versionId: version.id, campaignId: exhaustedConcern.body.campaign.id, action: 'advance' })
  const exhaustedConcernSaved = await db.researchCampaign.findUniqueOrThrow({ where: { id: exhaustedConcern.body.campaign.id }, include: { items: { include: { actions: true } } } })
  check(exhaustedConcernSaved.items[0].actions.length === 3 && exhaustedConcernSaved.items[0].actions.map((row) => row.attempt).sort().join(',') === '1,2,3' && exhaustedConcernSaved.modelActionsUsed === 3 && exhaustedConcernSaved.items[0].reviewStatus === 'not-confirmed' && exhaustedConcernSaved.items[0].stage === 'scenario-plan', 'concern-review retry honors its three-attempt ceiling and proceeds without a fourth action')

  const budgetConcernInput = { ...base, idempotencyKey: crypto.randomUUID().replaceAll('-', ''), policy: { ...base.policy, maxModelActions: 1, maxAdditionalChecksPerPosition: 1, maxRetriesPerAction: 3 } }
  const budgetConcern = await json(await call(readOnlyHandler.POST, { action: 'create', ...budgetConcernInput }))
  await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: budgetConcern.body.campaign.id, action: 'start' })
  await db.researchCampaignPosition.update({ where: { id: budgetConcern.body.campaign.items[0].id }, data: { stage: 'concern-review', status: 'in-progress', interactionStatus: 'concern' } })
  providerReplies = ['timeout']
  const budgetConcernFailureTransport = createResearchCampaignHandlers()
  for (let attempt = 0; attempt < 2; attempt += 1) await call(budgetConcernFailureTransport.POST, { projectId: project.id, versionId: version.id, campaignId: budgetConcern.body.campaign.id, action: 'advance' })
  const budgetConcernSaved = await db.researchCampaign.findUniqueOrThrow({ where: { id: budgetConcern.body.campaign.id }, include: { items: { include: { actions: true } } } })
  check(budgetConcernSaved.status === 'paused' && budgetConcernSaved.pauseReason === 'policy-budget-exhausted' && budgetConcernSaved.items[0].actions.length === 1 && budgetConcernSaved.modelActionsUsed === 1, 'concern-review retry respects the action budget and persists no over-budget attempt')
  const retryCampaignIds = [concernRetryCampaign.body.campaign.id, lateConcern.body.campaign.id, exhaustedConcern.body.campaign.id, budgetConcern.body.campaign.id]
  const retryCampaignActions = await db.researchCampaignAction.findMany({ where: { campaignId: { in: retryCampaignIds } }, include: { run: true } })
  const retryRunIds = retryCampaignActions.map((action) => action.run?.id).filter(Boolean)
  const retryModelCalls = await db.modelCall.findMany({ where: { runId: { in: retryRunIds } } })
  check(providerTransportCalls === 7 && retryModelCalls.length === providerTransportCalls, 'all real executeRun paths created matching ModelCall records while only the intercepted provider transport was called')
  globalThis.fetch = originalFetch
  if (originalFreeLlmKey === undefined) delete process.env.FREELLMAPI_API_KEY
  else process.env.FREELLMAPI_API_KEY = originalFreeLlmKey

  const exhaustedTimeout = await json(await call(readOnlyHandler.POST, { action: 'create', ...{ ...timeoutInput, idempotencyKey: crypto.randomUUID().replaceAll('-', '') } }))
  await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: exhaustedTimeout.body.campaign.id, action: 'start' })
  for (let attempt = 0; attempt < 3; attempt += 1) await call(timeoutHandler.POST, { projectId: project.id, versionId: version.id, campaignId: exhaustedTimeout.body.campaign.id, action: 'advance' })
  const exhaustedState = await db.researchCampaign.findUniqueOrThrow({ where: { id: exhaustedTimeout.body.campaign.id }, include: { items: { include: { actions: true } } } })
  check(exhaustedState.items[0].actions.length === 3 && exhaustedState.items[0].actions.map((row) => row.attempt).sort().join(',') === '1,2,3' && exhaustedState.modelActionsUsed === 3 && exhaustedState.items[0].interpretationStatus === 'inconclusive', 'three timeouts exhaust the retry cap, count all attempts, and leave a clear inconclusive stage')
  const exhaustedResume = await json(await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: exhaustedTimeout.body.campaign.id, action: 'resume' }))
  check(exhaustedResume.status === 409, 'retry exhaustion blocks another resume rather than queuing attempt four')

  const cancelledInput = { ...base, idempotencyKey: crypto.randomUUID().replaceAll('-', ''), policy: { ...base.policy, maxRetriesPerAction: 3 } }
  const cancelledCampaign = await json(await call(readOnlyHandler.POST, { action: 'create', ...cancelledInput }))
  await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: cancelledCampaign.body.campaign.id, action: 'start' })
  const cancelledRunHandler = createResearchCampaignHandlers({ runExecutor: async (runId) => db.run.update({ where: { id: runId }, data: { status: 'cancelled', error: 'timeout during user cancellation', finishedAt: new Date() } }) })
  await call(cancelledRunHandler.POST, { projectId: project.id, versionId: version.id, campaignId: cancelledCampaign.body.campaign.id, action: 'advance' })
  const cancelledActionState = await db.researchCampaign.findUniqueOrThrow({ where: { id: cancelledCampaign.body.campaign.id }, include: { items: { include: { actions: true } } } })
  check(cancelledActionState.items[0].actions.length === 1 && cancelledActionState.items[0].actions[0].status === 'cancelled' && cancelledActionState.items[0].interpretationStatus === 'inconclusive', 'cancelled Run with timeout-like text is not retried')

  const recoveryInput = { ...base, idempotencyKey: crypto.randomUUID().replaceAll('-', ''), policy: { ...base.policy, depth: 'interactions', maxModelActions: 2 } }
  const recoveryCampaign = await json(await call(readOnlyHandler.POST, { action: 'create', ...recoveryInput }))
  const recoveryItem = recoveryCampaign.body.campaign.items[0]
  await db.researchCampaign.update({ where: { id: recoveryCampaign.body.campaign.id }, data: { status: 'running', modelActionsUsed: 1, stage: 'interpretation' } })
  await db.researchCampaignPosition.update({ where: { id: recoveryItem.id }, data: { status: 'in-progress', stage: 'interpretation' } })
  const queuedAction = await db.researchCampaignAction.create({ data: {
    actionKey: `${recoveryCampaign.body.campaign.id}:${recoveryItem.id}:interrupted`, campaignId: recoveryCampaign.body.campaign.id, campaignPositionId: recoveryItem.id,
    actionType: 'interpretation', role: 'interpreter', attempt: 1, status: 'running', startedAt: new Date(),
    sources: { create: { fragmentId: fragment.id } },
    run: { create: { projectId: project.id, versionId: version.id, role: 'interpreter', backend: 'freellmapi', connectionId: connection.id, connectionName: connection.name, model: 'auto', status: 'queued', input: JSON.stringify({ prompt: '[DIAGNOSTIC] queued Run for recovery test' }) } },
  }, include: { run: true } })
  check(queuedAction.status === 'running' && queuedAction.run.status === 'queued', 'fixture includes one linked queued Run for recovery')
  await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: recoveryCampaign.body.campaign.id, action: 'pause' })
  await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: recoveryCampaign.body.campaign.id, action: 'resume' })
  let recoveryExecutorCalls = 0
  const recoveryHandler = createResearchCampaignHandlers({ runExecutor: async (runId) => {
    recoveryExecutorCalls += 1
    return db.run.update({ where: { id: runId }, data: { status: 'completed', output: JSON.stringify({ status: 'supported', sourceEvidence: [{ fragmentId: fragment.id, quote: fragment.text.slice(0, 24), reason: 'Synthetic recovery mock.' }] }), finishedAt: new Date() } })
  } })
  const recovered = await json(await call(recoveryHandler.POST, { projectId: project.id, versionId: version.id, campaignId: recoveryCampaign.body.campaign.id, action: 'advance' }))
  check(recovered.status === 200 && recovered.body.kind === 'action-completed' && recoveryExecutorCalls === 1 && await db.modelCall.count({ where: { runId: queuedAction.run.id } }) === 0 && await db.researchCampaignAction.count({ where: { campaignId: recoveryCampaign.body.campaign.id } }) === 1, 'queued Run recovery honors injected executor without duplicate action or ModelCall')

  const lateInput = { ...base, idempotencyKey: crypto.randomUUID().replaceAll('-', ''), policy: { ...base.policy, maxModelActions: 2 } }
  const lateCampaign = await json(await call(readOnlyHandler.POST, { action: 'create', ...lateInput }))
  const lateItem = lateCampaign.body.campaign.items[0]
  await db.researchCampaign.update({ where: { id: lateCampaign.body.campaign.id }, data: { status: 'running', modelActionsUsed: 1, stage: 'interpretation' } })
  await db.researchCampaignPosition.update({ where: { id: lateItem.id }, data: { status: 'in-progress', stage: 'interpretation' } })
  const lateAction = await db.researchCampaignAction.create({ data: {
    actionKey: `${lateCampaign.body.campaign.id}:${lateItem.id}:late-response`, campaignId: lateCampaign.body.campaign.id, campaignPositionId: lateItem.id,
    actionType: 'interpretation', role: 'interpreter', attempt: 1, status: 'failed', error: 'timeout observed locally; late result arrived', startedAt: new Date(),
    sources: { create: { fragmentId: fragment.id } },
    run: { create: { projectId: project.id, versionId: version.id, role: 'interpreter', backend: 'freellmapi', connectionId: connection.id, connectionName: connection.name, model: 'auto', status: 'completed', output: JSON.stringify({ status: 'supported', sourceEvidence: [{ fragmentId: fragment.id, quote: fragment.text.slice(0, 24), reason: 'Late synthetic response.' }] }), finishedAt: new Date(), input: JSON.stringify({ prompt: '[DIAGNOSTIC] late response fixture' }) } },
  }, include: { run: true } })
  let lateExecutorCalls = 0
  const lateHandler = createResearchCampaignHandlers({ runExecutor: async (runId) => { lateExecutorCalls += 1; return db.run.findUniqueOrThrow({ where: { id: runId } }) } })
  const lateRecovered = await json(await call(lateHandler.POST, { projectId: project.id, versionId: version.id, campaignId: lateCampaign.body.campaign.id, action: 'advance' }))
  check(lateRecovered.status === 200 && lateExecutorCalls === 0 && (await db.researchCampaignAction.count({ where: { campaignId: lateCampaign.body.campaign.id } })) === 1 && (await db.researchCampaignAction.findUniqueOrThrow({ where: { id: lateAction.id } })).status === 'completed', 'late completed Run is reused without a new attempt or duplicate result')

  const fullInput = { ...base, idempotencyKey: crypto.randomUUID().replaceAll('-', ''), policy: { ...base.policy, depth: 'full', maxModelActions: null, maxAdditionalChecksPerPosition: 1 } }
  const fullCampaign = await json(await call(readOnlyHandler.POST, { action: 'create', ...fullInput }))
  const fullHandlers = createResearchCampaignHandlers({ runExecutor: async (runId) => {
    const run = await db.run.findUniqueOrThrow({ where: { id: runId } })
    const action = await db.researchCampaignAction.findUniqueOrThrow({ where: { id: run.campaignActionId } })
    const exactEvidence = { fragmentId: fragment.id, quote: fragment.text.slice(0, 28), reason: 'Synthetic exact source evidence.' }
    const outputs = {
      interpretation: JSON.stringify({ status: 'supported', sourceEvidence: [exactEvidence] }),
      interaction: JSON.stringify({ status: 'compatible', checks: [], alternatives: [], limitations: [] }),
      'scenario-plan': JSON.stringify({ scenarios: [{ title: '[DIAGNOSTIC] Preserve absence', objective: 'Check the stated behavior.', input: 'One message field is absent.', expectedBehavior: 'Keep the absent value unknown.', criterion: 'No invented replacement value is emitted.', sourceFragmentIds: [fragment.id] }] }),
      executor: 'Synthetic expected behavior observed.',
      evaluator: JSON.stringify({ criterionBasis: 'supported', verdict: 'pass', reasons: ['Synthetic source-backed criterion.'] }),
    }
    const verdict = action.actionType === 'evaluator' ? 'pass' : null
    return db.run.update({ where: { id: runId }, data: { status: 'completed', output: outputs[action.actionType] ?? '{}', verdict, verdictBy: verdict ? 'model' : null, modelVerdict: verdict, modelVerdictBy: verdict ? 'model' : null, finishedAt: new Date() } })
  } })
  await call(fullHandlers.POST, { projectId: project.id, versionId: version.id, campaignId: fullCampaign.body.campaign.id, action: 'start' })
  for (let step = 0; step < 20; step += 1) {
    const advanced = await json(await call(fullHandlers.POST, { projectId: project.id, versionId: version.id, campaignId: fullCampaign.body.campaign.id, action: 'advance' }))
    check(advanced.status === 200, `full-depth mock advance ${step + 1} returns ${advanced.status}: ${advanced.body.error ?? ''}`)
    const current = await db.researchCampaign.findUniqueOrThrow({ where: { id: fullCampaign.body.campaign.id } })
    if (current.status !== 'running') break
  }
  const fullSaved = await db.researchCampaign.findUniqueOrThrow({ where: { id: fullCampaign.body.campaign.id }, include: { items: { include: { actions: { include: { run: true } }, scenarios: { include: { campaignCheck: true } } } } } })
  const fullItem = fullSaved.items[0]
  const fullActions = fullItem.actions.map((row) => row.actionType)
  check(fullSaved.status === 'completed' && fullItem.status === 'completed' && fullItem.conclusion === 'no-issue-in-checked-cases' && fullItem.conclusionSummary?.includes('Проблем не обнаружено'), 'full-depth mock completes queue and persists a traceable final conclusion instead of leaving not-explored')
  check(['interpretation', 'interaction', 'scenario-plan', 'executor', 'evaluator'].every((action) => fullActions.includes(action)) && fullItem.scenarios[0]?.campaignCheck?.status === 'completed', 'full-depth conclusion retains every required stage and linked completed check')
  const scenarioAction = fullItem.actions.find((row) => row.actionType === 'scenario-plan')
  const evaluatorAction = fullItem.actions.find((row) => row.actionType === 'evaluator')
  const scenarioPrompt = JSON.parse(scenarioAction.run.input).prompt
  const evaluatorPrompt = JSON.parse(evaluatorAction.run.input).prompt
  check(scenarioPrompt.includes('input — условие теста') && scenarioPrompt.includes('objective — требование') && scenarioPrompt.includes('укажи в limitations как гипотезу'), 'Explorer prompt separates source requirement, test condition and researcher hypothesis')
  check(evaluatorPrompt.includes('проверь основание самого сценария') && evaluatorPrompt.includes(fragment.text) && fullItem.scenarios[0].description.includes('Условие теста (может быть гипотетическим)'), 'Evaluator receives source text and scenario provenance labels before grading')
  check(await db.modelCall.count({ where: { runId: { in: fullItem.actions.map((action) => action.run?.id).filter(Boolean) } } }) === 0, 'full-depth runExecutor fixture made no ModelCall records')

  const runConcernFixture = async (mode) => {
    const scenarioCount = mode === 'limit-exhausted' ? 2 : 1
    const input = { ...base, idempotencyKey: crypto.randomUUID().replaceAll('-', ''), policy: { ...base.policy, depth: 'full', maxModelActions: 30, maxScenariosPerPosition: scenarioCount, maxAdditionalChecksPerPosition: 1 } }
    const created = await json(await call(readOnlyHandler.POST, { action: 'create', ...input }))
    const fixtureHandlers = createResearchCampaignHandlers({ runExecutor: async (runId) => {
      const run = await db.run.findUniqueOrThrow({ where: { id: runId } })
      const action = await db.researchCampaignAction.findUniqueOrThrow({ where: { id: run.campaignActionId } })
      const exactEvidence = { fragmentId: fragment.id, quote: fragment.text.slice(0, 28), reason: 'Synthetic exact source evidence.' }
      const check = action.checkId ? await db.researchCampaignCheck.findUniqueOrThrow({ where: { id: action.checkId } }) : null
      const verdict = mode === 'limit-exhausted' && action.actionType === 'evaluator' && check?.ordinal === 2 ? 'fail' : 'pass'
      const scenarios = Array.from({ length: scenarioCount }, (_, index) => ({ title: `[DIAGNOSTIC] Check ${index + 1}`, objective: 'Check the stated behavior.', input: `Synthetic case ${index + 1}.`, expectedBehavior: 'Keep the absent value unknown.', criterion: `Case ${index + 1} emits no invented replacement value.`, sourceFragmentIds: [fragment.id] }))
      const outputs = {
        interpretation: JSON.stringify({ status: 'concern', sourceEvidence: [exactEvidence] }),
        interaction: JSON.stringify({ status: 'compatible', checks: [], alternatives: [], limitations: [] }),
        'concern-review': JSON.stringify({ supportsConcern: mode === 'concern-confirmed', sourceEvidence: [exactEvidence], explanation: 'Synthetic independent review.' }),
        'scenario-plan': JSON.stringify({ scenarios }),
        executor: 'Synthetic expected behavior observed.',
      evaluator: JSON.stringify({ criterionBasis: mode === 'unsupported-basis' && action.actionType === 'evaluator' ? 'unsupported' : 'supported', verdict, reasons: ['Synthetic fixture criterion result.'] }),
        'evaluation-review': JSON.stringify({ supportsConcern: false, sourceEvidence: [exactEvidence], explanation: 'Synthetic review did not confirm the concern.' }),
      }
      return db.run.update({ where: { id: runId }, data: { status: 'completed', output: outputs[action.actionType] ?? '{}', verdict: action.actionType === 'evaluator' ? verdict : null, verdictBy: action.actionType === 'evaluator' ? 'model' : null, modelVerdict: action.actionType === 'evaluator' ? verdict : null, modelVerdictBy: action.actionType === 'evaluator' ? 'model' : null, finishedAt: new Date() } })
    } })
    await call(fixtureHandlers.POST, { projectId: project.id, versionId: version.id, campaignId: created.body.campaign.id, action: 'start' })
    for (let step = 0; step < 30; step += 1) {
      const advanced = await json(await call(fixtureHandlers.POST, { projectId: project.id, versionId: version.id, campaignId: created.body.campaign.id, action: 'advance' }))
      check(advanced.status === 200, `${mode} mock advance ${step + 1} returns ${advanced.status}: ${advanced.body.error ?? ''}`)
      const current = await db.researchCampaign.findUniqueOrThrow({ where: { id: created.body.campaign.id } })
      if (current.status !== 'running') break
    }
    return db.researchCampaign.findUniqueOrThrow({ where: { id: created.body.campaign.id }, include: { items: { include: { actions: { include: { run: true } }, scenarios: { include: { campaignCheck: true } } } } } })
  }
  const confirmedConcern = await runConcernFixture('concern-confirmed')
  const confirmedItem = confirmedConcern.items[0]
  check(confirmedConcern.status === 'completed' && confirmedItem.conclusion === 'likely-revision' && confirmedItem.reviewStatus === 'confirmed' && confirmedItem.additionalChecksUsed === 1, 'source-backed concern receives one additional review and yields a qualified likely-revision conclusion')
  const limitedConflict = await runConcernFixture('limit-exhausted')
  const limitedItem = limitedConflict.items[0]
  const limitedVerdicts = limitedItem.actions.filter((row) => row.actionType === 'evaluator').map((row) => row.run?.verdict)
  check(limitedConflict.status === 'completed' && limitedItem.conclusion === 'insufficient-data' && limitedItem.additionalChecksUsed === 1 && !limitedItem.actions.some((row) => row.actionType === 'evaluation-review') && limitedVerdicts.includes('pass') && limitedVerdicts.includes('fail'), 'conflicting evaluator results with the per-position extra-check limit exhausted finish as insufficient-data without an extra action')
  const unsupportedBasis = await runConcernFixture('unsupported-basis')
  check(unsupportedBasis.status === 'completed' && unsupportedBasis.items[0].scenarios[0].campaignCheck.status === 'inconclusive' && unsupportedBasis.items[0].conclusion === 'insufficient-data', 'Evaluator pass with unsupported criterion basis is persisted as inconclusive and cannot support a clean conclusion')
  const runExecutorFixtureRunIds = [confirmedConcern, limitedConflict, unsupportedBasis].flatMap((campaign) => campaign.items.flatMap((item) => item.actions.map((action) => action.run?.id).filter(Boolean)))
  check(await db.modelCall.count({ where: { runId: { in: runExecutorFixtureRunIds } } }) === 0, 'runExecutor-only concern fixtures create no ModelCall records')

  const inconsistent = await db.researchCampaign.create({ data: {
    projectId: project.id, versionId: version.id, contentHash: version.contentHash, scopeType: 'positions', scopeSnapshot: JSON.stringify({ positionIds: [position.id], fragmentIds: [fragment.id] }), depth: 'full', status: 'completed', stage: 'complete', modelActionsUsed: 2, maxModelActions: 2,
    items: { create: { positionId: position.id, order: 0, status: 'completed', stage: 'complete', interpretationStatus: 'supported', interactionStatus: 'pending', scenarioStatus: 'pending', executionStatus: 'pending', reviewStatus: 'pending', conclusion: 'insufficient-data', conclusionSummary: 'Synthetic saved state with incomplete required checks.' } },
  } })
  const stateAfterSynthetic = await (await readOnlyHandler.GET(new Request(`http://local/api/research-campaign?projectId=${project.id}&versionId=${version.id}`))).json()
  const contradictoryCampaign = stateAfterSynthetic.campaigns.find((row) => row.id === inconsistent.id)
  check(contradictoryCampaign.status === 'completed' && contradictoryCampaign.items[0].interactionStatus === 'pending' && contradictoryCampaign.items[0].conclusion === 'insufficient-data', 'saved completed queue with incomplete checks remains distinct in API DTO')

  const imported = await db.researchCampaign.create({ data: { projectId: project.id, versionId: version.id, contentHash: version.contentHash, scopeType: 'positions', scopeSnapshot: JSON.stringify({ positionIds: [position.id], fragmentIds: [fragment.id] }), depth: 'interpretation', status: 'blocked', pauseReason: 'import-reconciliation', maxModelActions: 2, items: { create: { positionId: position.id, order: 0 } } } })
  const importedResume = await json(await call(handlers.POST, { projectId: project.id, versionId: version.id, campaignId: imported.id, action: 'resume' }))
  check(importedResume.status === 409, 'imported campaign requires reconciliation before resume')
  const unfinishedCheck = { interpretationStatus: 'supported', interactionStatus: 'compatible', scenarioStatus: 'completed', executionStatus: 'pending' }
  check(unfinishedCheck.executionStatus === 'pending', 'fixture represents completed earlier checks with incomplete execution distinctly')

  const savedAction = await db.researchCampaignAction.findFirstOrThrow({ where: { campaignId: first.body.campaign.id }, include: { run: true } })
  check(savedAction.run.actualProvider == null && savedAction.run.actualModel == null && savedAction.run.modelCallId == null, 'missing actual provider/model/ModelCall remains unknown')
  console.log(JSON.stringify({ fixture: '[DIAGNOSTIC] synthetic only', campaignId: first.body.campaign.id, oneCampaignForIdempotentCreate: first.body.campaign.id === second.body.campaign.id, repeatedStartIsIdempotent: repeatedStart.status === 200, preparedBeforeStart: first.body.campaign.status, mockActionRole: actionRow.role, runId: actionRow.run.id, targetedRetryModelCalls: retryModelCalls.length, interceptedProviderTransportCalls: providerTransportCalls, externalCalls: 0, readOnlySearch: { reportedStale: search.body.index.stale, savedVectorStatus: vectorAfterSearch.status }, userDecisionHistory: decision.status === 200 && JSON.parse(decisionNote.body).objectId === position.id, pauseResumeBudgetPreserved: resumed.body.campaign.modelActionsUsed, cancelledIsolatedCampaign: cancelled.body.campaign.status, quotaStop: quotaSaved.pauseReason, retryableTimeoutActions: timeoutAttempts.map((entry) => entry.attempt), concernReviewRetry: { firstAttempt: persistedFirstConcern.attempt, savedAttempts: concernAttempts.map((entry) => entry.attempt), secondAttemptStatus: concernAttempts[1]?.status, additionalChecksUsed: afterConcernRetry.items[0].additionalChecksUsed, budgetUsed: afterConcernRetry.modelActionsUsed, concurrentWaiting: concurrentConcernAdvances.some((result) => result.body.kind === 'waiting'), parallelDuplicatePrevented: concernAttempts.length === 2 }, concernReviewLateResult: { actionCount: lateConcernSaved.items[0].actions.length, attempt: lateConcernSaved.items[0].actions[0].attempt, status: lateConcernSaved.items[0].actions[0].status, transportCalls: lateConcernTransportCalls, budgetUsed: lateConcernSaved.modelActionsUsed }, concernReviewExhaustion: { attempts: exhaustedConcernSaved.items[0].actions.map((row) => row.attempt), budgetUsed: exhaustedConcernSaved.modelActionsUsed, reviewStatus: exhaustedConcernSaved.items[0].reviewStatus }, concernReviewBudgetStop: { status: budgetConcernSaved.status, pauseReason: budgetConcernSaved.pauseReason, attempts: budgetConcernSaved.items[0].actions.map((row) => row.attempt), budgetUsed: budgetConcernSaved.modelActionsUsed }, explicitBudget: { max: budget.body.campaign.maxModelActions, used: budget.body.campaign.modelActionsUsed }, unlimitedBudget: { max: unlimitedBudget.body.campaign.maxModelActions, used: unlimitedBudget.body.campaign.modelActionsUsed }, finiteBudgetRestored: { max: boundedAgain.body.campaign.maxModelActions, historyEntries: boundedAgain.body.campaign.budgetHistory.length }, executedAfterActionTwenty: afterTwentyAction.body.campaign.modelActionsUsed, fullDepthConclusion: { campaignStatus: fullSaved.status, conclusion: fullItem.conclusion, actions: fullActions, modelCalls: 0 }, concernConclusion: confirmedItem.conclusion, conflictingVerdicts: limitedVerdicts, exhaustedAdditionalCheckLimit: limitedItem.additionalChecksUsed, importedResumeStatus: importedResume.status, completedWithIncompleteChecks: contradictoryCampaign.status === 'completed' && contradictoryCampaign.items[0].conclusion === 'insufficient-data', actualRouteUnknown: savedAction.run.actualProvider == null && savedAction.run.actualModel == null, campaignCount: await db.researchCampaign.count({ where: { projectId: project.id } }) }))
  await db.$disconnect()
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
