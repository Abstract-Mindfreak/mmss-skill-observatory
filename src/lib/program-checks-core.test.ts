import assert from 'node:assert/strict'
import test from 'node:test'
import { findNonFiniteJsonLiteral, findDuplicateJsonKeys, inspectDuplicateKeys } from './program-checks-core'

test('NaN and Infinity text inside JSON strings are not treated as literals', () => {
  assert.equal(findNonFiniteJsonLiteral('{"note":"NaN Infinity -Infinity"}'), null)
  assert.equal(findNonFiniteJsonLiteral('{"value":NaN}'), 'NaN')
  assert.equal(findNonFiniteJsonLiteral('{"value":-Infinity}'), '-Infinity')
})

test('duplicate key scan distinguishes repeated keys and damaged JSON', () => {
  assert.deepEqual(findDuplicateJsonKeys('{"a":1,"nested":{"b":1,"b":2}}'), ['b'])
  assert.deepEqual(inspectDuplicateKeys('{"a":}', false), {
    passed: false, status: 'unverified', duplicates: [],
    detail: 'Проверка дубликатов не завершена: JSON повреждён, результат неопределён',
  })
  assert.equal(inspectDuplicateKeys('{"a":1,"a":2}', true).status, 'failed')
})
