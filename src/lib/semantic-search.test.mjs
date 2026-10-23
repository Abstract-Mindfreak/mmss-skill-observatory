import test from 'node:test'
import assert from 'node:assert/strict'
import { cosineSimilarity, isIndexEntryCompatible, isIndexEntryCurrent, parseVector } from './semantic-search.ts'

test('cosine similarity ranks vectors and rejects incompatible dimensions', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1)
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0)
  assert.equal(cosineSimilarity([1], [1, 0]), null)
  assert.equal(cosineSimilarity([Number.NaN], [1]), null)
})

test('vector parsing rejects malformed and non-finite values', () => {
  assert.deepEqual(parseVector('[1,2]'), [1, 2])
  assert.equal(parseVector('[1,"2"]'), null)
  assert.equal(parseVector('[1,1e999]'), null)
  assert.equal(parseVector('broken'), null)
})

test('cache entry is current only for exact model, format, text hash and ready state', () => {
  const ready = { status: 'ready', model: 'qwen3-embedding:0.6b', formatVersion: 1, textHash: 'abc' }
  assert.equal(isIndexEntryCurrent(ready, 'qwen3-embedding:0.6b', 1, 'abc'), true)
  assert.equal(isIndexEntryCurrent(ready, 'qwen3-embedding:4b', 1, 'abc'), false)
  assert.equal(isIndexEntryCurrent(ready, 'qwen3-embedding:0.6b', 2, 'abc'), false)
  assert.equal(isIndexEntryCurrent(ready, 'qwen3-embedding:0.6b', 1, 'changed'), false)
  assert.equal(isIndexEntryCurrent({ ...ready, status: 'stale' }, 'qwen3-embedding:0.6b', 1, 'abc'), false)
  const sized = { ...ready, dimensions: 2 }
  assert.equal(isIndexEntryCompatible(sized, 'qwen3-embedding:0.6b', 1, 'abc', 2, 2), true)
  assert.equal(isIndexEntryCompatible(sized, 'qwen3-embedding:0.6b', 1, 'changed', 2, 2), false)
  assert.equal(isIndexEntryCompatible(sized, 'qwen3-embedding:0.6b', 1, 'abc', 2, 3), false)
})
