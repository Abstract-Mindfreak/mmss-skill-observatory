import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sha256Hex } from '@/lib/serialize'
import type { RemoteCheckResult } from '@/lib/types'

type Params = { params: Promise<{ id: string }> }

const DEFAULT_URL =
  'https://raw.githubusercontent.com/Abstract-Mindfreak/mmss-principle-synthesis/main/skills/mmss-principle-synthesis/SKILL.md'

export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  const version = await db.documentVersion.findUnique({ where: { id } })
  if (!version) {
    return NextResponse.json({ error: 'Версия не найдена' }, { status: 404 })
  }
  const url =
    typeof body?.url === 'string' && body.url.trim() ? body.url.trim() : DEFAULT_URL

  const localHash = version.contentHash
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) {
      const result: RemoteCheckResult = {
        reachable: false,
        error: `Удалённый источник ответил ошибкой HTTP ${res.status}`,
        url,
        remoteHash: null,
        localHash,
        identical: false,
        remoteLength: null,
        fetchedAt: null,
        note: 'Проверка не изменяет базовую версию',
      }
      return NextResponse.json(result)
    }
    const text = await res.text()
    const remoteHash = sha256Hex(text)
    const result: RemoteCheckResult = {
      reachable: true,
      error: null,
      url,
      remoteHash,
      localHash,
      identical: remoteHash === localHash,
      remoteLength: text.length,
      fetchedAt: new Date().toISOString(),
      note: 'Проверка не изменяет базовую версию',
    }
    return NextResponse.json(result)
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    const isEnvironmentError =
      /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|aborted|timeout|network/i.test(raw)
    const result: RemoteCheckResult = {
      reachable: false,
      error: isEnvironmentError
        ? 'GitHub недоступен из этой среды — проверьте вручную в локальном запуске'
        : `Сетевая ошибка: ${raw}`,
      url,
      remoteHash: null,
      localHash,
      identical: false,
      remoteLength: null,
      fetchedAt: null,
      note: 'Проверка не изменяет базовую версию',
    }
    return NextResponse.json(result)
  }
}
