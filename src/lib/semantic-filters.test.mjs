import test from 'node:test'
import assert from 'node:assert/strict'
import { hasDiagnosticMarker, isDiagnosticObservation } from './semantic-filters.ts'

test('recognizes diagnostic markers in serialized Run input or output', () => {
  assert.equal(hasDiagnosticMarker('{"task":"[SMOKE] replay"}'), true)
  assert.equal(isDiagnosticObservation({ run: { input: '{}', output: 'result [DIAGNOSTIC]' } }), true)
})

test('recognizes diagnostic Notes and ordinary research evidence separately', () => {
  assert.equal(isDiagnosticObservation({ note: { body: 'ordinary note', kind: 'research', origin: 'user' } }), false)
  assert.equal(isDiagnosticObservation({ note: { body: 'fixture', kind: '[SMOKE] note', origin: 'user' } }), true)
})
