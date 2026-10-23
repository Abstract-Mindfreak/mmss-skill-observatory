import assert from 'node:assert/strict'
import test from 'node:test'
import { makeResearchDiscrepancy, remapResearchDiscrepancyIds } from './research-discrepancy'

test('discrepancy identifiers remap to imported records and preserve missing history explicitly', () => {
  const payload = makeResearchDiscrepancy({
    assessment: 'potential-contradiction', criterion: 'C', summary: 'S', runIds: ['run-a', 'run-old'],
    observationIds: ['obs-a'], positionIds: ['position-a'], fragmentIds: ['fragment-a', 'fragment-old'],
    evidence: [{ kind: 'run-output', id: 'run-a', label: 'Output' }, { kind: 'fragment', id: 'fragment-old', path: '6.2', label: 'Source' }], limitations: [],
  })
  const mapped = remapResearchDiscrepancyIds(payload, {
    run: new Map([['run-a', 'run-new']]), observation: new Map([['obs-a', 'obs-new']]),
    position: new Map([['position-a', 'position-new']]), fragment: new Map([['fragment-a', 'fragment-new']]), scenario: new Map(),
  })
  assert.deepEqual(mapped.runIds, ['run-new'])
  assert.deepEqual(mapped.sourceRunIds, ['run-old'])
  assert.deepEqual(mapped.observationIds, ['obs-new'])
  assert.deepEqual(mapped.positionIds, ['position-new'])
  assert.deepEqual(mapped.fragmentIds, ['fragment-new'])
  assert.deepEqual(mapped.sourceFragmentIds, ['fragment-old'])
  assert.equal(mapped.evidence[0].id, 'run-new')
  assert.equal(mapped.evidence[1].sourceId, 'fragment-old')
})
