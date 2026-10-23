import { createHash } from 'node:crypto'

export type SkillContextVerification = {
  versionId: string | null
  fullTextSha256: string | null
  fullTextChars: number | null
  mode: 'full' | 'relevant' | 'unknown'
  status: 'matches' | 'mismatch' | 'unverified'
  detail: string
}

export function skillContextVerification(
  version: { id: string; content: string } | null,
  skillText: string | undefined,
  mode: 'full' | 'relevant' | undefined,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
): SkillContextVerification {
  const system = messages.find((message) => message.role === 'system')?.content
  const marker = '=== SKILL ===\n'
  const markerIndex = system?.indexOf(marker) ?? -1
  const includedSkill = markerIndex < 0 ? null : system!.slice(markerIndex + marker.length)
  const verificationMode = mode ?? 'unknown'
  let status: SkillContextVerification['status'] = 'unverified'
  let detail = 'Сохранённый и отправленный текст невозможно сопоставить.'

  if (skillText !== undefined && includedSkill !== null) {
    if (verificationMode === 'full' && version) {
      status = skillText === includedSkill && skillText === version.content ? 'matches' : 'mismatch'
      detail = status === 'matches'
        ? 'Полный сохранённый текст совпадает с текстом system-сообщения и версией в базе.'
        : 'Полный сохранённый текст отличается от system-сообщения или версии в базе.'
    } else if (verificationMode === 'relevant') {
      status = skillText === includedSkill ? 'matches' : 'mismatch'
      detail = status === 'matches'
        ? 'Сохранённый сокращённый контекст совпадает с system-сообщением; совпадение с полной версией не заявляется.'
        : 'Сохранённый сокращённый контекст отличается от system-сообщения; полная версия не проверена.'
    }
  }

  return {
    versionId: version?.id ?? null,
    fullTextSha256: version ? createHash('sha256').update(version.content, 'utf8').digest('hex') : null,
    fullTextChars: version?.content.length ?? null,
    mode: verificationMode,
    status,
    detail,
  }
}
