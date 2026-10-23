import fs from 'node:fs'
import path from 'node:path'
import Module, { createRequire } from 'node:module'
import crypto from 'node:crypto'

const repo = process.argv[2]
const dbFile = process.argv[3]
if (!repo || !dbFile) throw new Error('Usage: node s2-isolated-process-center-acceptance.mjs <repo> <isolated-db>')
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
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  mod._compile(output, filename)
}

const check = (condition, message) => { if (!condition) throw new Error(message) }
const originalConsoleLog = console.log
console.log = (...args) => { if (!String(args[0]).startsWith('prisma:query')) originalConsoleLog(...args) }
const json = async (response) => ({ status: response.status, body: await response.json() })
const post = (body) => new Request('http://local/api/processes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function main() {
  const { db } = load(path.join(repo, 'src/lib/db.ts'))
  const { GET, POST } = load(path.join(repo, 'src/app/api/processes/route.ts'))
  const { registerRun, activeRunIds } = load(path.join(repo, 'src/lib/run-registry.ts'))
  const { registerModelOperation, activeModelOperationIds, unregisterModelOperation } = load(path.join(repo, 'src/lib/model-operation-registry.ts'))
  const { registerContourController, markContourOperationActive } = load(path.join(repo, 'src/lib/contour-operations.ts'))
  const { finishModelCallRecord } = load(path.join(repo, 'src/lib/model-call-record.ts'))
  const project = await db.project.create({ data: { name: '[DIAGNOSTIC] Process center fixture', description: 'Изолированный mock acceptance; не исследовательский результат.', origin: 'user' } })
  const otherProject = await db.project.create({ data: { name: '[DIAGNOSTIC] Other project', description: 'Project isolation fixture.', origin: 'user' } })
  const content = '# Isolated process center fixture\n\nДанные синтетические; внешняя модель не вызывается.'
  const document = await db.document.create({ data: { projectId: project.id, title: '[DIAGNOSTIC] Fixture instruction' } })
  const version = await db.documentVersion.create({ data: { projectId: project.id, documentId: document.id, label: 'fixture-v1', kind: 'original', source: 'user-fixture', content, contentHash: crypto.createHash('sha256').update(content).digest('hex'), isActive: true } })
  const fragment = await db.fragment.create({ data: { versionId: version.id, kind: 'paragraph', path: '1.1', order: 0, text: content, title: 'Fixture source', startLine: 1, endLine: 3 } })
  const position = await db.semanticPosition.create({ data: { projectId: project.id, versionId: version.id, title: 'Fixture position', purpose: 'Testing projection.', regulatedDecision: 'No research decision.', conditions: 'Synthetic only.', expectedBehavior: 'List existing process owners.', limitations: 'Not evidence about the instruction.', provenance: 'user', status: 'proposed', fragments: { create: { fragmentId: fragment.id } } } })

  const campaign = await db.researchCampaign.create({ data: { projectId: project.id, versionId: version.id, contentHash: version.contentHash, scopeType: 'positions', scopeSnapshot: JSON.stringify({ positionIds: [position.id] }), status: 'running', stage: 'interaction', modelActionsUsed: 1, maxModelActions: 10, roles: { create: { role: 'interpreter', backend: 'freellmapi', connectionId: 'fixture-connection', connectionName: '[DIAGNOSTIC] FreeLLMAPI mock', model: 'auto' } }, items: { create: { positionId: position.id, order: 0, status: 'in-progress', stage: 'interaction', interpretationStatus: 'supported' } } } })
  const campaignPosition = await db.researchCampaignPosition.findFirstOrThrow({ where: { campaignId: campaign.id } })
  const campaignAction = await db.researchCampaignAction.create({ data: { actionKey: `fixture:${campaign.id}`, campaignId: campaign.id, campaignPositionId: campaignPosition.id, actionType: 'interpretation', role: 'interpreter', attempt: 1, status: 'completed', finishedAt: new Date(), sources: { create: { fragmentId: fragment.id } } } })
  const childRun = await db.run.create({ data: { projectId: project.id, versionId: version.id, campaignActionId: campaignAction.id, role: 'interpreter', backend: 'freellmapi', connectionName: '[DIAGNOSTIC] FreeLLMAPI mock', model: 'auto', status: 'completed', input: JSON.stringify({ prompt: 'fixture only' }), output: 'synthetic answer', finishedAt: new Date() } })
  const nestedCall = await db.modelCall.create({ data: { projectId: project.id, runId: childRun.id, role: 'interpreter', action: 'fixture-interpreter', versionId: version.id, contextMode: 'none', messages: '[]', backend: 'freellmapi', connectionName: '[DIAGNOSTIC] FreeLLMAPI mock', requestedModel: 'auto', actualProvider: '[DIAGNOSTIC] mock route', actualModel: '[DIAGNOSTIC] mock model', status: 'completed' } })
  const standaloneRun = await db.run.create({ data: { projectId: project.id, versionId: version.id, role: 'explorer', backend: 'ollama', connectionName: '[DIAGNOSTIC] Ollama mock', model: 'fixture-model', status: 'queued', input: JSON.stringify({ prompt: 'fixture only' }) } })
  await db.run.create({ data: { projectId: otherProject.id, role: 'assistant', backend: 'freellmapi', model: 'auto', status: 'queued', input: '{}' } })

  const listing = await json(await GET(new Request(`http://local/api/processes?projectId=${project.id}`)))
  check(listing.status === 200, 'process projection endpoint returned 200')
  const rows = listing.body.processes
  const campaignRow = rows.find((row) => row.campaignId === campaign.id)
  check(campaignRow?.children.some((child) => child.id === campaignAction.id), 'campaign action appears under campaign')
  const actionNode = campaignRow.children.find((child) => child.id === campaignAction.id)
  check(actionNode.children[0]?.runId === childRun.id && actionNode.children[0]?.children[0]?.modelCallId === nestedCall.id, 'campaign action → Run → ModelCall hierarchy is preserved')
  check(rows.some((row) => row.runId === standaloneRun.id && row.type === 'run'), 'independent role Run appears once')
  check(!rows.some((row) => row.id === `model-call:${nestedCall.id}`), 'nested ModelCall is not misrepresented as an independent process')
  check(!rows.some((row) => row.projectId === otherProject.id), 'default project scope does not leak other project records')

  const pause = await json(await POST(post({ projectId: project.id, type: 'campaign', id: campaign.id, action: 'pause' })))
  check(pause.status === 200 && pause.body.campaign.status === 'paused', 'campaign pause is supported')
  const paused = await db.researchCampaign.findUniqueOrThrow({ where: { id: campaign.id } })
  check(JSON.parse(paused.processHistory).some((entry) => entry.action === 'paused-by-user'), 'pause is retained in process history')
  const resume = await json(await POST(post({ projectId: project.id, type: 'campaign', id: campaign.id, action: 'continue' })))
  check(resume.status === 200 && resume.body.driveRequired === true && resume.body.campaign.status === 'running', 'resume returns to running without creating an action itself')
  check(await db.researchCampaignAction.count({ where: { campaignId: campaign.id } }) === 1, 'pause/resume did not duplicate campaign actions')
  await POST(post({ projectId: project.id, type: 'campaign', id: campaign.id, action: 'pause' }))
  const predecessorHistoryBeforeRestart = (await db.researchCampaign.findUniqueOrThrow({ where: { id: campaign.id } })).processHistory
  const restarted = await json(await POST(post({ projectId: project.id, type: 'campaign', id: campaign.id, action: 'restart' })))
  check(restarted.status === 201 && restarted.body.campaign.status === 'prepared' && restarted.body.campaign.predecessorCampaignId === campaign.id, 'restart creates a separate prepared campaign linked to predecessor')
  check(restarted.body.campaign.modelActionsUsed === 0 && await db.researchCampaignAction.count({ where: { campaignId: restarted.body.campaign.id } }) === 0, 'restart does not copy results or run provider work')
  check((await db.researchCampaign.findUniqueOrThrow({ where: { id: campaign.id } })).processHistory === predecessorHistoryBeforeRestart, 'restart leaves predecessor history unchanged')

  const liveRun = await db.run.create({ data: { projectId: project.id, versionId: version.id, role: 'editor', backend: 'freellmapi', connectionName: '[DIAGNOSTIC] mock', model: 'auto', status: 'running', input: '{}' } })
  const runController = new AbortController(); registerRun(liveRun.id, runController)
  const stoppedRun = await json(await POST(post({ projectId: project.id, type: 'run', id: liveRun.id, action: 'stop' })))
  const savedStoppedRun = await db.run.findUniqueOrThrow({ where: { id: liveRun.id } })
  check(stoppedRun.status === 200 && runController.signal.aborted && savedStoppedRun.status === 'cancelled', 'active mock Run stop aborts local controller and closes only the Run')
  check(!activeRunIds().includes(liveRun.id), 'stopped Run is removed from active registry')
  const lateRunWrite = await db.run.updateMany({ where: { id: liveRun.id, status: 'running' }, data: { status: 'completed', output: 'late mock' } })
  check(lateRunWrite.count === 0 && (await db.run.findUniqueOrThrow({ where: { id: liveRun.id } })).status === 'cancelled', 'late conditional completion cannot revive cancelled Run')

  const directCall = await db.modelCall.create({ data: { projectId: project.id, role: 'assistant', action: 'fixture-chat', versionId: version.id, contextMode: 'none', messages: '[]', backend: 'freellmapi', requestedModel: 'auto', status: 'running' } })
  const callController = new AbortController(); registerModelOperation(directCall.id, callController)
  const stoppedCall = await json(await POST(post({ projectId: project.id, type: 'model-call', id: directCall.id, action: 'stop' })))
  check(stoppedCall.status === 200 && callController.signal.aborted && activeModelOperationIds().includes(directCall.id), 'ModelCall stop requests local abort without claiming provider termination')
  unregisterModelOperation(directCall.id)
  await finishModelCallRecord(directCall.id, { status: 'cancelled' })
  await finishModelCallRecord(directCall.id, { status: 'completed', actualProvider: 'late provider', actualModel: 'late model' })
  check((await db.modelCall.findUniqueOrThrow({ where: { id: directCall.id } })).status === 'cancelled', 'late ModelCall completion cannot overwrite cancelled provenance')

  const staleRun = await db.run.create({ data: { projectId: project.id, versionId: version.id, role: 'challenger', backend: 'freellmapi', connectionName: '[DIAGNOSTIC] mock', model: 'auto', status: 'running', input: '{}' } })
  const reconciledRun = await json(await POST(post({ projectId: project.id, type: 'run', id: staleRun.id, action: 'reconcile', basis: 'No active local owner found after test restart.' })))
  const staleRunSaved = await db.run.findUniqueOrThrow({ where: { id: staleRun.id } })
  check(reconciledRun.status === 200 && reconciledRun.body.verdict === 'unknown' && staleRunSaved.status === 'failed' && JSON.parse(staleRunSaved.input).processControlHistory.length === 1, 'stale Run requires explicit basis and closes as failed/unknown with history')

  const contourState = { schemaVersion: 1, operationId: 'fixture-op', status: 'running', stage: 'interpretation', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), coverage: [], blocks: [{ id: 'fixture-block', status: 'running', sectionPath: '1.1', modelCallId: null }], proposals: { positions: [], relations: [] }, materialized: { positions: [], relations: [] }, diagnostics: {} }
  const contour = await db.analysis.create({ data: { projectId: project.id, versionId: version.id, type: 'functional-semantic-contour', backend: 'freellmapi', model: 'auto', status: 'running', summary: '[DIAGNOSTIC] running mock step', result: JSON.stringify(contourState) } })
  const contourController = new AbortController(); registerContourController(contour.id, contourController); markContourOperationActive(contour.id, true)
  const contourStop = await json(await POST(post({ projectId: project.id, type: 'contour', id: contour.id, action: 'stop' })))
  const contourSaved = await db.analysis.findUniqueOrThrow({ where: { id: contour.id } })
  check(contourStop.status === 200 && contourController.signal.aborted && JSON.parse(contourSaved.result).status === 'cancelled', 'active contour step can be stopped and is saved as cancelled, not complete')

  const staleContourState = { ...contourState, operationId: 'stale-fixture-op', blocks: [{ id: 'stale-block', status: 'running', sectionPath: '1.2', modelCallId: null }] }
  const staleContour = await db.analysis.create({ data: { projectId: project.id, versionId: version.id, type: 'functional-semantic-contour', backend: 'freellmapi', model: 'auto', status: 'running', summary: '[DIAGNOSTIC] stale mock step', result: JSON.stringify(staleContourState) } })
  const contourReconcile = await json(await POST(post({ projectId: project.id, type: 'contour', id: staleContour.id, action: 'reconcile', basis: 'Local test owner absent; provider result unknown.' })))
  check(contourReconcile.status === 200 && contourReconcile.body.verdict === 'unknown' && JSON.parse((await db.analysis.findUniqueOrThrow({ where: { id: staleContour.id } })).result).status === 'failed', 'stale contour is explicitly closed as failed/unknown')

  const allProjects = await json(await GET(new Request('http://local/api/processes?allProjects=1')))
  check(allProjects.body.processes.some((row) => row.projectId === otherProject.id) && allProjects.body.processes.every((row) => row.projectName), 'all-projects mode includes ownership labels')
  console.log(JSON.stringify({ fixture: '[DIAGNOSTIC] isolated only; no model/embedding calls', projectId: project.id, nestedHierarchy: true, projectIsolation: true, pauseResumeWithoutDuplicate: true, restartLinked: true, activeRunStopAndLateGuard: true, modelCallAbortAndLateGuard: true, staleRunReconciliation: true, contourStopAndReconciliation: true, allProjectsLabelled: true }))
  await db.$disconnect()
}

main().catch(async (error) => {
  console.error(error)
  process.exitCode = 1
})
