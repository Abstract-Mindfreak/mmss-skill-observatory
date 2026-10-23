import { db } from '@/lib/db'
import type { RoleId } from '@/lib/types'
import type { InstructionContextProvenance } from '@/lib/instruction-context'

export async function startModelCallRecord(input: {
  projectId: string
  runId?: string | null
  role: RoleId
  action: string
  versionId: string | null
  context: InstructionContextProvenance
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  backend: string
  connectionId?: string | null
  connectionName?: string | null
  requestedModel?: string | null
}) {
  const { text: _text, ...metadata } = input.context
  return db.modelCall.create({
    data: {
      projectId: input.projectId,
      runId: input.runId ?? null,
      role: input.role,
      action: input.action,
      versionId: input.versionId,
      contextMode: input.context.mode,
      contextMetadata: JSON.stringify(metadata),
      messages: JSON.stringify(input.messages),
      backend: input.backend,
      connectionId: input.connectionId ?? null,
      connectionName: input.connectionName ?? null,
      requestedModel: input.requestedModel ?? null,
      status: 'running',
    },
  })
}

export async function finishModelCallRecord(id: string, result: {
  actualProvider?: string | null
  actualModel?: string | null
  responseMetadata?: { finishReason: string | null; outputTruncated: boolean | null }
  relatedEntities?: string[]
  status?: 'completed' | 'failed' | 'cancelled'
}) {
  const existing = await db.modelCall.findUnique({ where: { id }, select: { contextMetadata: true, status: true } })
  if (!existing || existing.status !== 'running') return existing
  let contextMetadata: Record<string, unknown> = {}
  if (existing?.contextMetadata) {
    try {
      const parsed: unknown = JSON.parse(existing.contextMetadata)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) contextMetadata = parsed as Record<string, unknown>
    } catch { /* Preserve a valid write even if historical metadata is malformed. */ }
  }
  if (result.responseMetadata) contextMetadata = { ...contextMetadata, responseMetadata: result.responseMetadata }
  await db.modelCall.updateMany({
    where: { id, status: 'running' },
    data: {
      actualProvider: result.actualProvider ?? null,
      actualModel: result.actualModel ?? null,
      ...(result.responseMetadata ? { contextMetadata: JSON.stringify(contextMetadata) } : {}),
      relatedEntities: JSON.stringify(result.relatedEntities ?? []),
      status: result.status ?? 'completed',
    },
  })
  return db.modelCall.findUnique({ where: { id } })
}
