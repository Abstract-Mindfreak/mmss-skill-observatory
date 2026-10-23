// ============================================================
// MMSS Skill Observatory — self-contained Ollama REST client.
// Owned by agent 1-b. Server-side only.
// Honest error mapping: every failure surfaces a real reason (RU),
// nothing is silently swallowed or replaced by synthetic data.
// ============================================================

export type OllamaErrorKind = 'timeout' | 'aborted' | 'http' | 'network' | 'unknown'

export class OllamaError extends Error {
  kind: OllamaErrorKind
  status?: number

  constructor(message: string, kind: OllamaErrorKind, status?: number) {
    super(message)
    this.name = 'OllamaError'
    this.kind = kind
    this.status = status
  }
}

/** Normalize a user-entered Ollama base URL: trim trailing '/' and a trailing '/api'. */
export function normalizeBaseUrl(url: string): string {
  let u = (url ?? '').trim()
  while (u.endsWith('/')) u = u.slice(0, -1)
  if (u.toLowerCase().endsWith('/api')) u = u.slice(0, -4)
  while (u.endsWith('/')) u = u.slice(0, -1)
  return u
}

/**
 * Collect error text along the cause chain. Node's undici hides ECONNREFUSED
 * inside `cause` (sometimes an AggregateError); Bun uses code=ConnectionRefused
 * with a human message. Both must map to an honest RU reason.
 */
function collectErrorText(err: unknown, out: string[], depth = 0): void {
  if (!err || depth > 6) return
  if (typeof err === 'string') {
    out.push(err)
    return
  }
  if (typeof err !== 'object') return
  const e = err as { message?: unknown; code?: unknown; cause?: unknown; errors?: unknown }
  if (typeof e.message === 'string' && e.message) {
    out.push(typeof e.code === 'string' ? `${e.message} [${e.code}]` : e.message)
  } else if (typeof e.code === 'string' && e.code) {
    out.push(`[${e.code}]`)
  }
  if (Array.isArray(e.errors)) {
    for (const x of e.errors) collectErrorText(x, out, depth + 1)
  }
  if (e.cause) collectErrorText(e.cause, out, depth + 1)
}

function mapNetworkError(err: unknown): string {
  const out: string[] = []
  collectErrorText(err, out)
  const msg = out.join(' | ') || (err instanceof Error ? err.message : String(err))
  if (/ECONNREFUSED|ConnectionRefused|Unable to connect/i.test(msg)) {
    return 'Соединение отклонено: Ollama не запущена или адрес недоступен'
  }
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN|DnsError|name_or_service_unknown/i.test(msg)) {
    return 'Адрес не найден: проверьте baseUrl сервера Ollama'
  }
  if (/ECONNRESET|socket hang up|ConnectionClosed|ConnectionReset/i.test(msg)) {
    return 'Соединение сброшено сервером Ollama'
  }
  if (/ETIMEDOUT|timed?\s?out/i.test(msg)) {
    return 'Превышено время ожидания'
  }
  if (/fetch failed/i.test(msg)) {
    return `Не удалось выполнить запрос к Ollama: ${msg}`
  }
  return err instanceof Error ? err.message : String(err)
}

interface FetchWithTimeoutOptions {
  method: 'GET' | 'POST'
  body?: string
  timeoutMs: number
  /** External abort signal (e.g. run cancellation). */
  signal?: AbortSignal
}

