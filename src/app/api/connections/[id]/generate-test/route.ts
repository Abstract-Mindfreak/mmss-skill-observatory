// POST /api/connections/[id]/generate-test — one real chat call (60 s timeout).
// Owned by agent 1-b.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { chat } from '@/lib/ollama'
import { chatFreeLLM } from '@/lib/freellmapi'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const connection = await db.connection.findUnique({ where: { id } })
  if (!connection) {
    return NextResponse.json({ error: 'Подключение не найдено' }, { status: 404 })
  }

  const body = (await req.json().catch(() => null)) as
    | { model?: unknown; prompt?: unknown }
    | null
  const model = typeof body?.model === 'string' ? body.model.trim() : ''
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
  if (!model) {
    return NextResponse.json({ error: 'Укажите модель (model)' }, { status: 400 })
  }
  if (!prompt) {
    return NextResponse.json({ error: 'Укажите текст промпта (prompt)' }, { status: 400 })
  }

  try {
    const result = connection.kind === 'freellmapi'
      ? await chatFreeLLM(connection.baseUrl, { model, messages: [{ role: 'user', content: prompt }], timeoutMs: 60000 })
      : await chat(connection.baseUrl, { model, messages: [{ role: 'user', content: prompt }], timeoutMs: 60000 })
    return NextResponse.json({
      ok: true,
      output: result.content,
      durationMs: result.durationMs,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    })
  } catch (err) {
    return NextResponse.json({
      ok: false,
      output: null,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
