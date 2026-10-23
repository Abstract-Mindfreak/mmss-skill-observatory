import assert from 'node:assert/strict'
import test from 'node:test'
import { buildContourPlan, buildDecisionFlow, parseContourProposals } from './contour-planning'
test('coverage retains all fragments and avoids nested list sentence duplicate input', () => {
  const plan = buildContourPlan([
    { id: 's1', versionId: 'v', kind: 'section', path: '1', order: 1, title: 'Section', text: 'header' },
    { id: 'p1', versionId: 'v', kind: 'paragraph', path: '1.1', order: 2, title: null, text: 'container' },
    { id: 'l1', versionId: 'v', kind: 'list_item', path: '1.2', order: 3, title: null, text: 'List instruction' },
    { id: 'x1', versionId: 'v', kind: 'sentence', path: '1.2.1', order: 4, title: null, text: 'List instruction' },
    { id: 'x2', versionId: 'v', kind: 'sentence', path: '1.3', order: 5, title: null, text: 'Standalone instruction' },
  ])
  assert.equal(plan.coverage.length, 5)
  assert.equal(plan.selectedFragmentCount, 2)
  assert.equal(plan.coverage.find((item) => item.fragmentId === 'x1')?.linkedFragmentId, 'l1')
  assert.deepEqual(plan.blocks.flatMap((block) => block.fragmentIds), ['l1', 'x2'])
})

test('block construction is deterministic and obeys size/count bounds', () => {
  const items = Array.from({ length: 9 }, (_, index) => ({ id: `f${index}`, versionId: 'v', kind: 'sentence', path: `1.${index}`, order: index, title: null, text: `text-${index}` }))
  const first = buildContourPlan(items, { maxItems: 3, maxChars: 200 })
  const second = buildContourPlan(items, { maxItems: 3, maxChars: 200 })
  assert.deepEqual(first.blocks.map((block) => block.id), second.blocks.map((block) => block.id))
  assert.ok(first.blocks.every((block) => block.fragmentIds.length <= 3))
})

test('proposal parser accepts only known fragment ids and relation types', () => {
  const parsed = parseContourProposals({ positions: [
    { title: 'T', purpose: 'P', regulatedDecision: 'D', conditions: 'C', expectedBehavior: 'E', fragmentIds: ['f1', 'bad'] },
    { title: 'no source', purpose: 'P', regulatedDecision: 'D', conditions: 'C', expectedBehavior: 'E', fragmentIds: ['bad'] },
  ], relations: [
    { sourceTitle: 'A', targetTitle: 'B', kind: 'limits', rationale: 'reason' },
    { sourceTitle: 'A', targetTitle: 'B', kind: 'invented', rationale: 'bad' },
  ] }, new Set(['f1']))
  assert.equal(parsed.positions.length, 1)
  assert.deepEqual(parsed.positions[0].fragmentIds, ['f1'])
  assert.equal(parsed.relations.length, 1)
})

test('decision flow remains proposed, source-linked and explicitly non-executable', () => {
  const flow = buildDecisionFlow('Исторические сообщения отсутствуют; требуется честный отчёт', [{ id: 'p1', title: 'Record material gaps', purpose: 'Фиксировать существенные пробелы', regulatedDecision: 'Ограничить выводы доступными данными', conditions: 'Исторические сообщения недоступны', expectedBehavior: 'Указать ограничение', limitations: 'Не устанавливает полноту архивной истории', fragmentIds: ['f1'] }])
  assert.equal(flow.status, 'proposed')
  assert.match(flow.id, /^decision-flow-/)
  assert.equal(flow.executed, false)
  assert.equal(flow.nodes[0].positionId, 'p1')
  assert.deepEqual(flow.nodes[0].sourceFragmentIds, ['f1'])
  assert.equal(flow.nodes[0].allowedResult, null)
})
