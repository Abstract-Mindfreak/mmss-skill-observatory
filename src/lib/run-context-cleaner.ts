import type { RunDTO } from '@/lib/types'
import { createHash } from 'crypto'

/** Redact only exact instruction text in exported copies; retain task material and history. */
export function cleanRunSkillText(run: RunDTO, includeFullSkillText: boolean, knownVersionContent?: string): RunDTO {
  if (includeFullSkillText || !run.input) return run
  const input = { ...run.input }
  const context = input.contextProvenance
  const savedSkillText = typeof input.skillText === 'string' ? input.skillText : undefined
  const redactedMode = context?.mode
    ?? (input.skillContextMode === 'full' ? 'full' : input.skillContextMode === 'relevant' ? 'selected' : 'unknown')
  const systemIndex = input.sentMessages?.findIndex((message) => message.role === 'system') ?? -1
  const systemContent = systemIndex >= 0 ? input.sentMessages?.[systemIndex].content : undefined
  let instructionText = redactedMode === 'full'
    ? savedSkillText ?? systemContent?.match(/=== ДОПОЛНИТЕЛЬНЫЙ КОНТЕКСТ ИНСТРУКЦИИ[^\n]* ===\n([\s\S]*)$/)?.[1]
    : redactedMode === 'selected' && (context?.sentContextChars ?? 0) > 0
      ? systemContent?.match(/=== ДОПОЛНИТЕЛЬНЫЙ КОНТЕКСТ ИНСТРУКЦИИ[^\n]* ===\n([\s\S]*)$/)?.[1]
      : savedSkillText
  // Legacy full-context runs may lack contextProvenance and skillText. Redact
  // only when the system message contains the exact version content verbatim.
  if (!instructionText && knownVersionContent && systemContent) {
    const marker = '=== SKILL ===\n'
    const markerIndex = systemContent.indexOf(marker)
    if (markerIndex >= 0 && systemContent.slice(markerIndex + marker.length) === knownVersionContent) {
      instructionText = knownVersionContent
    }
  }
  delete input.skillText
  if (input.sentMessages && context?.mode === 'none' && !savedSkillText) {
    input.sentMessages = input.sentMessages.map((message) => {
      if (message.role !== 'system') return message
      const marker = '=== SKILL ===\n'
      const index = message.content.indexOf(marker)
      return index < 0 ? message : { ...message, content: `${message.content.slice(0, index + marker.length)}[Дополнительный контекст отсутствует]` }
    })
  }
  if (input.sentMessages && instructionText && systemIndex >= 0) {
      const contextHash = context?.sentContextSha256
        ?? (input.skillVerification?.fullTextSha256 && redactedMode === 'full' ? input.skillVerification.fullTextSha256 : createHash('sha256').update(instructionText).digest('hex'))
      const contextChars = context?.sentContextChars ?? (input.skillVerification?.fullTextChars && redactedMode === 'full' ? input.skillVerification.fullTextChars : instructionText.length)
      const versionId = context?.versionId ?? input.responseMetadata?.contextVersionId ?? run.versionId
      const fragmentIds = context?.includedFragmentIds ?? input.responseMetadata?.contextFragmentIds ?? []
      const messages = [...input.sentMessages]
      const system = messages[systemIndex]
      const cleaned = system.content.replace(instructionText, `[Контекст инструкции опущен при экспорте; режим ${redactedMode}; версия ${versionId ?? 'неизвестна'}; фрагменты ${fragmentIds.join(', ') || '—'}; SHA-256 ${contextHash}; ${contextChars} символов]`)
      messages[systemIndex] = {
        ...system,
        content: cleaned !== system.content
          ? cleaned
          : `${system.content}\n\n[Контекст инструкции не очищен: сохранённый текст не совпал с system-сообщением; режим ${redactedMode}; исходная запись не изменена.]`,
      }
      input.sentMessages = messages
  } else if (input.sentMessages && redactedMode !== 'none' && systemIndex >= 0 && !instructionText) {
    const messages = [...input.sentMessages]
    messages[systemIndex] = { ...messages[systemIndex], content: `${messages[systemIndex].content}\n\n[Контекст инструкции не очищен: текст невозможно точно сверить; режим ${redactedMode}; исходная запись не изменена.]` }
    input.sentMessages = messages
  }
  return { ...run, input }
}
