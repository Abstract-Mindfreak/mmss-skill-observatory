// PATCH/DELETE /api/connections/[id]. Owned by agent 1-b.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toConnectionDTO } from '@/lib/serialize'
import { normalizeBaseUrl } from '@/lib/ollama'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = (await req.json().catch(() => null)) as
    | { name?: unknown; baseUrl?: unknown }
    | null
  if (!body) {
    return NextResponse.json({ error: 'Некорректный JSON в теле запроса' }, { status: 400 })
  }

  const connection = await db.connection.findUnique({ where: { id } })
  if (!connection) {
    return NextResponse.json({ error: 'Подключение не найдено' }, { status: 404 })
  }

  const data: { name?: string; baseUrl?: string; status?: string } = {}
  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name) {
      return NextResponse.json({ error: 'Название подключения не может быть пустым' }, { status: 400 })
    }
    data.name = name
  }
  if (typeof body.baseUrl === 'string') {
    const baseUrl = body.baseUrl.trim()
    if (!baseUrl) {
      return NextResponse.json({ error: 'Адрес сервера не может быть пустым' }, { status: 400 })
    }
    data.baseUrl = normalizeBaseUrl(baseUrl)
    // Address changed — cached status/model list is no longer trustworthy.
    data.status = 'unknown'
  }

  const updated = await db.connection.update({ where: { id }, data })
  return NextResponse.json(toConnectionDTO(updated))
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const connection = await db.connection.findUnique({ where: { id } })
  if (!connection) {
    return NextResponse.json({ error: 'Подключение не найдено' }, { status: 404 })
  }
  // Reset assignments that referenced this connection (backend → null).
  await db.assignment.updateMany({
    where: { connectionId: id },
    data: { backend: null, connectionId: null, model: null },
  })
  await db.connection.delete({ where: { id } })
  return new NextResponse(null, { status: 204 })
}
