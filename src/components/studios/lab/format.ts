// Behavior Lab — форматирование, JSON-превращения и markdown-карточка
// запуска. Pure helpers, no React. Owned by agent 3-c.
import type { RunDTO, RunStatus, Verdict, VerdictBy } from '@/lib/types'
import { ROLE_TITLES } from '@/lib/types'
import { cleanRunSkillText } from '@/lib/run-context-cleaner'

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  planned: 'Запланирован',
  queued: 'В очереди',
  running: 'Выполняется',
  completed: 'Завершён',
  cancelled: 'Отменён',
  failed: 'Ошибка',
}

const VERDICT_LABELS: Record<Verdict, string> = {
  pass: 'Пройдено',
  fail: 'Не пройдено',
  inconclusive: 'Неоднозначно',
}

export const VERDICT_SHORT: Record<Verdict, string> = {
  pass: 'пройдено',
  fail: 'не пройдено',
  inconclusive: 'неоднозначно',
}

export function verdictLabel(v: Verdict): string {
  return VERDICT_LABELS[v]
}

export function byLabel(by: VerdictBy | null): string {
  if (by === 'user') return 'вердикт пользователя'
  if (by === 'program') return 'программная проверка'
  if (by === 'model') return 'вердикт модели'
  return 'вердикт не установлен'
}

/** 'Executor' / 'Explorer' … (short role name). */
export function roleShort(role: RunDTO['role']): string {
  return ROLE_TITLES[role].split(' — ')[0]
}

/** 'session-cloud' | 'DEMO' | 'ollama:Name · model'. */
export function backendModelLabel(run: Pick<RunDTO, 'backend' | 'connectionName' | 'model'>): string {
  if (run.backend === 'session-cloud') return run.model ? `session-cloud · ${run.model}` : 'session-cloud'
  if (run.backend === 'demo') return 'DEMO (синтетический)'
  return `${run.backend} · подключение «${run.connectionName ?? '—'}» · запрошенная модель ${run.model ?? 'не указана'}`
}

function reported(value: string | null | undefined): string {
  return value?.trim() || 'не сообщено'
}

function skillCheckLabel(status: 'matches' | 'mismatch' | 'unverified'): string {
  if (status === 'matches') return 'совпадает'
  if (status === 'mismatch') return 'не совпадает'
  return 'не проверено'
}

function cleanedSentMessages(run: RunDTO): string[] {
  const input = cleanRunSkillText(run, false).input
  if (!input?.sentMessages?.length) return ['не сохранены']
  return input.sentMessages.map((message) => `${message.role}: ${message.content}`)
}

/** Chat-ready report; only this generated text omits the saved skill body. */
export function runChatReportMarkdown(run: RunDTO): string {
  const input = run.input
  const verification = input?.skillVerification
  const out = [
    `## Запуск ${run.id}`,
    `- Время: ${fmtTime(run.createdAt)}`,
    `- Тип подключения: ${run.backend}`,
    `- Подключение: ${reported(run.connectionName)}`,
    `- Запрошенная модель: ${reported(run.model)}`,
    `- Фактический провайдер: ${reported(input?.responseMetadata?.actualProvider)}`,
    `- Фактическая модель: ${reported(input?.responseMetadata?.actualModel)}`,
    `- Параметры: ${input ? JSON.stringify(input.settings) : 'не сообщены'}`,
    `- Длительность: ${fmtDuration(run.durationMs)}`,
    `- Usage (вход/выход): ${run.tokensIn ?? 'не сообщено'} / ${run.tokensOut ?? 'не сообщено'}`,
    '',
    '### Контекст скилла',
    `- ID версии: ${verification?.versionId ?? run.versionId ?? 'не сообщено'}`,
    `- SHA-256 полного текста: ${verification?.fullTextSha256 ?? 'не сообщено'}`,
    `- Символов в полной версии: ${verification?.fullTextChars ?? 'не сообщено'}`,
    `- Режим: ${verification?.mode === 'full' ? 'full' : verification?.mode === 'relevant' ? 'сокращённый' : 'не сообщено'}`,
    `- Сверка сохранённого и отправленного текста: ${verification ? skillCheckLabel(verification.status) : 'не проверено'}`,
    `- Результат: ${verification?.detail ?? 'данные проверки в запуске не сохранены'}`,
    input?.sentMessages ? '- Точная очищенная копия фактических сообщений показана ниже; обязательный материал, запросы и ответы сохранены.' : '- Состав отправленных сообщений неизвестен; очистка к ним не применялась.',
    '',
    '### Отправленные сообщения (инструкция очищена)',
    ...cleanedSentMessages(run).map((message) => `- ${message}`),
    '',
    '### Пользовательский запрос',
    input?.prompt ?? 'не сохранён',
    '',
    '### Полный ответ модели',
    run.output ?? 'ответ отсутствует',
    '',
    '### Локальные проверки',
    ...(run.programChecks.length
      ? run.programChecks.map((check) => `- ${check.status === 'unverified' ? 'НЕ ПРОВЕРЕНО' : check.passed ? 'PASS' : 'FAIL'} · ${check.name} — ${check.detail}`)
      : ['- не сохранены']),
    '',
    '### Вердикт и оценка',
    `- Вердикт: ${run.verdict ? `${VERDICT_LABELS[run.verdict]} (${byLabel(run.verdictBy)})` : 'не установлен'}`,
    `- Вердикт модели: ${run.modelVerdict ? VERDICT_LABELS[run.modelVerdict] : 'не сообщён'}`,
    `- Статус запуска: ${RUN_STATUS_LABELS[run.status]}${run.error ? ` — ${run.error}` : ''}`,
  ]
  return out.join('\n')
}

