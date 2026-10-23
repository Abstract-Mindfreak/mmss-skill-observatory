import test from 'node:test'
import assert from 'node:assert/strict'
import { callSelectedTextBackend, resolveTextBackend } from './backend-routing.ts'

test('routes FreeLLMAPI and Ollama only to their selected clients', async () => {
  const calls = []
  const clients = {
    ollama: async () => { calls.push('ollama'); return 'local' },
    freellmapi: async () => { calls.push('freellmapi'); return 'gateway' },
  }
  assert.equal(await callSelectedTextBackend('freellmapi', clients), 'gateway')
  assert.equal(await callSelectedTextBackend('ollama', clients), 'local')
  assert.deepEqual(calls, ['freellmapi', 'ollama'])
})

test('explicit action choice wins over current project assignment', () => {
  const override = { backend: 'ollama', connectionId: 'local-2', model: 'llama3' }
  const assignment = { backend: 'freellmapi', connectionId: 'gateway-1', model: 'auto' }
  assert.deepEqual(resolveTextBackend(override, assignment), override)
})

test('uses the role assignment when there is no explicit override', () => {
  const assignment = { backend: 'freellmapi', connectionId: 'gateway-1', model: 'auto' }
  assert.deepEqual(resolveTextBackend(null, assignment), assignment)
})

test('missing assignment gives no backend, never session-cloud', () => {
  assert.equal(resolveTextBackend(null, null), null)
})

test('a selected provider error propagates without trying another client', async () => {
  const calls = []
  await assert.rejects(callSelectedTextBackend('freellmapi', {
    freellmapi: async () => { calls.push('freellmapi'); throw new Error('provider failed') },
    ollama: async () => { calls.push('ollama'); return 'fallback' },
  }), /provider failed/)
  assert.deepEqual(calls, ['freellmapi'])
})
