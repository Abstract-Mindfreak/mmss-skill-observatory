// POST /api/connections/[id]/embed-test — one real embedding probe
// (modern /api/embed with legacy /api/embeddings fallback).
// Owned by agent 1-b.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { embed } from '@/lib/ollama'
import { embedFreeLLM } from '@/lib/freellmapi'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const connection = await db.connection.findUnique({ where: { id } })
  if (!connection) {
    return NextResponse.json({ error: 'Подключение не найдено' }, { status: 404 })
  }

  const body = (await req.json().catch(() => null)) as
    | { model?: unknown; text?: unknown }
    | null
  const model = typeof body?.model === 'string' ? body.model.trim() : ''
  const text = typeof body?.text === 'string' ? body.text : ''
  if (!model) {
    return NextResponse.json({ error: 'Укажите embedding-модель (model)' }, { status: 400 })
  }
  if (!text.trim()) {
    return NextResponse.json({ error: 'Укажите текст для embedding (text)' }, { status: 400 })
  }

  const started = Date.now()
  try {
    const vector = connection.kind === 'freellmapi'
      ? await embedFreeLLM(connection.baseUrl, model, text, 30000)
      : (await embed(connection.baseUrl, { model, input: text, timeoutMs: 30000 })).vector
    return NextResponse.json({
      ok: true,
      dimensions: vector.length,
      preview: vector.slice(0, 8),
      durationMs: Date.now() - started,
      via: connection.kind === 'freellmapi' ? 'freellmapi' : 'ollama',
    })
  } catch (err) {
    return NextResponse.json({
      ok: false,
      dimensions: null,
      preview: [],
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
