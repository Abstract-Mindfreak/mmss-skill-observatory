import type { ModelInfo } from '@/lib/types'

export class FreeLLMApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FreeLLMApiError'
  }
}

function baseUrl(value: string) {
  return value.trim().replace(/\/+$/, '')
}

function apiKey() {
  const key = process.env.FREELLMAPI_API_KEY?.trim()
  if (!key) throw new FreeLLMApiError('Укажите FREELLMAPI_API_KEY в .env.local и перезапустите S2')
  return key
}

async function requestWithHeaders(url: string, body?: unknown, timeoutMs = 120000, signal?: AbortSignal) {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ').trim()
      if (response.status === 413 || /context.{0,20}(length|limit|window)|request.{0,20}(too large|too long)|maximum.{0,20}tokens/i.test(detail)) {
        throw new FreeLLMApiError('Модель отклонила запрос из-за размера входа. Полный текст не сокращался. Выберите модель с большим контекстным окном или режим «Сокращённый контекст».')
      }
      throw new FreeLLMApiError(`FreeLLMAPI вернул HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
    }
    return { data: await response.json(), headers: response.headers }
  } catch (error) {
    if (error instanceof FreeLLMApiError) throw error
    if (signal?.aborted) throw new FreeLLMApiError('Запрос отменён')
    if (error instanceof Error && error.name === 'AbortError') {
      throw new FreeLLMApiError('Истекло время ожидания ответа FreeLLMAPI')
    }
    throw new FreeLLMApiError(`Не удалось подключиться к FreeLLMAPI: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

async function request(url: string, body?: unknown, timeoutMs = 120000, signal?: AbortSignal) {
  return (await requestWithHeaders(url, body, timeoutMs, signal)).data
}

export async function listFreeLLMModels(url: string): Promise<ModelInfo[]> {
  const data = (await request(`${baseUrl(url)}/models?available=true`, undefined, 15000)) as {
    data?: { id?: unknown }[]
  }
  if (!Array.isArray(data?.data)) throw new FreeLLMApiError('FreeLLMAPI вернул неожиданный список моделей')
  return data.data
    .filter((item) => typeof item?.id === 'string')
    .map((item) => {
      const name = item.id as string
      // FreeLLMAPI's `auto` alias is valid for both chat and embeddings;
      // embedding model families are selected by the gateway.
      return { name, sizeBytes: null, generate: true, embed: name === 'auto' || /embed/i.test(name), probe: 'probe' as const }
    })
}

export async function chatFreeLLM(
  url: string,
  params: {
    model: string
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
    temperature?: number
    numPredict?: number
    timeoutMs?: number
    signal?: AbortSignal
  }
) {
  const started = Date.now()
  const response = await requestWithHeaders(`${baseUrl(url)}/chat/completions`, {
    model: params.model,
    messages: params.messages,
    stream: false,
    ...(params.temperature === undefined ? {} : { temperature: params.temperature }),
    ...(params.numPredict === undefined ? {} : { max_tokens: params.numPredict }),
  }, params.timeoutMs, params.signal)
  const data = response.data as {
    choices?: { message?: { content?: unknown }; finish_reason?: unknown }[]
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
    model?: unknown
  }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new FreeLLMApiError('FreeLLMAPI вернул ответ без текста')
  return {
    content,
    durationMs: Date.now() - started,
    tokensIn: typeof data.usage?.prompt_tokens === 'number' ? data.usage.prompt_tokens : null,
    tokensOut: typeof data.usage?.completion_tokens === 'number' ? data.usage.completion_tokens : null,
    actualProvider: response.headers.get('x-routed-via'),
    actualModel: typeof data.model === 'string' ? data.model : null,
    finishReason: typeof data.choices?.[0]?.finish_reason === 'string' ? data.choices[0].finish_reason : null,
    outputTruncated: typeof data.choices?.[0]?.finish_reason === 'string'
      ? data.choices[0].finish_reason === 'length'
      : null,
  }
}

export async function embedFreeLLM(url: string, model: string, input: string, timeoutMs = 30000) {
  const data = (await request(`${baseUrl(url)}/embeddings`, { model, input }, timeoutMs)) as {
    data?: { embedding?: unknown }[]
  }
  const vector = data.data?.[0]?.embedding
  if (!Array.isArray(vector) || vector.some((n) => typeof n !== 'number')) {
    throw new FreeLLMApiError('FreeLLMAPI вернул неожиданный embedding')
  }
  return vector as number[]
}
