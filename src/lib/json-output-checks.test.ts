import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectJsonOutputScopes } from './json-output-checks'

test('distinguishes raw JSON from valid JSON after explicitly stripping markdown fences', () => {
  const result = inspectJsonOutputScopes('```json\n{"ok":true}\n```')
  assert.equal(result.rawValid, false)
  assert.equal(result.normalizedValid, true)
  assert.equal(result.normalizedText, '{"ok":true}')
})

test('accepts raw JSON in both scopes and rejects malformed normalized content', () => {
  const raw = inspectJsonOutputScopes('{"ok":true}')
  assert.equal(raw.rawValid, true)
  assert.equal(raw.normalizedValid, true)
  const malformed = inspectJsonOutputScopes('```json\n{"ok":}\n```')
  assert.equal(malformed.rawValid, false)
  assert.equal(malformed.normalizedValid, false)
})
