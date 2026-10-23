import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cleanRunSkillText } from './run-context-cleaner.ts'

const versionText = 'Instruction version with source text.'
const hash = createHash('sha256').update(versionText).digest('hex')
const systemMessage = (text) => ({ role: 'system', content: `Executor setup\n=== SKILL ===\n${text}` })

test('redacts legacy full-context runs using the saved explicit mode', () => {
  const run = {
    id: 'run-1', versionId: 'version-1',
    input: {
      skillContextMode: 'full', skillText: versionText,
      sentMessages: [systemMessage(versionText), { role: 'user', content: 'Keep this request.' }],
    },
  }
  const cleaned = cleanRunSkillText(run, false)
  assert.equal(cleaned.input.skillText, undefined)
  assert.match(cleaned.input.sentMessages[0].content, /режим full/)
  assert.match(cleaned.input.sentMessages[0].content, new RegExp(hash))
  assert.doesNotMatch(cleaned.input.sentMessages[0].content, /Instruction version with source text/)
  assert.equal(cleaned.input.sentMessages[1].content, 'Keep this request.')
})

test('redacts only an exact legacy version match and keeps unknown mode unknown', () => {
  const run = {
    id: 'run-2', versionId: 'version-1',
    input: { sentMessages: [systemMessage(versionText), { role: 'user', content: 'Keep this request.' }] },
  }
  const cleaned = cleanRunSkillText(run, false, versionText)
  assert.match(cleaned.input.sentMessages[0].content, /режим unknown/)
  assert.match(cleaned.input.sentMessages[0].content, /версия version-1/)
  assert.match(cleaned.input.sentMessages[0].content, new RegExp(hash))
  assert.doesNotMatch(cleaned.input.sentMessages[0].content, /Instruction version with source text/)
  assert.equal(cleaned.input.sentMessages[1].content, 'Keep this request.')
})

test('retains the full instruction when the export option includes it', () => {
  const run = { id: 'run-3', input: { skillText: versionText, sentMessages: [systemMessage(versionText)] } }
  assert.equal(cleanRunSkillText(run, true), run)
})
