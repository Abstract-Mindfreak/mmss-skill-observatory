import { db } from '@/lib/db'
import { embed } from '@/lib/ollama'
import { sha256Hex } from '@/lib/serialize'
import { isIndexEntryCurrent } from '@/lib/semantic-search'
export { cosineSimilarity, parseVector } from '@/lib/semantic-search'

export const SEMANTIC_FORMAT_VERSION = 1
export type SemanticRepresentation = 'functional' | 'source' | 'observation'

export function functionalText(position: {
  title: string; purpose: string; regulatedDecision: string; conditions: string
  expectedBehavior: string; limitations: string
}) {
  return [
    `Назначение: ${position.purpose}`,
    `Регулируемое решение: ${position.regulatedDecision}`,
    `Условия применения: ${position.conditions}`,
    `Ожидаемое поведение: ${position.expectedBehavior}`,
    position.limitations ? `Ограничения или неизвестные: ${position.limitations}` : '',
  ].filter(Boolean).join('\n')
}

export function observationText(observation: {
  observation: string; evidenceText: string; conditions: string; criterion: string; limitations: string
}) {
  return [
    `Наблюдение: ${observation.observation}`,
    observation.evidenceText ? `Подтверждающий текст: ${observation.evidenceText}` : '',
    observation.conditions ? `Условия: ${observation.conditions}` : '',
    observation.criterion ? `Критерий: ${observation.criterion}` : '',
    observation.limitations ? `Ограничения: ${observation.limitations}` : '',
  ].filter(Boolean).join('\n')
}

export async function embeddingTarget(projectId: string) {
  const assignment = await db.assignment.findUnique({ where: { projectId_role: { projectId, role: 'embedding' } } })
  if (!assignment || assignment.backend !== 'ollama' || !assignment.connectionId || !assignment.model) {
    throw new Error('Embedding не назначен. В «Подключениях» выберите локальное назначение Ollama.')
  }
  const connection = await db.connection.findUnique({ where: { id: assignment.connectionId } })
  if (!connection || connection.kind !== 'ollama') {
    throw new Error('Назначенное embedding-подключение Ollama недоступно. Выберите его заново в «Подключениях».')
  }
  return { assignment, connection }
}

export async function vectorize(projectId: string, model: string, baseUrl: string, input: string) {
  if (!input.trim()) throw new Error('Текст для embedding пуст')
  const result = await embed(baseUrl, { model, input, timeoutMs: 60000 })
  if (!result.vector.length || !result.vector.every(Number.isFinite)) throw new Error('Ollama вернула некорректный embedding')
  return { vector: result.vector, dimensions: result.dimensions, textHash: sha256Hex(input), model }
}

export async function currentEmbeddingText(representation: SemanticRepresentation, entityId: string, projectId: string, versionId: string) {
  if (representation === 'functional') {
    const position = await db.semanticPosition.findFirst({ where: { id: entityId, projectId, versionId } })
    return position ? functionalText(position) : null
  }
  if (representation === 'source') {
    const fragment = await db.fragment.findFirst({ where: { id: entityId, versionId, version: { projectId } } })
    return fragment?.text ?? null
  }
  const observation = await db.positionObservation.findFirst({ where: { id: entityId, projectId, versionId } })
  return observation ? observationText(observation) : null
}

export async function indexOne(projectId: string, versionId: string, representation: SemanticRepresentation, entityId: string) {
  const version = await db.documentVersion.findFirst({ where: { id: versionId, projectId } })
  if (!version) throw new Error('Версия не принадлежит проекту')
  const target = await embeddingTarget(projectId)
  const input = await currentEmbeddingText(representation, entityId, projectId, versionId)
  if (input === null) throw new Error('Запись не найдена в выбранной версии')
  const textHash = sha256Hex(input)
  const whereEntity = representation === 'functional' ? { positionId: entityId } : representation === 'source' ? { fragmentId: entityId } : { observationId: entityId }
  const existing = await db.embeddingVector.findFirst({ where: { ...whereEntity, representation, model: target.assignment.model!, formatVersion: SEMANTIC_FORMAT_VERSION } })
  if (isIndexEntryCurrent(existing, target.assignment.model!, SEMANTIC_FORMAT_VERSION, textHash)) return { status: 'current' as const, dimensions: existing!.dimensions }
  if (existing) await db.embeddingVector.update({ where: { id: existing.id }, data: { status: 'stale', error: null } })
  try {
    const result = await vectorize(projectId, target.assignment.model!, target.connection.baseUrl, input)
    const data = {
      projectId, versionId, representation, model: result.model, dimensions: result.dimensions,
      textHash: result.textHash, formatVersion: SEMANTIC_FORMAT_VERSION,
      vector: JSON.stringify(result.vector), status: 'ready', error: null,
      fragmentId: representation === 'source' ? entityId : null,
      positionId: representation === 'functional' ? entityId : null,
      observationId: representation === 'observation' ? entityId : null,
    }
    if (existing) await db.embeddingVector.update({ where: { id: existing.id }, data })
    else await db.embeddingVector.create({ data })
    return { status: 'indexed' as const, dimensions: result.dimensions }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (existing) await db.embeddingVector.update({ where: { id: existing.id }, data: { status: 'failed', error: message, textHash } })
    else await db.embeddingVector.create({ data: {
      projectId, versionId, ...whereEntity, representation, model: target.assignment.model!, dimensions: 0,
      textHash, formatVersion: SEMANTIC_FORMAT_VERSION, vector: '[]', status: 'failed', error: message,
    } })
    return { status: 'failed' as const, error: message }
  }
}
