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
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  mod._compile(output, filename)
}
const check = (condition, message) => { if (!condition) throw new Error(message) }
const request = (body, method = 'POST') => new Request('http://local/api/semantic/contour', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
async function json(response) { const value = await response.json(); return { status: response.status, value } }
async function main() {
  const { db } = load(path.join(repo, 'src/lib/db.ts'))
  const { buildFragmentsForVersion } = load(path.join(repo, 'src/lib/parser.ts'))
  const { POST: contourPost, GET: contourGet } = load(path.join(repo, 'src/app/api/semantic/contour/route.ts'))
  const positionRoute = load(path.join(repo, 'src/app/api/semantic/positions/[id]/route.ts'))
  const relationRoute = load(path.join(repo, 'src/app/api/semantic/relations/[id]/route.ts'))
  const discrepancyRoute = load(path.join(repo, 'src/app/api/semantic/discrepancies/[id]/route.ts'))
  const { buildProjectArchive } = load(path.join(repo, 'src/lib/exporters.ts'))
  const { importProjectArchive } = load(path.join(repo, 'src/lib/importers.ts'))
  const content = `# Synthetic decision fixture` + String.fromCharCode(10) + `Если входной объект содержит поле message со строковым значением, вернуть эту строку. Иначе вернуть объект ошибки. Не восстанавливать отсутствующее значение.`
  const project = await db.project.create({ data: { name: '[DIAGNOSTIC] Branching graph fixture', description: 'Изолированный синтетический fixture; не исследовательский результат.', origin: 'user' } })
  const document = await db.document.create({ data: { projectId: project.id, title: '[DIAGNOSTIC] Синтетическая инструкция' } })
  const version = await db.documentVersion.create({ data: { projectId: project.id, documentId: document.id, label: 'fixture-1', kind: 'original', source: 'user-fixture', content, contentHash: crypto.createHash('sha256').update(content).digest('hex'), isActive: true } })
  const generatedFragments = buildFragmentsForVersion(version.id, content)
  await db.fragment.createMany({ data: generatedFragments })
  const fragment = await db.fragment.findFirst({ where: { versionId: version.id }, orderBy: { order: 'asc' } })
  check(Boolean(fragment), 'parser created source fragments')
  const started = await json(await contourPost(request({ action: 'start', projectId: project.id, versionId: version.id })))
  check(started.status === 201, `start status ${started.status}`)
  const analysisId = started.value.analysisId
  const positions = []
  for (const [n, title] of ['Fixture source basis A', 'Fixture source basis B'].entries()) positions.push(await db.semanticPosition.create({ data: {
    projectId: project.id, versionId: version.id, title, purpose: 'Synthetic fixture only.', regulatedDecision: 'Check message type.', conditions: 'Input object has a message field.', expectedBehavior: 'String returns exactly; otherwise an error object.', limitations: 'Does not describe the researched skill.', provenance: 'user', provenanceRef: analysisId, status: 'proposed', fragments: { create: { fragmentId: fragment.id } },
  } }))
  const flowCreated = await json(await contourPost(request({ action: 'decision-flow', projectId: project.id, versionId: version.id, analysisId, positionIds: [positions[0].id], caseLabel: 'Synthetic branch: message string vs other input' })))
  check(flowCreated.status === 200, `flow create ${flowCreated.status}: ${JSON.stringify(flowCreated.value)}`)
  let flow = flowCreated.value.flow
  const node = (id, kind, title, condition, expectedAction) => ({ nodeId: id, kind, provenance: 'user', status: 'proposed', basis: 'Синтетическая инструкция fixture, fragment 1.1.', positionId: positions[0].id, positionIds: [positions[0].id], order: 1, title, condition, applicableRule: 'Учитывать только наличие строкового значения.', check: 'Проверить тип поля message.', expectedAction, exceptionOrLimit: '', allowedResult: null, uncertainty: 'Это синтетическая проверка механизма, не проверка скилла.', sourceFragmentIds: [fragment.id] })
  const nodes = [node('fixture-condition', 'condition', 'Проверка message', 'message существует и строка?', 'Разветвить по условию'), node('fixture-success-action', 'action', 'Успешная ветвь', 'Да', 'Вернуть строку message'), node('fixture-success-result', 'expected-result', 'Результат успешной ветви', 'Ветка true', 'Точная исходная строка'), node('fixture-error-action', 'action', 'Ошибочная ветвь', 'Нет', 'Вернуть объект ошибки'), node('fixture-error-result', 'expected-result', 'Результат ошибочной ветви', 'Ветка false', 'Объект ошибки без догадки о пропущенном значении')]
  let updated = await json(await contourPost(request({ action: 'decision-flow-update', projectId: project.id, versionId: version.id, analysisId, flowId: flow.id, flowPatch: { nodes } })))
  check(updated.status === 200, `nodes ${updated.status}: ${JSON.stringify(updated.value)}`); flow = updated.value.flow
  const transitions = [
    { id: 'fixture-edge-yes', fromNodeId: 'fixture-condition', toNodeId: 'fixture-success-action', conditionLabel: 'Да: message — строка', basis: 'Инструкция требует вернуть строковое значение поля message.', positionIds: [positions[0].id], sourceFragmentIds: [fragment.id], provenance: 'user', status: 'proposed', limitations: 'Synthetic fixture only.' },
    { id: 'fixture-edge-no', fromNodeId: 'fixture-condition', toNodeId: 'fixture-error-action', conditionLabel: 'Нет: message отсутствует или не строка', basis: 'Инструкция требует вернуть объект ошибки и запрещает восстанавливать значение.', positionIds: [positions[0].id], sourceFragmentIds: [fragment.id], provenance: 'user', status: 'proposed', limitations: 'Synthetic fixture only.' },
  ]
  updated = await json(await contourPost(request({ action: 'decision-flow-update', projectId: project.id, versionId: version.id, analysisId, flowId: flow.id, flowPatch: { transitions } })))
  check(updated.status === 200, `edges ${updated.status}: ${JSON.stringify(updated.value)}`); flow = updated.value.flow
  // Manual edit persists through a fresh handler GET.
  const editedNodes = flow.nodes.map(n => n.nodeId === 'fixture-success-action' ? { ...n, title: 'Успешная ветвь · отредактировано вручную' } : n)
  updated = await json(await contourPost(request({ action: 'decision-flow-update', projectId: project.id, versionId: version.id, analysisId, flowId: flow.id, flowPatch: { nodes: editedNodes } })))
  check(updated.status === 200, 'manual edit saved'); flow = updated.value.flow
  // Node decision lifecycle, explicit grounds, immutable server-authored history.
  for (const [status, basis] of [['accepted','Проверено по synthetic fixture'],['disputed','Найдено неоднозначное правило fixture'],['proposed','Оставлено на рассмотрение']]) {
    const nextNodes = flow.nodes.map(n => n.nodeId === 'fixture-condition' ? { ...n, status, decisionBasis: basis, decisionHistory: [{ actorType:'forged' }] } : n)
    updated = await json(await contourPost(request({ action: 'decision-flow-update', projectId: project.id, versionId: version.id, analysisId, flowId: flow.id, flowPatch: { nodes: nextNodes } })))
    check(updated.status === 200, `node decision ${status}: ${JSON.stringify(updated.value)}`); flow = updated.value.flow
  }
  const nodeHistory = flow.nodes.find(n => n.nodeId === 'fixture-condition').decisionHistory
  check(nodeHistory.length === 3 && nodeHistory.every(e => e.actorType === 'user' && e.basis && e.decidedAt), 'node history trustworthy')
  // Transition decision lifecycle, with source basis kept distinct from decision basis.
  for (const [status, basis] of [['accepted','Путь соответствует условию fixture'],['disputed','Уточнить область else для fixture'],['proposed','Оставить без принятия']]) {
    updated = await json(await contourPost(request({ action: 'decision-flow-update', projectId: project.id, versionId: version.id, analysisId, flowId: flow.id, flowPatch: { transitionDecision: { id: 'fixture-edge-yes', status, basis } } })))
    check(updated.status === 200, `edge decision ${status}: ${JSON.stringify(updated.value)}`); flow = updated.value.flow
  }
  const edge = flow.transitions.find(e => e.id === 'fixture-edge-yes')
  check(edge.decisionHistory.length === 3 && edge.decisionHistory.every(e => e.actorType === 'user' && e.basis), 'transition history retained')
  const noBasis = await json(await contourPost(request({ action:'decision-flow-update', projectId:project.id, versionId:version.id, analysisId, flowId:flow.id, flowPatch:{ transitionDecision:{ id:'fixture-edge-yes', status:'accepted' } } })))
  check(noBasis.status === 400, 'missing decision basis rejected')
  const badRef = await json(await contourPost(request({ action:'decision-flow-update', projectId:project.id, versionId:version.id, analysisId, flowId:flow.id, flowPatch:{ appendTransition:{ fromNodeId:'missing', toNodeId:'fixture-error-action', conditionLabel:'bad', basis:'invalid reference', positionIds:[positions[0].id], sourceFragmentIds:[fragment.id] } } })))
  check(badRef.status === 400, 'missing node reference rejected')
  const badSource = await json(await contourPost(request({ action:'decision-flow-update', projectId:project.id, versionId:version.id, analysisId, flowId:flow.id, flowPatch:{ appendTransition:{ fromNodeId:'fixture-condition', toNodeId:'fixture-error-action', conditionLabel:'bad source', basis:'invalid source', positionIds:[positions[0].id], sourceFragmentIds:['foreign-fragment'] } } })))
  check(badSource.status === 400, 'foreign fragment rejected')
  const deleteUsedNode = await json(await contourPost(request({ action:'decision-flow-update', projectId:project.id, versionId:version.id, analysisId, flowId:flow.id, flowPatch:{ nodes:flow.nodes.filter(n=>n.nodeId!=='fixture-error-action') } })))
  check(deleteUsedNode.status === 400, 'node referenced by transition cannot be deleted')
  const reloaded = await json(await contourGet(new Request(`http://local/api/semantic/contour?projectId=${project.id}&versionId=${version.id}`)))
  flow = reloaded.value.state.decisionFlows[0]
  check(flow.executed === false && flow.nodes.find(n=>n.nodeId==='fixture-success-action').title.includes('отредактировано'), 'GET reload preserves expected graph but not execution')
  check(flow.transitions.length === 2 && flow.transitions.every(t=>t.status==='proposed'), 'expected branches remain proposed')
  // Other existing status routes also persist immutable user decisions.
  const noBasisPosition = await json(await positionRoute.PATCH(new Request('http://local', {method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({status:'accepted'})}), {params:Promise.resolve({id:positions[1].id})}))
  check(noBasisPosition.status===400, 'position status without basis rejected')
  for (const status of ['accepted','disputed']) {
    const response=await json(await positionRoute.PATCH(new Request('http://local',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({status,decisionBasis:`fixture decision ${status}`})}),{params:Promise.resolve({id:positions[1].id})}))
    check(response.status===200,`position ${status}`)
  }
  const relation=await db.semanticRelation.create({data:{projectId:project.id,versionId:version.id,sourcePositionId:positions[0].id,targetPositionId:positions[1].id,kind:'supports',rationale:'Synthetic only',provenance:'user',status:'proposed'}})
  for (const status of ['accepted','disputed']) {
    const response=await json(await relationRoute.PATCH(new Request('http://local',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({status,basis:`fixture relation ${status}`})}),{params:Promise.resolve({id:relation.id})}))
    check(response.status===200,`relation ${status}`)
  }
  const discBody={schema:1,type:'s2-research-discrepancy-v1',assessment:'insufficient-basis',status:'proposed',criterion:'fixture criterion',summary:'fixture discrepancy',runIds:[],observationIds:[],positionIds:[positions[1].id],fragmentIds:[fragment.id],evidence:[],limitations:['isolated'],userDecision:null}
  const disc=await db.note.create({data:{projectId:project.id,versionId:version.id,kind:'objection',author:'system-proposal',body:JSON.stringify(discBody)}})
  for(const decision of ['confirmed','rejected']) {
    const response=await json(await discrepancyRoute.PATCH(new Request('http://local',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({decision,note:`fixture discrepancy ${decision}`})}),{params:Promise.resolve({id:disc.id})}))
    check(response.status===200,`discrepancy ${decision}`)
  }
  const payload=JSON.parse((await db.note.findUnique({where:{id:disc.id}})).body)
  check(payload.decisionHistory.length===2 && payload.decisionHistory[0].previousStatus==='proposed' && payload.decisionHistory[1].previousStatus==='accepted','discrepancy history retained')
  const eventNotes=await db.note.findMany({where:{projectId:project.id,kind:'user-verdict',author:'user'}})
  console.log('eventNotes='+eventNotes.length); check(eventNotes.length===6,'position/relation user decisions are auditable notes')
  const scenario=await db.scenario.create({data:{projectId:project.id,title:'[DIAGNOSTIC] isolated scenario',description:'Fixture',status:'unexplored',origin:'user',fragmentId:fragment.id}})
  const run=await db.run.create({data:{projectId:project.id,scenarioId:scenario.id,versionId:version.id,role:'executor',backend:'fixture',status:'completed',input:JSON.stringify({messages:[{role:'user',content:content}]}),output:'fixture answer',origin:'real'}})
  const modelCall=await db.modelCall.create({data:{projectId:project.id,runId:run.id,role:'executor',action:'fixture-executor',versionId:version.id,contextMode:'selected',contextMetadata:JSON.stringify({fragmentIds:[fragment.id]}),messages:JSON.stringify([{role:'user',content}]),backend:'freellmapi',connectionName:'[DIAGNOSTIC] FreeLLMAPI mock',requestedModel:'auto',actualProvider:'[DIAGNOSTIC] mock-provider',actualModel:'[DIAGNOSTIC] mock-model',status:'completed',relatedEntities:JSON.stringify([`run:${run.id}`])}})
  await db.run.update({where:{id:run.id},data:{input:JSON.stringify({messages:[{role:'user',content}],modelCallId:modelCall.id,responseMetadata:{modelCallId:modelCall.id,actualProvider:modelCall.actualProvider,actualModel:modelCall.actualModel}})}})
  await db.positionObservation.create({data:{projectId:project.id,versionId:version.id,positionId:positions[0].id,runId:run.id,observation:'fixture observation',evidenceText:'fixture answer',status:'unverified',limitations:'isolated test'}})
  const campaign=await db.researchCampaign.create({data:{projectId:project.id,versionId:version.id,contentHash:version.contentHash,scopeType:'positions',scopeSnapshot:JSON.stringify({positionIds:[positions[0].id],fragmentIds:[fragment.id]}),depth:'full',status:'paused',stage:'executor',pauseReason:'user-paused',modelActionsUsed:1,roles:{create:{role:'executor',backend:'freellmapi',connectionId:'source-connection',connectionName:'FreeLLMAPI fixture',model:'auto'}},items:{create:{positionId:positions[0].id,order:0,status:'in-progress',stage:'executor',interpretationStatus:'supported',interactionStatus:'compatible',scenarioStatus:'completed',conclusion:'in-progress',checks:{create:{scenarioId:scenario.id,ordinal:1,objective:'Check preserved absence',input:'No message',expectedBehavior:'Do not invent',criterion:'Keep source absence',status:'completed',sources:{create:{fragmentId:fragment.id}}}}}}}})
  await db.researchCampaign.create({data:{projectId:project.id,versionId:version.id,contentHash:version.contentHash,scopeType:'positions',scopeSnapshot:JSON.stringify({positionIds:[positions[1].id],fragmentIds:[fragment.id]}),depth:'interpretation',status:'paused',stage:'interpretation',pauseReason:'user-paused',modelActionsUsed:4,maxModelActions:null,budgetHistory:JSON.stringify([{changedAt:'2026-10-23T10:00:00.000Z',before:{mode:'limited',maxModelActions:20},after:{mode:'unlimited',maxModelActions:null},modelActionsUsed:4}]),items:{create:{positionId:positions[1].id,order:0}}}})
  const campaignItem=await db.researchCampaignPosition.findFirstOrThrow({where:{campaignId:campaign.id}})
  const campaignCheck=await db.researchCampaignCheck.findFirstOrThrow({where:{campaignPositionId:campaignItem.id}})
  const campaignAction=await db.researchCampaignAction.create({data:{actionKey:`${campaign.id}:fixture:executor:1`,campaignId:campaign.id,campaignPositionId:campaignItem.id,scenarioId:scenario.id,checkId:campaignCheck.id,actionType:'executor',role:'executor',attempt:1,status:'completed',run:{connect:{id:run.id}},sources:{create:{fragmentId:fragment.id}}}})
  const archive=await buildProjectArchive(project.id,['documents','scenarios','runs','findings','notes','assignments','chat','analyses','semantic','campaigns'])
  check(Boolean(archive),'archive built')
  check(archive.project.researchCampaigns?.length===2,'archive includes both bounded and explicitly unlimited research campaigns')
  check(archive.project.modelCalls?.length===1,'archive contains ModelCall provenance linked to Run')
  const sourceCounts={runs:await db.run.count({where:{projectId:project.id}}),modelCalls:await db.modelCall.count({where:{projectId:project.id}})}
  const imported=await importProjectArchive(archive)
  const importedProjectId=imported.project.id
  const importedFlow=(await db.analysis.findFirst({where:{projectId:importedProjectId,type:'functional-semantic-contour'}}))
  const restoredFlow=JSON.parse(importedFlow.result).decisionFlows[0]
  const restoredNode=restoredFlow.nodes.find(n=>n.title.includes('Проверка message'))
  check(restoredNode.positionIds[0]!==positions[0].id && restoredNode.sourceFragmentIds[0]!==fragment.id && !restoredNode.sourceFragmentIds[0].startsWith('source:') && restoredNode.decisionHistory.length===3,'archive remaps flow links while preserving history')
  check(restoredFlow.transitions.every(t=>t.status==='proposed' && t.decisionHistory?.length=== (t.id==='fixture-edge-yes'?3:0)),'archive restores branch status/history')
  const restoredEvent=await db.note.findFirst({where:{projectId:importedProjectId,kind:'user-verdict',author:'user'},orderBy:{createdAt:'asc'}})
  const ev=JSON.parse(restoredEvent.body)
  check(ev.objectId!==positions[1].id && ev.actorType==='user','archive remaps decision event object ID')
  const restoredDisc=await db.note.findFirst({where:{projectId:importedProjectId,kind:'objection',author:'system-proposal'}})
  const restoredDiscPayload=JSON.parse(restoredDisc.body)
  check(restoredDiscPayload.positionIds[0]!==positions[1].id && restoredDiscPayload.decisionHistory.length===2,'archive remaps discrepancy links and preserves history')
  const restoredVectors=await db.embeddingVector.count({where:{projectId:importedProjectId}})
  const rebuildRequired=JSON.parse(importedFlow.result).importedIndexRebuildRequired; check(restoredVectors===0 && rebuildRequired===true,'roundtrip requires index rebuild and imports no vectors')
  const restoredCampaign=await db.researchCampaign.findFirst({where:{projectId:importedProjectId},include:{roles:true,items:{include:{checks:{include:{sources:true}}}},actions:{include:{run:true,sources:true}}}})
  check(restoredCampaign?.status==='blocked'&&restoredCampaign.pauseReason==='import-reconciliation','unfinished imported campaign is blocked for reconciliation')
  check(restoredCampaign.depth==='full'&&restoredCampaign.maxModelActions===20&&restoredCampaign.maxRetriesPerAction===3&&restoredCampaign.maxConcurrent===1&&restoredCampaign.stopOnQuota===true,'campaign policy limits and stop rules survive archive')
  const restoredUnlimited=await db.researchCampaign.findFirstOrThrow({where:{projectId:importedProjectId,maxModelActions:null}})
  check(restoredUnlimited.status==='blocked'&&restoredUnlimited.maxModelActions===null&&JSON.parse(restoredUnlimited.budgetHistory).length===1&&JSON.parse(restoredUnlimited.budgetHistory)[0].modelActionsUsed===4,'archive round-trip preserves unlimited mode and its explicit budget history without auto-starting')
  check(restoredCampaign.roles.length===1&&restoredCampaign.roles[0].role==='executor'&&restoredCampaign.roles[0].backend==='freellmapi'&&restoredCampaign.roles[0].model==='auto','campaign role assignment snapshot survives archive')
  check(restoredCampaign.items[0].positionId!==positions[0].id&&restoredCampaign.items[0].checks[0].scenarioId!==scenario.id,'campaign position and scenario references remapped')
  check(JSON.parse(restoredCampaign.scopeSnapshot).positionIds[0]===restoredCampaign.items[0].positionId,'campaign scope snapshot references remapped')
  check(restoredCampaign.items[0].checks[0].sources[0].fragmentId!==fragment.id&&restoredCampaign.actions[0].sources[0].fragmentId!==fragment.id,'campaign source provenance remapped')
  check(Boolean(restoredCampaign.actions[0].run?.id)&&restoredCampaign.actions[0].run?.output==='fixture answer','campaign action retains linked Run')
  const restoredCall=await db.modelCall.findFirst({where:{projectId:importedProjectId}})
  const restoredRun=await db.run.findFirst({where:{projectId:importedProjectId}})
  check(restoredCall?.runId===restoredRun?.id&&restoredCall?.actualProvider==='[DIAGNOSTIC] mock-provider'&&restoredCall?.actualModel==='[DIAGNOSTIC] mock-model','ModelCall actual route and Run relation survive archive')
  check(JSON.parse(restoredRun.input).responseMetadata.modelCallId===restoredCall.id&&JSON.parse(restoredCall.relatedEntities).includes(`run:${restoredRun.id}`),'Run and ModelCall provenance references are remapped')
  check(JSON.parse(restoredCall.messages)[0].content===content,'ModelCall messages survive archive')
  const importedCounts={runs:await db.run.count({where:{projectId:importedProjectId}}),modelCalls:await db.modelCall.count({where:{projectId:importedProjectId}})}
  check(importedCounts.runs===sourceCounts.runs&&importedCounts.modelCalls===sourceCounts.modelCalls,'archive import restores saved records without an extra execution/ModelCall')
  console.log(JSON.stringify({fixtureProjectId:project.id,versionId:version.id,analysisId,flowId:flow.id,nodeCount:flow.nodes.length,transitionCount:flow.transitions.length,nodeDecisionHistory:nodeHistory.length,edgeDecisionHistory:edge.decisionHistory.length,proposedAfterDecisionCycle:flow.nodes.find(n=>n.nodeId==='fixture-condition').status==='proposed'&&flow.transitions.every(t=>t.status==='proposed'),expectedExecuted:flow.executed,invalidNodeRefStatus:badRef.status,invalidSourceStatus:badSource.status,usedNodeDeletionStatus:deleteUsedNode.status,positionDecisionEventCount:eventNotes.length,discrepancyDecisionHistory:payload.decisionHistory.length,archiveImportedProjectId:importedProjectId,remappedPositionIds:restoredNode.positionIds,remappedFragmentIds:restoredNode.sourceFragmentIds,importedVectors:restoredVectors,indexRebuildRequired:rebuildRequired,campaignId:restoredCampaign.id,campaignStatus:restoredCampaign.status,actionRunId:restoredCampaign.actions[0].run.id,campaignActionId:campaignAction.id,campaignPolicyRestored:true,modelCallId:restoredCall.id,modelCallRunId:restoredCall.runId,modelCallActualProvider:restoredCall.actualProvider,modelCallActualModel:restoredCall.actualModel,roundtripCounts:importedCounts,executionTriggeredByImport:false}))
  await db.$disconnect()
}
main().catch(error=>{console.error(error);process.exitCode=1})