export function fmtDuration(ms: number | null): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)} мс`
  return `${(ms / 1000).toFixed(1)} с`
}

export function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return iso
  }
}

/** Strip ```json fences around a payload. */
function stripFences(text: string): string {
  const t = text.trim()
  const m = /^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/.exec(t)
  return m ? m[1] : t
}

function firstBalancedObject(text: string): string | null {
  let depth = 0
  let start = -1
  let inString = false
  let escape = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (inString) {
      if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1)
      }
    }
  }
  return null
}

/**
 * Try to present a model output as pretty JSON: direct parse, then
 * fence-stripped parse, then the first balanced {...} object.
 * Returns null when the text is not JSON (honest, not forced).
 */
export function tryPrettyJson(text: string | null): string | null {
  if (!text) return null
  const attempts: string[] = [text.trim(), stripFences(text)]
  const balanced = firstBalancedObject(stripFences(text))
  if (balanced) attempts.push(balanced)
  for (const a of attempts) {
    if (!a) continue
    try {
      const parsed: unknown = JSON.parse(a)
      return JSON.stringify(parsed, null, 2)
    } catch {
      /* next attempt */
    }
  }
  return null
}

function cell(v: string): string {
  return v.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

/** Markdown card of a run (role, backend, input, output, checks). */
export function runCardMarkdown(run: RunDTO): string {
  const out: string[] = []
  out.push(`### Запуск ${run.id} (${roleShort(run.role)})`)
  out.push(`- Время: ${fmtTime(run.createdAt)}`)
  out.push(`- Тип подключения: ${run.backend}`)
  out.push(`- Подключение: ${reported(run.connectionName)}`)
  out.push(`- Запрошенная модель: ${reported(run.model)}`)
  out.push(`- Фактический провайдер: ${reported(run.input?.responseMetadata?.actualProvider)}`)
  out.push(`- Фактическая модель: ${reported(run.input?.responseMetadata?.actualModel)}`)
  out.push(`- Статус: ${RUN_STATUS_LABELS[run.status]}${run.error ? ` — ${run.error}` : ''}`)
  out.push(
    `- Вердикт: ${run.verdict ? VERDICT_LABELS[run.verdict] + ' (' + (run.verdictBy === 'user' ? 'пользователь' : run.verdictBy === 'program' ? 'программа' : 'модель') + ')' : 'не установлен'}`
  )
  if (run.modelVerdict && run.verdictBy === 'user') {
    out.push(`- Исходный вердикт модели: ${VERDICT_LABELS[run.modelVerdict]}`)
  }
  out.push(`- Длительность: ${fmtDuration(run.durationMs)}`)
  if (run.tokensIn !== null || run.tokensOut !== null) {
    out.push(`- Токены: вх ${run.tokensIn ?? '—'} / вых ${run.tokensOut ?? '—'}`)
  }
  out.push('')
  out.push('#### Вход')
  if (run.input) {
    out.push('```json')
    out.push(JSON.stringify(run.input, null, 2))
    out.push('```')
  } else {
    out.push('_вход не сохранён_')
  }
  out.push('')
  out.push('#### Выход')
  out.push(run.output ? '```\n' + run.output + '\n```' : '_выход отсутствует_')
  out.push('')
  if (run.programChecks.length) {
    out.push('#### Локальные программные проверки')
    for (const c of run.programChecks) {
      out.push(`- ${c.status === 'unverified' ? 'НЕ ПРОВЕРЕНО' : c.passed ? 'PASS' : 'FAIL'} · ${cell(c.name)} — ${cell(c.detail)}`)
    }
    out.push('')
  }
  if (run.error) {
    out.push('#### Ошибка')
    out.push('```')
    out.push(run.error)
    out.push('```')
  }
  return out.join('\n')
}

// Keep card export and handoff export on the same redaction path.
export { cleanRunSkillText }
