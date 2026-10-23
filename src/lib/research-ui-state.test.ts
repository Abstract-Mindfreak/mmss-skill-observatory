import assert from 'node:assert/strict'
import test from 'node:test'
import { campaignRequiredStages, campaignResumeBlock, classifyResearchStop, requiredStagesCompletion } from './research-ui-state'

test('stop causes stay distinct and ambiguous provider blocks stay unknown', () => {
  assert.equal(classifyResearchStop('policy-budget-exhausted', 'max reached'), 'policy-budget-exhausted')
  assert.equal(classifyResearchStop('provider-quota', 'HTTP 429 rate_limit'), 'provider-quota')
  assert.equal(classifyResearchStop('technical-error', 'socket timeout'), 'temporary-upstream-error')
  assert.equal(classifyResearchStop('technical-error', 'ECONNREFUSED 127.0.0.1:11434'), 'application-error')
  assert.equal(classifyResearchStop('import-reconciliation', 'pending run'), 'imported-needs-reconciliation')
  assert.equal(classifyResearchStop('technical-error', 'invalid state'), 'application-error')
  assert.equal(classifyResearchStop('user-paused', null), 'user-pause')
  assert.equal(classifyResearchStop('provider-quota', 'connection is unavailable'), 'unknown')
})

test('resume eligibility checks version, budget, reconciliation and retry bounds', () => {
  const base = { status: 'paused', pauseReason: 'user-paused', versionState: 'current', modelActionsUsed: 1, maxModelActions: 5, maxRetriesPerAction: 3 }
  assert.equal(campaignResumeBlock(base), null)
  assert.match(campaignResumeBlock({ ...base, pauseReason: 'policy-budget-exhausted', modelActionsUsed: 5 }) ?? '', /Предел текстовых действий/i)
  assert.match(campaignResumeBlock({ ...base, versionState: 'stale' }) ?? '', /Версия кампании изменилась/)
  assert.match(campaignResumeBlock({ ...base, pauseReason: 'import-reconciliation' }) ?? '', /сверки/)
  assert.match(campaignResumeBlock({ ...base, latestFailedAttempt: 3 }) ?? '', /попыток/i)
  assert.match(campaignResumeBlock({ ...base, modelActionsUsed: 5 }) ?? '', /Предел текстовых действий/)
})

test('budget extension must be explicit and does not reset used actions', () => {
  const exhausted = { status: 'paused', pauseReason: 'policy-budget-exhausted', versionState: 'current', modelActionsUsed: 20, maxModelActions: 20, maxRetriesPerAction: 3 }
  assert.match(campaignResumeBlock(exhausted) ?? '', /Предел текстовых действий/i)
  assert.equal(campaignResumeBlock({ ...exhausted, maxModelActions: 21 }), null)
  assert.equal(campaignResumeBlock({ ...exhausted, maxModelActions: null }), null)
  assert.match(campaignResumeBlock({ ...exhausted, maxModelActions: 19 }) ?? '', /Предел текстовых действий/i)
})

test('required check completion is distinct from queue completion', () => {
  const item = { interpretationStatus: 'supported', interactionStatus: 'compatible', scenarioStatus: 'completed', executionStatus: 'pending' }
  const full = campaignRequiredStages('full', item)
  assert.equal(full.length, 4)
  assert.equal(requiredStagesCompletion(full), 'incomplete')
  assert.equal(requiredStagesCompletion(campaignRequiredStages('interactions', item)), 'complete')
})
