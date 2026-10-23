import type { RoleId } from '@/lib/types'
import { buildRolePrompt, type RolePromptContext } from '@/lib/role-prompts'
import type { InstructionContextProvenance } from '@/lib/instruction-context'

export type ModelMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export function buildRoleMessages(
  role: RoleId,
  context: RolePromptContext,
  instruction: InstructionContextProvenance
): ModelMessage[] {
  const promptContext: RolePromptContext = { ...context }
  if (role === 'executor') {
    promptContext.skillText = instruction.mode === 'none' ? '' : instruction.text
    promptContext.sectionText = undefined
  }
  const prompt = buildRolePrompt(role, promptContext)
  const supplemental = role !== 'executor' && instruction.mode !== 'none'
    ? `\n\n=== ДОПОЛНИТЕЛЬНЫЙ КОНТЕКСТ ИНСТРУКЦИИ · ${instruction.mode === 'full' ? 'ПОЛНАЯ ВЕРСИЯ' : 'ВЫБРАННЫЕ ФРАГМЕНТЫ'} · версия ${instruction.versionId ?? 'не указана'} · размер ${instruction.sentContextChars} символов · SHA-256 ${instruction.sentContextSha256 ?? 'неизвестен'} ===\n${instruction.text}`
    : ''
  return [
    { role: 'system', content: `${prompt.system}${supplemental}` },
    { role: 'user', content: prompt.user },
  ]
}

export function withAssistantHistory(
  baseMessages: ModelMessage[],
  history: { role: 'user' | 'assistant'; content: string }[]
): ModelMessage[] {
  if (!history.length) return baseMessages
  return [baseMessages[0], ...history, ...baseMessages.slice(1)]
}
