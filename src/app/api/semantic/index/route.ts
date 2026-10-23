import { NextResponse } from 'next/server'
import { indexOne, type SemanticRepresentation } from '@/lib/semantic-codemap'

const REPRESENTATIONS = ['functional', 'source', 'observation']

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  const versionId = typeof body?.versionId === 'string' ? body.versionId : ''
  const items = Array.isArray(body?.items) ? body.items : []
  if (!projectId || !versionId || !items.length || items.length > 100) return NextResponse.json({ error: 'Укажите проект, версию и от 1 до 100 записей для индексации' }, { status: 400 })
  const results: { entityId?: string; representation?: string; status: string; error?: string; dimensions?: number }[] = []
  for (const raw of items) {
    const item = raw as Record<string, unknown>
    if (typeof item.entityId !== 'string' || typeof item.representation !== 'string' || !REPRESENTATIONS.includes(item.representation)) {
      results.push({ status: 'failed', error: 'Некорректная запись индекса' })
      continue
    }
    try { results.push({ entityId: item.entityId, representation: item.representation, ...await indexOne(projectId, versionId, item.representation as SemanticRepresentation, item.entityId) }) }
    catch (error) { results.push({ entityId: item.entityId, representation: item.representation, status: 'failed', error: error instanceof Error ? error.message : String(error) }) }
  }
  return NextResponse.json({ results })
}
