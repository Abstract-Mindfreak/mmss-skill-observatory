import assert from 'node:assert/strict'
import test from 'node:test'
import { appendUserDecisionHistory } from './user-decision-history'

test('user decisions retain each status transition, basis, actor type, and timestamp across reloads', () => {
  const first = appendUserDecisionHistory({ id: 'position-1', status: 'proposed' }, 'proposed', 'accepted', 'Сверено с источником', '2026-10-22T09:00:00.000Z')
  const second = appendUserDecisionHistory(first, 'accepted', 'disputed', 'Найдено противоречащее основание', '2026-10-22T09:05:00.000Z')
  const restored = JSON.parse(JSON.stringify(second))
  assert.equal(restored.status, 'disputed')
  assert.deepEqual(restored.decisionHistory, [
    { previousStatus: 'proposed', newStatus: 'accepted', basis: 'Сверено с источником', decidedAt: '2026-10-22T09:00:00.000Z', actorType: 'user' },
    { previousStatus: 'accepted', newStatus: 'disputed', basis: 'Найдено противоречащее основание', decidedAt: '2026-10-22T09:05:00.000Z', actorType: 'user' },
  ])
})
