import assert from 'node:assert/strict'
import test from 'node:test'
import { buildResearchState } from './research-state'

const base = {
  projectId: 'p', versionId: 'v1',
  positions: [{ id: 'pos1', title: 'P1', status: 'proposed', fragmentIds: ['f1'] }],
  relations: [{ id: 'rel1', sourcePositionId: 'pos1', targetPositionId: 'pos1x', status: 'proposed' }],
  scenarios: [{ id: 'sc1', title: '[VALIDATION] Case', status: 'unexplored', origin: 'user', fragmentId: 'f1' }],
  runs: [
    { id: 'run1', role: 'executor', status: 'completed', scenarioId: 'sc1', parentRunId: null, verdict: null, verdictBy: null, programChecks: [{ passed: false, status: 'failed' }] },
    { id: 'eval1', role: 'evaluator', status: 'completed', scenarioId: 'sc1', parentRunId: 'run1', verdict: 'pass', verdictBy: 'model', programChecks: [] },
  ],
  observations: [{ id: 'obs1', positionId: 'pos1', runId: 'run1', status: 'unverified' }],
  vectors: [{ representation: 'functional', positionId: 'pos1', status: 'failed', model: 'qwen3-embedding:0.6b' }],
  findings: [], discrepancies: [],
}

test('research state keeps technical checks, evaluator verdict, observation, and index distinct', () => {
  const state = buildResearchState(base)
  assert.equal(state.runs.evaluationVerdicts.pass, 1)
  assert.equal(state.runs.localCheckFailures, 1)
  assert.equal(state.observations.unverified, 1)
  assert.equal(state.index.failed, 1)
  assert.equal(state.index.missing, 0)
  assert.equal(state.positions[0].evaluations[0].verdict, 'pass')
  assert.deepEqual(state.positions[0].unverifiedObservationIds, ['obs1'])
  assert.equal(state.positions[0].index.status, 'failed')
})

test('research state only reports rows passed for its selected version and recommends without execution', () => {
  const state = buildResearchState({ ...base, scenarios: [], runs: [] })
  assert.equal(state.versionId, 'v1')
  assert.equal(state.positions[0].runIds.length, 0)
  assert.equal(state.recommendations[0].action, 'Подготовить сценарий вручную')
  assert.ok(state.recommendations.every((row) => row.limitations.length > 0))
})

test('recommendations explain five independent gaps and link to their saved records without execution', () => {
  const scenarios = [{ id: 'scenario-1', title: '[VALIDATION] case', status: 'unexplored', origin: 'user', fragmentId: 'f1' }]
  const executorOnly = [{ id: 'run-1', role: 'executor', status: 'completed', scenarioId: 'scenario-1', parentRunId: null, verdict: null, verdictBy: null, programChecks: [] }]
  const observation = [{ id: 'observation-1', positionId: 'pos1', runId: 'run-1', status: 'unverified' }]
  const discrepancy = [{ noteId: 'note-1', payload: { schema: 1 as const, type: 's2-research-discrepancy-v1' as const, assessment: 'potential-contradiction' as const, status: 'proposed' as const, criterion: 'criterion', summary: 'disagreement', runIds: ['run-1'], observationIds: ['observation-1'], positionIds: ['pos1'], fragmentIds: ['f1'], evidence: [], limitations: [], userDecision: null } }]
  const vector = [{ representation: 'functional', positionId: 'pos1', status: 'stale', model: 'model' }]
  const noExecution = buildResearchState({ ...base, scenarios, runs: [], observations: [], discrepancies: [], vectors: [{ ...vector[0], status: 'ready' }] })
  assert.equal(noExecution.recommendations.find((item) => item.key === 'run:pos1')?.target?.id, 'scenario-1')
  const noEvaluation = buildResearchState({ ...base, scenarios, runs: executorOnly, observations: [], discrepancies: [], vectors: [{ ...vector[0], status: 'ready' }] })
  assert.equal(noEvaluation.recommendations.find((item) => item.key === 'evaluation:pos1')?.target?.id, 'run-1')
  const allGaps = buildResearchState({ ...base, scenarios, runs: executorOnly, observations: [{ ...observation[0] }], discrepancies: [...discrepancy], vectors: [...vector] })
  assert.equal(allGaps.recommendations.find((item) => item.key === 'observation:pos1')?.target?.id, 'observation-1')
  const discrepancyRecommendation = allGaps.recommendations.find((item) => item.key === 'discrepancy:pos1')
  assert.equal(discrepancyRecommendation?.target?.id, 'note-1')
  assert.match(discrepancyRecommendation?.rationale ?? '', /не выбирает заранее одну сторону/)
  assert.equal(allGaps.recommendations.find((item) => item.key === 'index:pos1')?.target?.id, 'pos1')
  const noGaps = buildResearchState({ ...base, positions: [{ ...base.positions[0], status: 'accepted' }], scenarios: base.scenarios, runs: base.runs, observations: [{ ...observation[0], status: 'supported' }], discrepancies: [], vectors: [{ ...vector[0], status: 'ready' }] })
  assert.deepEqual(noGaps.recommendations, [])
})
