import assert from 'node:assert/strict'
import test from 'node:test'
import {
  campaignVersionState,
  campaignFailureAction,
  campaignRunRecovery,
  deriveCampaignConclusion,
  importedCampaignState,
  isQuotaOrRateLimitError,
  isSourceQuoteVerified,
  isTemporaryProviderError,
  validateCampaignPolicy,
  type CampaignEvidenceState,
  type CampaignPolicyInput,
} from './research-campaign-core'

const policy: CampaignPolicyInput = {
  depth: 'full', maxScenariosPerPosition: 2, maxModelActions: 20,
  maxAdditionalChecksPerPosition: 1, maxRetriesPerAction: 3, maxConcurrent: 1,
  stopOnQuota: true, stopOnTechnicalError: false, allowRewriteExperiment: false,
}

const evidence: CampaignEvidenceState = {
  status: 'completed', depth: 'full',
  stageStatuses: { interpretation: 'supported', interaction: 'compatible', scenarios: 'completed', evaluations: ['pass'] },
  verifiedSourceEvidence: false, challengerConfirmsConcern: false, blockedByQuota: false, exhaustedBudget: false,
  hasUnmappedSourceContent: false, hasConflictingObservation: false,
}

test('campaign policy accepts bounded values above 20 and explicit unlimited mode', () => {
  assert.deepEqual(validateCampaignPolicy(policy), [])
  assert.deepEqual(validateCampaignPolicy({ ...policy, maxModelActions: 21 }), [])
  assert.deepEqual(validateCampaignPolicy({ ...policy, maxModelActions: Number.MAX_SAFE_INTEGER }), [])
  assert.deepEqual(validateCampaignPolicy({ ...policy, maxModelActions: null }), [])
  assert.ok(validateCampaignPolicy({ ...policy, maxModelActions: 0 }).length > 0)
  assert.ok(validateCampaignPolicy({ ...policy, maxModelActions: Number.MAX_SAFE_INTEGER + 1 }).length > 0)
  assert.ok(validateCampaignPolicy({ ...policy, maxConcurrent: 2 }).length > 0)
})

test('campaign conclusion limits clean results to checked cases and treats conflicting observations as insufficient', () => {
  assert.equal(deriveCampaignConclusion(evidence).conclusion, 'no-issue-in-checked-cases')
  assert.equal(deriveCampaignConclusion({ ...evidence, hasConflictingObservation: true }).conclusion, 'insufficient-data')
})

test('campaign concern requires verified source evidence and challenger confirmation', () => {
  const concern = { ...evidence, stageStatuses: { ...evidence.stageStatuses, interpretation: 'concern' as const } }
  assert.equal(deriveCampaignConclusion(concern).conclusion, 'insufficient-data')
  assert.equal(deriveCampaignConclusion({ ...concern, verifiedSourceEvidence: true, challengerConfirmsConcern: true }).conclusion, 'likely-revision')
})

test('campaign stops distinguish blocked, cancelled, running and prepared states', () => {
  assert.equal(deriveCampaignConclusion({ ...evidence, status: 'blocked' }).conclusion, 'blocked')
  assert.equal(deriveCampaignConclusion({ ...evidence, status: 'cancelled' }).conclusion, 'insufficient-data')
  assert.equal(deriveCampaignConclusion({ ...evidence, status: 'running' }).conclusion, 'in-progress')
  assert.equal(deriveCampaignConclusion({ ...evidence, status: 'prepared' }).conclusion, 'not-explored')
})

test('campaign failure classification distinguishes quota from retryable temporary errors', () => {
  assert.equal(isQuotaOrRateLimitError('FreeLLMAPI daily quota exceeded'), true)
  assert.equal(isTemporaryProviderError('socket timeout'), true)
  assert.equal(isTemporaryProviderError('Истекло время ожидания ответа FreeLLMAPI'), true)
  assert.equal(isTemporaryProviderError('HTTP 502 upstream failure'), true)
  assert.equal(isTemporaryProviderError('invalid prompt'), false)
  assert.equal(isTemporaryProviderError('Запрос отменён'), false)
  assert.equal(isTemporaryProviderError('ECONNREFUSED 127.0.0.1:11434'), false)
  assert.equal(isTemporaryProviderError('Connection refused'), false)
  assert.equal(isTemporaryProviderError('network configuration is invalid'), false)
  assert.equal(campaignFailureAction('socket timeout', 1, 3), 'retry')
  assert.equal(campaignFailureAction('FreeLLMAPI rate_limited', 1, 3), 'pause-for-quota')
  assert.equal(campaignFailureAction('invalid prompt', 1, 3), 'inconclusive')
  assert.equal(campaignFailureAction('Истекло время ожидания ответа', 1, 3, 'cancelled'), 'inconclusive')
  assert.equal(campaignFailureAction('socket timeout', 3, 3), 'inconclusive')
})

test('campaign source quotes must match included text and have meaningful length', () => {
  assert.equal(isSourceQuoteVerified('The assistant must preserve the historical messages.', 'preserve the historical messages'), true)
  assert.equal(isSourceQuoteVerified('The assistant must preserve the historical messages.', 'assistant may guess'), false)
})

test('campaign detects stale instruction snapshots and blocks unresolved imported work', () => {
  assert.equal(campaignVersionState('same', 'same'), 'current')
  assert.equal(campaignVersionState('old', 'new'), 'stale')
  assert.equal(importedCampaignState('running', false), 'blocked-reconciliation')
  assert.equal(importedCampaignState('paused', true), 'blocked-reconciliation')
  assert.equal(importedCampaignState('completed', false), 'ready')
})

test('campaign recovery reuses queued and running Runs instead of creating duplicates', () => {
  assert.equal(campaignRunRecovery(null), 'create-new')
  assert.equal(campaignRunRecovery('queued'), 'execute-existing')
  assert.equal(campaignRunRecovery('running'), 'wait-existing')
  assert.equal(campaignRunRecovery('completed'), 'use-existing-result')
  assert.equal(campaignRunRecovery('failed'), 'inspect-failure')
  assert.equal(campaignRunRecovery('cancelled'), 'inspect-failure')
})

test('ambiguous checks, exhausted budget and non-full depths never yield a clean conclusion', () => {
  assert.equal(deriveCampaignConclusion({ ...evidence, stageStatuses: { ...evidence.stageStatuses, evaluations: ['inconclusive'] } }).conclusion, 'insufficient-data')
  assert.equal(deriveCampaignConclusion({ ...evidence, exhaustedBudget: true, stageStatuses: { ...evidence.stageStatuses, scenarios: 'pending' } }).conclusion, 'insufficient-data')
  assert.equal(deriveCampaignConclusion({ ...evidence, depth: 'interpretation' }).conclusion, 'insufficient-data')
})
