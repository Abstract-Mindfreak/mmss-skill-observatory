import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const runTs = (expression) => {
  const roleMessages = readFileSync('src/lib/role-messages.ts', 'utf8').replace(/^import .*\n/gm, '').replace(/export type ModelMessage[^\n]*\n/, '').replace(/\): ModelMessage\[\]\s*\{/g, ') {').replace(/: InstructionContextProvenance/g, '').replace(/baseMessages: ModelMessage\[\]/g, 'baseMessages').replace(/history: \{ role: 'user' \| 'assistant'; content: string \}\[\]/g, 'history').replace('export function buildRoleMessages', 'function buildRoleMessages').replace('export function withAssistantHistory', 'function withAssistantHistory')
  const rolePrompts = readFileSync('src/lib/role-prompts.ts', 'utf8').replace(/^import .*\n/gm, '').replace(/export interface RolePromptContext \{[\s\S]*?\n\}/, '').replace(/export interface BuiltPrompt \{[\s\S]*?\n\}/, '').replace(/export function buildRolePrompt\(role: RoleId, ctx: RolePromptContext\): BuiltPrompt/, 'function buildRolePrompt(role, ctx)')
  const source = `\n${rolePrompts}\n${roleMessages}`.replace(/:\s*(RoleId|RolePromptContext|BuiltPrompt|string|unknown|boolean|number|void)(\[\])?/g, '').replace(/\):\s*(string)/g, ')').replace(/\{ role: 'system' \| 'user' \| 'assistant'; content \}/g, '').replace(/\): ModelMessage\[\]/g, ')') + `\n${expression}`
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', source], { cwd: process.cwd(), encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return JSON.parse(result.stdout.trim())
}

const roles = ['executor', 'explorer', 'evaluator', 'challenger', 'editor', 'assistant', 'interpreter']
const none = { mode: 'none', versionId: 'v1', versionLabel: null, fullVersionSha256: null, fullVersionChars: null, selectedFragmentIds: [], includedFragmentIds: [], sentContextSha256: null, sentContextChars: 0, text: '' }

test('all seven text roles retain their role task material with no supplemental instruction', () => {
  const contexts = {
    executor: { task: 'task' }, explorer: { scenario: { title: 'scenario' }, fragmentText: 'source' },
    evaluator: { task: 'task', criterion: 'all criteria', outputToEvaluate: 'entire output' },
    challenger: { task: 'refute' }, editor: { task: 'edit', fragmentText: 'editable text' },
    assistant: { task: 'question', history: [{ role: 'user', content: 'earlier' }] }, interpreter: { focus: 'meaning', fragmentText: 'required fragment' },
  }
  for (const role of roles) {
    const messages = runTs(`console.log(JSON.stringify(buildRoleMessages(${JSON.stringify(role)}, ${JSON.stringify(contexts[role])}, ${JSON.stringify(none)})))`)
    assert.equal(messages.length, 2)
    assert.doesNotMatch(messages[0].content, /secret instruction/)
    if (role === 'evaluator') { assert.match(messages[1].content, /all criteria/); assert.match(messages[1].content, /entire output/) }
    if (role === 'explorer') assert.match(messages[1].content, /scenario/)
    if (role === 'challenger') assert.match(messages[1].content, /refute/)
    if (role === 'editor') assert.match(messages[1].content, /editable text/)
    if (role === 'assistant') assert.match(messages[1].content, /question/)
    if (role === 'interpreter') assert.match(messages[1].content, /required fragment/)
  }
})

test('full and selected context append exact text and none appends nothing', () => {
  const text = 'selected only'
  const messages = runTs(`const text = ${JSON.stringify(text)}; const selected = { ...${JSON.stringify(none)}, mode: 'selected', text, sentContextChars: text.length, sentContextSha256: 'hash', includedFragmentIds: ['f1'] }; console.log(JSON.stringify(buildRoleMessages('assistant', { task: 'question' }, selected)))`)
  assert.match(messages[0].content, /selected only/)
  assert.match(messages[0].content, /версия v1/)
  assert.equal(messages[1].content, 'question')
  const full = runTs(`const full = { ...${JSON.stringify(none)}, mode: 'full', text: 'whole version' }; console.log(JSON.stringify(buildRoleMessages('assistant', { task: 'question' }, full)))`)
  assert.match(full[0].content, /whole version/)
  const without = runTs(`console.log(JSON.stringify(buildRoleMessages('assistant', { task: 'question' }, ${JSON.stringify(none)})))`)
  assert.doesNotMatch(without[0].content, /ДОПОЛНИТЕЛЬНЫЙ КОНТЕКСТ ИНСТРУКЦИИ/)
})

test('selection validation enforces three modes and fragment IDs', () => {
  const source = readFileSync('src/lib/instruction-context.ts', 'utf8')
  assert.match(source, /mode !== 'none' && mode !== 'selected' && mode !== 'full'/)
  assert.match(source, /ids\.length !== value\.fragmentIds\.length/)
  assert.match(source, /where: \{ id: \{ in: requestedIds \}, versionId \}/)
})
