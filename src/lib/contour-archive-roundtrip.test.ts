import assert from 'node:assert/strict'
import test from 'node:test'
import { PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import { buildFragmentsForVersion } from './parser'

test('full archive roundtrip remaps contour provenance and marks vectors rebuild-required in isolated SQLite', async () => {
  const content = '# Pilot\n\nSource one.\n\nSource two.'
  const hash = createHash('sha256').update(content, 'utf8').digest('hex')
  const time = '2026-10-20T00:00:00.000Z'
  const parsed = buildFragmentsForVersion('version-old', content)
  const fragmentOne = parsed.find((fragment) => fragment.text === 'Source one.')!
  const fragmentTwo = parsed.find((fragment) => fragment.text === 'Source two.')!
  const fragmentOneHash = createHash('sha256').update(fragmentOne.text, 'utf8').digest('hex')
  const fragmentTwoHash = createHash('sha256').update(fragmentTwo.text, 'utf8').digest('hex')
  const state = { schemaVersion: 1, operationId: 'operation-old', status: 'paused', stage: 'indexing', createdAt: time, updatedAt: time, coverage: [{ fragmentId: 'fragment-one', path: '1.1', status: 'processed' }, { fragmentId: 'fragment-two', path: '1.2', status: 'processed' }], blocks: [{ id: 'block-1', fragmentIds: ['fragment-one'], modelCallId: 'call-one', status: 'completed' }], proposals: { positions: [{ title: 'Position one', purpose: 'Purpose', fragmentIds: ['fragment-one'], modelCallId: 'call-one', actualProvider: 'provider', actualModel: 'model' }], relations: [] }, materialized: { positions: [], relations: [] }, indexState: { status: 'completed', entries: [{ representation: 'source', entityId: 'fragment-one', status: 'indexed' }], next: 1, error: null }, diagnostics: {} }
  const archive = {
    format: 'mmss-observatory-archive', archiveVersion: 1, exportedAt: time,
    project: {
      id: 'project-old', name: 'Synthetic contour archive', description: '', origin: 'real', connectionsIncluded: false,
      documents: [{ id: 'document-old', projectId: 'project-old', title: 'Pilot', createdAt: time, versions: [{ id: 'version-old', documentId: 'document-old', projectId: 'project-old', label: 'origin', kind: 'original', source: 'paste', completeness: 'full', content, contentHash: hash, importDate: time, isActive: true }] }],
      fragmentRefs: [{ id: 'fragment-one', versionId: 'version-old', path: fragmentOne.path, textHash: fragmentOneHash }, { id: 'fragment-two', versionId: 'version-old', path: fragmentTwo.path, textHash: fragmentTwoHash }],
      scenarios: [{ id: 'scenario-old', parentId: null, title: '[VALIDATION] Position one', description: 'Check', status: 'explored', origin: 'user', fragmentId: 'fragment-one', generationMetadata: null, pinned: false, order: 0, createdAt: time, updatedAt: time, runCount: 1, lastRunStatus: 'completed' }],
      runs: [{ id: 'run-old', projectId: 'project-old', scenarioId: 'scenario-old', versionId: 'version-old', parentRunId: null, role: 'executor', backend: 'freellmapi', connectionId: null, connectionName: 'FreeLLMAPI: test', model: 'auto', status: 'completed', input: { prompt: 'do', taskContext: { fragmentId: 'fragment-one', versionId: 'version-old' }, modelCallId: 'call-one', responseMetadata: { modelCallId: 'call-one', actualProvider: 'provider' } }, output: '{"result":"done"}', error: null, verdict: null, verdictBy: null, modelVerdict: null, modelVerdictBy: null, durationMs: 1, tokensIn: 1, tokensOut: 1, origin: 'real', createdAt: time, startedAt: time, finishedAt: time, programChecks: [] }],
      findings: [], notes: [], assignments: [], chatMessages: [],
      analyses: [{ id: 'analysis-old', versionId: 'version-old', type: 'functional-semantic-contour', backend: 'freellmapi', model: 'auto', status: 'completed', summary: 'fixture', result: state, createdAt: time }],
      modelCalls: [{ id: 'call-one', runId: 'run-old', role: 'interpreter', action: 'functional-semantic-contour-block', contextMode: 'none', contextMetadata: { operationId: 'operation-old', versionId: 'version-old', fragmentIds: ['fragment-one'] }, messages: [{ role: 'user', content: 'Source one.' }], backend: 'freellmapi', connectionName: 'test', requestedModel: 'auto', actualProvider: 'provider', actualModel: 'model', status: 'completed', relatedEntities: ['analysis:analysis-old', 'fragment:fragment-one', 'research-campaign:campaign-old', 'research-campaign-position:campaign-position-old', 'research-campaign-action:campaign-action-old'], createdAt: time }],
      researchCampaigns: [{
        id: 'campaign-old', projectId: 'project-old', versionId: 'version-old', contentHash: hash, scopeType: 'positions', scopeSnapshot: JSON.stringify({ positionIds: ['position-old'], fragmentIds: ['fragment-one'] }), depth: 'full',
        maxScenariosPerPosition: 2, maxModelActions: 20, maxAdditionalChecksPerPosition: 1, maxRetriesPerAction: 3, maxConcurrent: 1, stopOnQuota: true, stopOnTechnicalError: false, allowRewriteExperiment: false,
        status: 'paused', stage: 'executor', modelActionsUsed: 1, unmappedFragmentsCount: 0, pauseReason: 'user-paused', lastError: null, workerToken: null, workerLeaseUntil: null, startedAt: time, finishedAt: null, createdAt: time, updatedAt: time,
        roles: [{ id: 'campaign-role-old', campaignId: 'campaign-old', role: 'executor', backend: 'freellmapi', connectionId: 'connection-old', connectionName: 'FreeLLMAPI test', model: 'auto' }],
        items: [{ id: 'campaign-position-old', campaignId: 'campaign-old', positionId: 'position-old', order: 0, status: 'in-progress', stage: 'executor', interpretationStatus: 'supported', interactionStatus: 'compatible', scenarioStatus: 'completed', executionStatus: 'pending', reviewStatus: 'pending', verifiedSourceEvidence: true, additionalChecksUsed: 0, conclusion: 'in-progress', conclusionSummary: null, limitations: null, startedAt: time, finishedAt: null, createdAt: time, updatedAt: time,
          notApplicableChecks: [], checks: [{ id: 'campaign-check-old', campaignPositionId: 'campaign-position-old', scenarioId: 'scenario-old', ordinal: 1, objective: 'Check missing history', input: 'No messages', expectedBehavior: 'Do not invent', criterion: 'Preserve absence', status: 'completed', createdAt: time, sources: [{ id: 'campaign-check-source-old', checkId: 'campaign-check-old', fragmentId: 'fragment-one' }] }], actions: [] }],
        actions: [{ id: 'campaign-action-old', actionKey: 'campaign-old:position-old:executor:scenario-old:1', campaignId: 'campaign-old', campaignPositionId: 'campaign-position-old', scenarioId: 'scenario-old', checkId: 'campaign-check-old', actionType: 'executor', role: 'executor', attempt: 1, status: 'completed', error: null, startedAt: time, finishedAt: time, createdAt: time, updatedAt: time, runId: 'run-old', sources: [{ id: 'campaign-action-source-old', actionId: 'campaign-action-old', fragmentId: 'fragment-one' }] }],
      }],
      semanticIndexPolicy: 'rebuild-on-import',
      semanticPositions: [{ id: 'position-old', versionId: 'version-old', title: 'Position one', purpose: 'Purpose', regulatedDecision: 'Decision', conditions: 'Conditions', expectedBehavior: 'Expected', limitations: '', provenance: 'model-interpret', provenanceRef: 'analysis-old', sourceFragmentRefs: { modelCallId: 'call-one', actualProvider: 'provider', actualModel: 'model' }, status: 'proposed', createdAt: time, updatedAt: time, fragments: [{ id: 'fragment-one', path: fragmentOne.path, textHash: fragmentOneHash }] }, { id: 'position-two', versionId: 'version-old', title: 'Position two', purpose: 'Purpose two', regulatedDecision: 'Decision', conditions: 'Conditions', expectedBehavior: 'Expected', limitations: '', provenance: 'user', provenanceRef: null, sourceFragmentRefs: [], status: 'proposed', createdAt: time, updatedAt: time, fragments: [{ id: 'fragment-two', path: fragmentTwo.path, textHash: fragmentTwoHash }] }],
      semanticRelations: [{ id: 'relation-old', versionId: 'version-old', sourcePositionId: 'position-old', targetPositionId: 'position-two', kind: 'supports', rationale: 'fixture', provenance: 'model-proposal', status: 'proposed', createdAt: time }],
      positionObservations: [{ id: 'observation-old', versionId: 'version-old', positionId: 'position-old', runId: 'run-old', noteId: null, observation: 'Observed', evidenceText: 'Evidence', conditions: 'Conditions', criterion: 'Criterion', status: 'unverified', limitations: '', createdAt: time }],
    },
  }
  const databaseUrl = process.env.DATABASE_URL
  assert.ok(databaseUrl?.startsWith('file:'), 'DATABASE_URL must point at the isolated test database')
  const client = new PrismaClient()
  try {
    const { db } = await import('./db')
    const { importProjectArchive } = await import('./importers')
    const result = await importProjectArchive(archive)
    const projectId = result.project.id
    const counts = {
      runs: await db.run.count({ where: { projectId } }), scenarios: await db.scenario.count({ where: { projectId } }),
      analyses: await db.analysis.count({ where: { projectId } }), calls: await db.modelCall.count({ where: { projectId } }),
      positions: await db.semanticPosition.count({ where: { projectId } }), relations: await db.semanticRelation.count({ where: { projectId } }),
      observations: await db.positionObservation.count({ where: { projectId } }), vectors: await db.embeddingVector.count({ where: { projectId } }),
      campaigns: await db.researchCampaign.count({ where: { projectId } }), campaignActions: await db.researchCampaignAction.count({ where: { campaign: { projectId } } }),
    }
    assert.equal(counts.runs, archive.project.runs.length)
    assert.equal(counts.scenarios, archive.project.scenarios.length)
    assert.equal(counts.calls, archive.project.modelCalls.length)
    assert.equal(counts.positions, archive.project.semanticPositions.length)
    assert.equal(counts.relations, archive.project.semanticRelations.length)
    assert.equal(counts.observations, archive.project.positionObservations.length)
    assert.equal(counts.vectors, 0)
    assert.equal(counts.campaigns, 1)
    assert.equal(counts.campaignActions, 1)
    const campaign = await db.researchCampaign.findFirst({ where: { projectId }, include: { items: { include: { checks: { include: { sources: true } } } } } })
    assert.ok(campaign)
    assert.equal(campaign.status, 'blocked')
    assert.equal(campaign.pauseReason, 'import-reconciliation')
    assert.notEqual(campaign.items[0].positionId, 'position-old')
    assert.equal((JSON.parse(campaign.scopeSnapshot) as { positionIds: string[] }).positionIds[0], campaign.items[0].positionId)
    assert.notEqual(campaign.items[0].checks[0].scenarioId, 'scenario-old')
    assert.notEqual(campaign.items[0].checks[0].sources[0].fragmentId, 'fragment-one')
    const importedAction = await db.researchCampaignAction.findFirst({ where: { campaignId: campaign.id }, include: { run: true, sources: true } })
    assert.ok(importedAction)
    assert.equal(importedAction.run?.id, await db.run.findFirstOrThrow({ where: { projectId } }).then((row) => row.id))
    assert.notEqual(importedAction.sources[0].fragmentId, 'fragment-one')
    const sourceContour = archive.project.analyses.find((item: { type: string }) => item.type === 'functional-semantic-contour')
    if (sourceContour) {
      const imported = await db.analysis.findFirst({ where: { projectId, type: 'functional-semantic-contour' } })
      assert.ok(imported)
      const source = JSON.parse(JSON.stringify(sourceContour.result))
      const target = JSON.parse(imported.result)
      assert.notEqual(target.operationId, source.operationId)
      assert.equal(target.importedIndexRebuildRequired, true)
      assert.ok(target.blocks.every((block: { fragmentIds: string[] }) => block.fragmentIds.every((id) => id !== 'fragment-one')))
      assert.equal(target.coverage.length, source.coverage.length)
      assert.notEqual(target.indexState.entries[0].entityId, 'fragment-one')
    }
    const importedPosition = await db.semanticPosition.findFirst({ where: { projectId, title: 'Position one' } })
    assert.ok(importedPosition)
    assert.notEqual(importedPosition.provenanceRef, 'analysis-old')
    const refs = JSON.parse(importedPosition.sourceFragmentRefs)
    assert.ok(typeof refs.modelCallId === 'string' && refs.modelCallId !== 'call-one')
    const relation = await db.semanticRelation.findFirst({ where: { projectId } })
    assert.ok(relation)
    assert.notEqual(relation.sourcePositionId, 'position-old')
    assert.notEqual(relation.targetPositionId, 'position-two')
    const observation = await db.positionObservation.findFirst({ where: { projectId } })
    assert.ok(observation)
    assert.notEqual(observation.positionId, 'position-old')
    assert.notEqual(observation.runId, 'run-old')
    const call = await db.modelCall.findFirst({ where: { projectId } })
    assert.ok(call)
    const related = JSON.parse(call.relatedEntities) as string[]
    assert.ok(related.some((item) => item.startsWith('fragment:')))
    assert.ok(related.some((item) => item.startsWith('analysis:')))
    assert.ok(related.some((item) => item === `research-campaign:${campaign.id}`))
    assert.ok(related.some((item) => item === `research-campaign-position:${campaign.items[0].id}`))
    console.log(JSON.stringify({ projectId, counts, warnings: result.warnings }))
  } finally {
    await client.$disconnect()
  }
})
