import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { currentEmbeddingText, cosineSimilarity, embeddingTarget, parseVector, SEMANTIC_FORMAT_VERSION, vectorize, type SemanticRepresentation } from '@/lib/semantic-codemap'
import { safeParse, sha256Hex } from '@/lib/serialize'
import { isDiagnosticObservation } from '@/lib/semantic-filters'
import { isIndexEntryCompatible } from '@/lib/semantic-search'

const MODES: Record<string, SemanticRepresentation> = { functional: 'functional', source: 'source', observation: 'observation' }

export function createSemanticSearchHandler(dependencies: { vectorize?: typeof vectorize } = {}) {
async function POST(req: Request) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  const versionId = typeof body?.versionId === 'string' ? body.versionId : ''
  const query = typeof body?.query === 'string' ? body.query.trim() : ''
  const representation = typeof body?.representation === 'string' ? MODES[body.representation] : undefined
  const topK = typeof body?.topK === 'number' ? Math.max(1, Math.min(20, Math.floor(body.topK))) : 8
  const threshold = typeof body?.threshold === 'number' ? Math.max(-1, Math.min(1, body.threshold)) : 0.2
  const includeDiagnostics = body?.includeDiagnostics === true
  const sourceFragmentIds = Array.isArray(body?.sourceFragmentIds) ? [...new Set(body.sourceFragmentIds.filter((id): id is string => typeof id === 'string'))] : null
  if (!projectId || !versionId || !query || !representation) return NextResponse.json({ error: 'Укажите проект, версию, запрос и поисковое представление' }, { status: 400 })
  const version = await db.documentVersion.findFirst({ where: { id: versionId, projectId } })
  if (!version) return NextResponse.json({ error: 'Версия не принадлежит проекту' }, { status: 400 })
  const functionalCount = await db.semanticPosition.count({ where: { projectId, versionId } })
  if (representation === 'functional' && functionalCount === 0) return NextResponse.json({
    representation, results: [], note: 'В этой версии ещё нет функциональных описаний. Выберите «Исходный текст», чтобы явно искать по формулировкам.',
  })
  const target = await embeddingTarget(projectId)
  let queryVector: number[]
  try { queryVector = (await (dependencies.vectorize ?? vectorize)(projectId, target.assignment.model!, target.connection.baseUrl, query)).vector }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 }) }
  const rows = await db.embeddingVector.findMany({ where: { projectId, versionId, representation, ...(representation === 'source' && sourceFragmentIds ? { fragmentId: { in: sourceFragmentIds } } : {}) } })
  const candidates: { representation: SemanticRepresentation; entityId: string; similarity: number; position: unknown; fragment: unknown; observation: unknown; model: string; dimensions: number }[] = []
  let readyCount = 0
  let staleCount = 0
  let failedCount = 0
  for (const row of rows) {
    if (row.status === 'failed') { failedCount++; continue }
    if (row.status === 'stale') { staleCount++; continue }
    const expected = await currentEmbeddingText(representation, row.positionId ?? row.fragmentId ?? row.observationId ?? '', projectId, versionId)
    const vec = parseVector(row.vector)
    if (!expected || !isIndexEntryCompatible(row, target.assignment.model!, SEMANTIC_FORMAT_VERSION, sha256Hex(expected), row.dimensions, vec?.length ?? null)) {
      staleCount++
      continue
    }
    if (row.dimensions !== queryVector.length || vec!.length !== queryVector.length) {
      staleCount++
      continue
    }
    readyCount++
    const similarity = cosineSimilarity(queryVector, vec!)
    if (similarity === null || similarity < threshold) continue
    const positionRaw = row.positionId ? await db.semanticPosition.findUnique({ where: { id: row.positionId }, include: {
      fragments: { include: { fragment: { select: { id: true, path: true, text: true } } } },
      outgoingRelations: { include: { targetPosition: { select: { id: true, title: true, status: true } } } },
      incomingRelations: { include: { sourcePosition: { select: { id: true, title: true, status: true } } } },
      observations: { include: { run: { select: { id: true, role: true, origin: true, input: true, output: true, status: true } }, note: { select: { id: true, body: true, origin: true, kind: true } } } },
    } }) : null
    const position = positionRaw ? { ...positionRaw, observations: includeDiagnostics ? positionRaw.observations : positionRaw.observations.filter((item) => !isDiagnosticObservation({
      observation: item.observation, evidenceText: item.evidenceText,
      run: item.run ? { input: safeParse(item.run.input, {}), output: item.run.output } : null,
      note: item.note,
    })) } : null
    const fragment = row.fragmentId ? await db.fragment.findUnique({ where: { id: row.fragmentId }, include: { semanticLinks: { include: { semanticPosition: { select: { id: true, title: true, status: true } } } } } }) : null
    const observation = row.observationId ? await db.positionObservation.findUnique({ where: { id: row.observationId }, include: { position: { select: { id: true, title: true, status: true } }, run: { select: { id: true, role: true, origin: true, input: true, output: true, status: true } }, note: { select: { id: true, body: true, origin: true, kind: true } } } }) : null
    if (!includeDiagnostics && observation && isDiagnosticObservation({
      observation: observation.observation, evidenceText: observation.evidenceText,
      run: observation.run ? { input: safeParse(observation.run.input, {}), output: observation.run.output } : null,
      note: observation.note,
    })) continue
    const entityId = row.positionId ?? row.fragmentId ?? row.observationId
    if (!entityId) continue
    candidates.push({ representation, entityId, similarity, position, fragment, observation, model: row.model, dimensions: row.dimensions })
  }
  candidates.sort((a, b) => b.similarity - a.similarity)
  const totalCount = representation === 'functional' ? functionalCount : representation === 'source' ? sourceFragmentIds ? sourceFragmentIds.length : await db.fragment.count({ where: { versionId } }) : await db.positionObservation.count({ where: { projectId, versionId } })
  const currentEntries = new Set(rows.filter((row) => row.model === target.assignment.model && row.formatVersion === SEMANTIC_FORMAT_VERSION).map((row) => row.positionId ?? row.fragmentId ?? row.observationId).filter((id): id is string => Boolean(id)))
  return NextResponse.json({ representation, requestedModel: target.assignment.model, results: candidates.slice(0, topK), index: { ready: readyCount, stale: staleCount, failed: failedCount, missing: Math.max(0, totalCount - currentEntries.size) }, note: 'Similarity — только поисковая близость, не вероятность корректности или доказательство смысловой связи.' })
}
return { POST }
}

const handlers = createSemanticSearchHandler()
export const POST = handlers.POST
