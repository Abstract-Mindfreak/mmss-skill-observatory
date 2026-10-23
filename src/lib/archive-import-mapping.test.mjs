import assert from 'node:assert/strict'
import test from 'node:test'
import { makeCampaignProcessHistoryPortable, remapCampaignProcessHistory, remapRunInputReferences } from './archive-import-mapping.ts'

test('campaign history references remap to imported IDs', () => {
  const result = remapCampaignProcessHistory(
    [{ at: '2026-01-01', action: 'restart', basis: 'user', relatedCampaignId: 'old-campaign' }],
    new Map([['old-campaign', 'new-campaign']])
  )
  assert.deepEqual(result.history, [{ at: '2026-01-01', action: 'restart', basis: 'user', relatedCampaignId: 'new-campaign' }])
  assert.deepEqual(result.warnings, [])
})

test('missing campaign references remain historical, not live local links', () => {
  const result = remapCampaignProcessHistory(
    [{ at: '2026-01-01', action: 'restart', basis: 'user', relatedCampaignId: 'missing-campaign' }],
    new Map()
  )
  assert.deepEqual(result.history, [{ at: '2026-01-01', action: 'restart', basis: 'user', sourceRelatedCampaignId: 'missing-campaign' }])
  assert.equal(result.warnings.length, 1)
})

test('archive form marks source campaign IDs as historical for older importers', () => {
  assert.deepEqual(
    makeCampaignProcessHistoryPortable([{ action: 'restart', relatedCampaignId: 'old-campaign' }]),
    [{ action: 'restart', sourceRelatedCampaignId: 'old-campaign' }]
  )
  const imported = remapCampaignProcessHistory(
    [{ action: 'restart', sourceRelatedCampaignId: 'old-campaign' }],
    new Map([['old-campaign', 'new-campaign']])
  )
  assert.deepEqual(imported.history, [{ action: 'restart', relatedCampaignId: 'new-campaign' }])
  assert.deepEqual(makeCampaignProcessHistoryPortable({ unexpected: true }), [])
})

test('Run.input structured references remap without changing prompts or messages', () => {
  const input = {
    taskContext: {
      versionId: 'old-version',
      scenarioId: 'old-scenario',
      instructionContext: { versionId: 'old-version', fragmentIds: ['old-fragment'] },
    },
    skillVerification: { versionId: 'old-version', sha256: 'unchanged-hash' },
    responseMetadata: { contextFragmentIds: ['old-fragment'], actualProvider: 'provider-as-saved' },
    processControlHistory: [{ relatedRunId: 'old-run', action: 'retry' }],
    prompt: 'Keep these literal identifiers: old-version old-scenario old-fragment old-run.',
    sentMessages: [{ role: 'user', content: 'The user message remains unchanged.' }],
  }
  const prompt = input.prompt
  const sentMessages = structuredClone(input.sentMessages)
  const result = remapRunInputReferences(input, {
    versionIdMap: new Map([['old-version', 'new-version']]),
    fragmentIdMap: new Map([['old-fragment', 'new-fragment']]),
    scenarioIdMap: new Map([['old-scenario', 'new-scenario']]),
    runIdMap: new Map([['old-run', 'new-run']]),
  })

  assert.deepEqual(result.input, {
    ...input,
    taskContext: {
      versionId: 'new-version',
      scenarioId: 'new-scenario',
      instructionContext: { versionId: 'new-version', fragmentIds: ['new-fragment'] },
    },
    skillVerification: { versionId: 'new-version', sha256: 'unchanged-hash' },
    responseMetadata: { contextFragmentIds: ['new-fragment'], actualProvider: 'provider-as-saved' },
    processControlHistory: [{ relatedRunId: 'new-run', action: 'retry' }],
  })
  assert.equal(result.warnings.length, 0)
  assert.equal(result.input.prompt, prompt)
  assert.deepEqual(result.input.sentMessages, sentMessages)
  assert.deepEqual(input.taskContext.instructionContext.fragmentIds, ['old-fragment'])
})

test('unresolved Run.input references become historical and are warned', () => {
  const input = {
    taskContext: {
      versionId: 'missing-version',
      scenarioId: 'missing-scenario',
      instructionContext: { versionId: 'missing-context-version', fragmentIds: ['missing-fragment'] },
    },
    skillVerification: { versionId: 'missing-skill-version' },
    responseMetadata: { contextFragmentIds: ['missing-context-fragment'] },
    processControlHistory: [{ relatedRunId: 'missing-run' }],
    prompt: 'Do not rewrite missing-version or missing-fragment in ordinary text.',
    sentMessages: [{ role: 'system', content: 'Keep this saved message verbatim.' }],
  }
  const prompt = input.prompt
  const sentMessages = structuredClone(input.sentMessages)
  const result = remapRunInputReferences(input, {
    versionIdMap: new Map(),
    fragmentIdMap: new Map(),
    scenarioIdMap: new Map(),
    runIdMap: new Map(),
  })

  assert.deepEqual(result.input, {
    ...input,
    taskContext: {
      sourceVersionId: 'missing-version',
      sourceScenarioId: 'missing-scenario',
      instructionContext: { sourceVersionId: 'missing-context-version', fragmentIds: ['source:missing-fragment'], sourceFragmentIds: ['missing-fragment'] },
    },
    skillVerification: { sourceVersionId: 'missing-skill-version' },
    responseMetadata: { contextFragmentIds: [], sourceContextFragmentIds: ['missing-context-fragment'] },
    processControlHistory: [{ sourceRelatedRunId: 'missing-run' }],
  })
  assert.equal(result.warnings.length, 7)
  assert.equal(result.input.prompt, prompt)
  assert.deepEqual(result.input.sentMessages, sentMessages)
})
