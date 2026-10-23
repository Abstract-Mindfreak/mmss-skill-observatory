// POST /api/connections/[id]/models — list models from /api/tags and probe
// capabilities via /api/show. Caches the result on the connection.
// Owned by agent 1-b.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { ModelInfo } from '@/lib/types'
import { listTags, showModel } from '@/lib/ollama'
import { listFreeLLMModels } from '@/lib/freellmapi'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const connection = await db.connection.findUnique({ where: { id } })
  if (!connection) {
    return NextResponse.json({ error: 'Подключение не найдено' }, { status: 404 })
  }

  let tags: { name: string; size: number | null }[]
  if (connection.kind === 'freellmapi') {
    try {
      const models = await listFreeLLMModels(connection.baseUrl)
      await db.connection.update({
        where: { id },
        data: { models: JSON.stringify(models), status: 'ok', lastError: null, lastCheckAt: new Date() },
      })
      return NextResponse.json({ models })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await db.connection.update({
        where: { id },
        data: { status: 'error', lastError: message, lastCheckAt: new Date(), models: '[]' },
      })
      return NextResponse.json({ models: [], error: message })
    }
  }
  try {
    tags = await listTags(connection.baseUrl, 5000)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.connection.update({
      where: { id },
      data: {
        status: 'error',
        lastError: message,
        lastCheckAt: new Date(),
        models: '[]',
      },
    })
    return NextResponse.json({ models: [], error: message })
  }

  const models: ModelInfo[] = await Promise.all(
    tags.map(async (tag): Promise<ModelInfo> => {
      const looksLikeEmbed = /embed/i.test(tag.name)
      // Name heuristic (fallback): models with 'embed' in the name are
      // embedding models; everything listed in tags is assumed generative.
      const generate = !looksLikeEmbed
      const embedByName = looksLikeEmbed
      try {
        const shown = await showModel(connection.baseUrl, tag.name, 5000)
        const capabilities = shown?.capabilities
        if (capabilities && typeof capabilities === 'object') {
          return {
            name: tag.name,
            sizeBytes: tag.size,
            generate,
            embed: capabilities.embedding === true || embedByName,
            probe: 'show' as const,
          }
        }
        // show responded but without a capabilities field — still a real probe.
        return {
          name: tag.name,
          sizeBytes: tag.size,
          generate,
          embed: embedByName,
          probe: 'show' as const,
        }
      } catch {
        // show failed (old server, timeout...) — capabilities unknown,
        // fall back to the tags-only heuristic, honestly labelled.
        return {
          name: tag.name,
          sizeBytes: tag.size,
          generate,
          embed: embedByName,
          probe: 'tags-only' as const,
        }
      }
    })
  )

  await db.connection.update({
    where: { id },
    data: {
      models: JSON.stringify(models),
      status: 'ok',
      lastError: null,
      lastCheckAt: new Date(),
    },
  })

  return NextResponse.json({ models })
}
