// GET/POST /api/connections — global connection cabinet (projectId=null).
// Owned by agent 1-b.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toConnectionDTO } from '@/lib/serialize'
import { normalizeBaseUrl } from '@/lib/ollama'

export async function GET() {
  const connections = await db.connection.findMany({
    where: { projectId: null },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json(connections.map(toConnectionDTO))
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { name?: unknown; baseUrl?: unknown; kind?: unknown }
    | null
  if (!body) {
    return NextResponse.json({ error: 'Некорректный JSON в теле запроса' }, { status: 400 })
  }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : ''
  const kind = body.kind === 'freellmapi' ? 'freellmapi' : 'ollama'
  if (body.kind !== undefined && body.kind !== 'ollama' && body.kind !== 'freellmapi') {
    return NextResponse.json({ error: 'Неизвестный провайдер подключения' }, { status: 400 })
  }
  if (!name) {
    return NextResponse.json({ error: 'Укажите название подключения (name)' }, { status: 400 })
  }
  if (!baseUrl) {
    return NextResponse.json({ error: 'Укажите адрес сервера Ollama (baseUrl)' }, { status: 400 })
  }

  const created = await db.connection.create({
    data: {
      name,
      kind,
      baseUrl: normalizeBaseUrl(baseUrl),
      projectId: null,
    },
  })
  return NextResponse.json(toConnectionDTO(created))
}