async function fetchWithTimeout(
  url: string,
  opts: FetchWithTimeoutOptions
): Promise<Response> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, opts.timeoutMs)
  const onExternalAbort = () => controller.abort()
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort()
    else opts.signal.addEventListener('abort', onExternalAbort, { once: true })
  }
  try {
    return await fetch(url, {
      method: opts.method,
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body,
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch (err) {
    if (timedOut) {
      throw new OllamaError('Превышено время ожидания', 'timeout')
    }
    if (opts.signal?.aborted) {
      throw new OllamaError('Запрос отменён', 'aborted')
    }
    throw new OllamaError(mapNetworkError(err), 'network')
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onExternalAbort)
  }
}

async function httpError(res: Response): Promise<OllamaError> {
  const snippet = (await res.text().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ').trim()
  if (res.status === 404) {
    return new OllamaError('Модель не найдена на сервере Ollama', 'http', 404)
  }
  const detail = snippet ? `: ${snippet}` : ''
  return new OllamaError(`Ollama вернула HTTP ${res.status}${detail}`, 'http', res.status)
}

// ---------------- /api/tags ----------------

export interface OllamaTag {
  name: string
  size: number | null
}

/** GET {base}/api/tags → [{name, size}]. Throws OllamaError with an honest RU message. */
export async function listTags(
  baseUrl: string,
  timeoutMs = 5000
): Promise<OllamaTag[]> {
  const base = normalizeBaseUrl(baseUrl)
  const res = await fetchWithTimeout(`${base}/api/tags`, { method: 'GET', timeoutMs })
  if (!res.ok) throw await httpError(res)
  const data = (await res.json().catch(() => null)) as
    | { models?: { name?: unknown; size?: unknown }[] }
    | null
  if (!data || !Array.isArray(data.models)) {
    throw new OllamaError('Ollama вернула неожиданный формат ответа /api/tags', 'unknown')
  }
  return data.models
    .filter((m) => typeof m?.name === 'string')
    .map((m) => ({
      name: m.name as string,
      size: typeof m.size === 'number' ? m.size : null,
    }))
}

// ---------------- /api/show ----------------

export interface OllamaShowResult {
  capabilities?: { embedding?: boolean; [key: string]: unknown }
  details?: { [key: string]: unknown }
}

/** POST {base}/api/show {model} → capabilities/details. */
export async function showModel(
  baseUrl: string,
  model: string,
  timeoutMs = 5000
): Promise<OllamaShowResult> {
  const base = normalizeBaseUrl(baseUrl)
  const res = await fetchWithTimeout(`${base}/api/show`, {
    method: 'POST',
    body: JSON.stringify({ model }),
    timeoutMs,
  })
  if (!res.ok) throw await httpError(res)
  const data = (await res.json().catch(() => null)) as OllamaShowResult | null
  if (!data) {
    throw new OllamaError('Ollama вернула неожиданный формат ответа /api/show', 'unknown')
  }
  return data
}

// ---------------- /api/chat ----------------

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface OllamaChatParams {
  model: string
  messages: OllamaChatMessage[]
  temperature?: number
  numPredict?: number
  timeoutMs?: number
  signal?: AbortSignal
}

export interface OllamaChatResult {
  content: string
  tokensIn: number | null
  tokensOut: number | null
  durationMs: number
  actualModel: string | null
  finishReason: string | null
  outputTruncated: boolean | null
}

/** POST {base}/api/chat (stream:false) → assistant content + token counts + measured duration. */
export async function chat(
  baseUrl: string,
  params: OllamaChatParams
): Promise<OllamaChatResult> {
  const base = normalizeBaseUrl(baseUrl)
  const timeoutMs = params.timeoutMs ?? 120000
  const options: { temperature?: number; num_predict?: number } = {}
  if (typeof params.temperature === 'number') options.temperature = params.temperature
  if (typeof params.numPredict === 'number') options.num_predict = params.numPredict

  const started = Date.now()
  const res = await fetchWithTimeout(`${base}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      stream: false,
      ...(Object.keys(options).length ? { options } : {}),
    }),
    timeoutMs,
    signal: params.signal,
  })
  if (!res.ok) throw await httpError(res)
  const data = (await res.json().catch(() => null)) as
    | { model?: unknown; message?: { content?: unknown }; prompt_eval_count?: unknown; eval_count?: unknown; done_reason?: unknown }
    | null
  const content = data?.message?.content
  if (typeof content !== 'string') {
    throw new OllamaError('Ollama вернула ответ без текста сообщения', 'unknown')
  }
  return {
    content,
    tokensIn: typeof data?.prompt_eval_count === 'number' ? data.prompt_eval_count : null,
    tokensOut: typeof data?.eval_count === 'number' ? data.eval_count : null,
    durationMs: Date.now() - started,
    actualModel: typeof data?.model === 'string' ? data.model : null,
    finishReason: typeof data?.done_reason === 'string' ? data.done_reason : null,
    outputTruncated: typeof data?.done_reason === 'string' ? data.done_reason === 'length' : null,
  }
}

// ---------------- /api/embed (+ legacy /api/embeddings) ----------------

export interface OllamaEmbedParams {
  model: string
  input: string
  timeoutMs?: number
}

export interface OllamaEmbedResult {
  vector: number[]
  dimensions: number
  via: 'api/embed' | 'api/embeddings'
}

function toVector(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const vec = raw.map((x) => Number(x))
  if (!vec.every((n) => Number.isFinite(n))) return null
  return vec
}

/** Embed a single text: modern /api/embed first, legacy /api/embeddings fallback on 404. */
export async function embed(
  baseUrl: string,
  params: OllamaEmbedParams
): Promise<OllamaEmbedResult> {
  const base = normalizeBaseUrl(baseUrl)
  const timeoutMs = params.timeoutMs ?? 30000

  const modern = await fetchWithTimeout(`${base}/api/embed`, {
    method: 'POST',
    // Preserve the exact indexed text. Oversized inputs must fail visibly.
    body: JSON.stringify({ model: params.model, input: params.input, truncate: false }),
    timeoutMs,
  })
  if (modern.status !== 404) {
    if (!modern.ok) throw await httpError(modern)
    const data = (await modern.json().catch(() => null)) as
      | { embeddings?: unknown }
      | null
    const first = Array.isArray(data?.embeddings) ? data.embeddings[0] : null
    const vector = toVector(first)
    if (vector) {
      return { vector, dimensions: vector.length, via: 'api/embed' }
    }
    // 200 but no usable embeddings → try the legacy endpoint before failing.
  }

  const legacy = await fetchWithTimeout(`${base}/api/embeddings`, {
    method: 'POST',
    body: JSON.stringify({ model: params.model, prompt: params.input, truncate: false }),
    timeoutMs,
  })
  if (!legacy.ok) throw await httpError(legacy)
  const data2 = (await legacy.json().catch(() => null)) as { embedding?: unknown } | null
  const vector2 = toVector(data2?.embedding)
  if (!vector2) {
    throw new OllamaError('Ollama вернула ответ без embedding-вектора', 'unknown')
  }
  return { vector: vector2, dimensions: vector2.length, via: 'api/embeddings' }
}
