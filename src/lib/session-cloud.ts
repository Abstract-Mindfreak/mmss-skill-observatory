// ============================================================
// MMSS Skill Observatory — session-cloud backend (z-ai-web-dev-sdk).
// Owned by agent 1-b. SERVER-SIDE ONLY (z-ai-web-dev-sdk must never
// reach client bundles).
//
// The session-cloud backend is a TEMPORARY development-session backend:
// it works only inside this sandbox/dev session. All failures are
// reported honestly — no silent fallbacks.
// ============================================================

import ZAI from 'z-ai-web-dev-sdk'

export type SessionCloudErrorKind = 'timeout' | 'aborted' | 'unavailable' | 'unknown'

export class SessionCloudError extends Error {
  kind: SessionCloudErrorKind

  constructor(message: string, kind: SessionCloudErrorKind) {
    super(message)
    this.name = 'SessionCloudError'
    this.kind = kind
  }
}

export interface SessionCloudMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface SessionCloudResult {
  content: string
  backend: 'session-cloud'
  durationMs: number
  finishReason: string | null
  outputTruncated: boolean | null
}

type ZAIInstance = Awaited<ReturnType<typeof ZAI.create>>

interface SessionCloudGlobalCache {
  __mmssZai?: ZAIInstance
  __mmssZaiCreatePromise?: Promise<ZAIInstance>
  __mmssSessionProbe?: { at: number; result: SessionCloudProbe }
}

const g = globalThis as unknown as SessionCloudGlobalCache

async function getZai(): Promise<ZAIInstance> {
  if (g.__mmssZai) return g.__mmssZai
  if (!g.__mmssZaiCreatePromise) {
    g.__mmssZaiCreatePromise = ZAI.create().then((zai) => {
      g.__mmssZai = zai
      return zai
    })
  }
  return g.__mmssZaiCreatePromise
}

function rejectOn(timeoutMs: number, signal?: AbortSignal): Promise<never> {
  return new Promise<never>((_, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new SessionCloudError(
            `Облачный бэкенд сессии: превышено время ожидания (${Math.round(timeoutMs / 1000)} с)`,
            'timeout'
          )
        ),
      timeoutMs
    )
    const onAbort = () => {
      clearTimeout(timer)
      reject(new SessionCloudError('Запрос отменён', 'aborted'))
    }
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

/**
 * One chat completion through the session-scoped cloud backend.
 * thinking disabled: research roles need short, deterministic answers.
 */
export async function chatCompletion(
  messages: SessionCloudMessage[],
  timeoutMs = 120000,
  signal?: AbortSignal
): Promise<SessionCloudResult> {
  const started = Date.now()
  try {
    const zai = await getZai()
    const completion = await Promise.race([
      zai.chat.completions.create({
        messages,
        thinking: { type: 'disabled' },
      }),
      rejectOn(timeoutMs, signal),
    ])
    const choice = completion?.choices?.[0] as { message?: { content?: unknown }; finish_reason?: unknown } | undefined
    const content: unknown = choice?.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      throw new SessionCloudError(
        'Облачный бэкенд сессии вернул пустой ответ',
        'unavailable'
      )
    }
    const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null
    return {
      content,
      backend: 'session-cloud',
      durationMs: Date.now() - started,
      finishReason,
      outputTruncated: finishReason === null ? null : finishReason === 'length',
    }
  } catch (err) {
    if (err instanceof SessionCloudError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    throw new SessionCloudError(`Облачный бэкенд сессии недоступен: ${msg}`, 'unavailable')
  }
}

// ---------------- probe (cached 60 s) ----------------

export interface SessionCloudProbe {
  available: boolean
  note: string
  error?: string
}

export const SESSION_CLOUD_NOTE =
  'Облачный бэкенд доступен только внутри этой сессии разработки; для локального запуска используйте Ollama'

const PROBE_TTL_MS = 60_000

/** Tiny 'ping' completion to check availability; result cached for 60 s. */
export async function probeSessionCloud(force = false): Promise<SessionCloudProbe> {
  const cached = g.__mmssSessionProbe
  if (!force && cached && Date.now() - cached.at < PROBE_TTL_MS) {
    return cached.result
  }
  let result: SessionCloudProbe
  try {
    await chatCompletion([{ role: 'user', content: 'ping' }], 30_000)
    result = { available: true, note: SESSION_CLOUD_NOTE }
  } catch (err) {
    result = {
      available: false,
      note: SESSION_CLOUD_NOTE,
      error: err instanceof Error ? err.message : String(err),
    }
  }
  g.__mmssSessionProbe = { at: Date.now(), result }
  return result
}
