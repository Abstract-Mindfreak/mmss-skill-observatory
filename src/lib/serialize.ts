// Shared Prisma-row -> DTO serializers. Owned by the main agent; import freely.
// All JSON-in-String fields are parsed safely with fallbacks.

import { createHash } from 'crypto'
import type {
  AssignmentDTO,
  ChatMessageDTO,
  ConnectionDTO,
  DocumentVersionDTO,
  EvidenceChain,
  FindingDTO,
  FragmentDTO,
  ModelInfo,
  NoteDTO,
  ProjectDTO,
  RoleId,
  RunDTO,
  RunInputDTO,
  RunStatus,
  ScenarioDTO,
  ScenarioStatus,
  Verdict,
  VerdictBy,
} from '@/lib/types'
import type {
  Analysis,
  ChatMessage,
  Connection,
  Document,
  DocumentVersion,
  Finding,
  Fragment,
  Note,
  Project,
  Run,
  Scenario,
} from '@prisma/client'

export function safeParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export function toProjectDTO(p: Project): ProjectDTO {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    origin: p.origin,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }
}

export function toFragmentDTO(f: Fragment): FragmentDTO {
  return {
    id: f.id,
    versionId: f.versionId,
    kind: f.kind as FragmentDTO['kind'],
    path: f.path,
    order: f.order,
    title: f.title,
    text: f.text,
    startLine: f.startLine,
    endLine: f.endLine,
    meta: safeParse<FragmentDTO['meta']>(f.meta, {}),
  }
}

export function toVersionDTO(
  v: DocumentVersion,
  extra?: Partial<DocumentVersionDTO>
): DocumentVersionDTO {
  return {
    id: v.id,
    documentId: v.documentId,
    projectId: v.projectId,
    label: v.label,
    kind: v.kind,
    source: v.source,
    sourceUrl: v.sourceUrl,
    knownVersion: v.knownVersion,
    completeness: v.completeness,
    contentHash: v.contentHash,
    contentLength: v.content.length,
    lineCount: v.content.split('\n').length,
    parentVersionId: v.parentVersionId,
    note: v.note,
    importDate: v.importDate.toISOString(),
    isActive: v.isActive,
    fragmentCount: 0,
    hasLocalAnalysis: false,
    lastAnalysisAt: null,
    childCount: 0,
    ...extra,
  }
}

export function toNoteDTO(n: Note): NoteDTO {
  return {
    id: n.id,
    projectId: n.projectId,
    versionId: n.versionId,
    fragmentId: n.fragmentId,
    kind: n.kind as NoteDTO['kind'],
    body: n.body,
    author: n.author,
    origin: n.origin as NoteDTO['origin'],
    linkedRunId: n.linkedRunId,
    createdAt: n.createdAt.toISOString(),
  }
}

export function toScenarioDTO(
  s: Scenario,
  extra?: { runCount?: number; lastRunStatus?: RunStatus | null }
): ScenarioDTO {
  return {
    id: s.id,
    projectId: s.projectId,
    parentId: s.parentId,
    title: s.title,
    description: s.description,
    status: s.status as ScenarioStatus,
    stopReason: s.stopReason,
    origin: s.origin as ScenarioDTO['origin'],
    fragmentId: s.fragmentId,
    generationMetadata: safeParse(s.generationMetadata, null),
    pinned: s.pinned,
    order: s.order,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    runCount: extra?.runCount ?? 0,
    lastRunStatus: extra?.lastRunStatus ?? null,
  }
}

export function toRunDTO(r: Run): RunDTO {
  const parsedInput = safeParse<
    (RunInputDTO & { programChecks?: RunDTO['programChecks'] }) | null
  >(r.input, null)
  return {
    id: r.id,
    projectId: r.projectId,
    scenarioId: r.scenarioId,
    versionId: r.versionId,
    parentRunId: r.parentRunId,
    role: r.role as RoleId,
    backend: r.backend as RunDTO['backend'],
    connectionId: r.connectionId,
    connectionName: r.backend === 'freellmapi' ? r.connectionName?.replace(/^FreeLLMAPI:\s*/, '') ?? null : r.connectionName,
    model: r.model,
    status: r.status as RunStatus,
    input: parsedInput,
    output: r.output,
    error: r.error,
    verdict: (r.verdict as Verdict | null) ?? null,
    verdictBy: (r.verdictBy as VerdictBy | null) ?? null,
    modelVerdict: (r.modelVerdict as Verdict | null) ?? null,
    modelVerdictBy: (r.modelVerdictBy as VerdictBy | null) ?? null,
    durationMs: r.durationMs,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    origin: r.origin as RunDTO['origin'],
    createdAt: r.createdAt.toISOString(),
    startedAt: r.startedAt ? r.startedAt.toISOString() : null,
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    programChecks: parsedInput?.programChecks ?? [],
  }
}

export function toFindingDTO(f: Finding): FindingDTO {
  return {
    id: f.id,
    projectId: f.projectId,
    versionId: f.versionId,
    fragmentId: f.fragmentId,
    scenarioId: f.scenarioId,
    runId: f.runId,
    title: f.title,
    description: f.description,
    severity: f.severity as FindingDTO['severity'],
    status: f.status as FindingDTO['status'],
    provenance: f.provenance,
    origin: f.origin as FindingDTO['origin'],
    evidence: safeParse<EvidenceChain | null>(f.evidence, null),
    createdAt: f.createdAt.toISOString(),
  }
}

export function toConnectionDTO(c: Connection): ConnectionDTO {
  return {
    id: c.id,
    projectId: c.projectId,
    name: c.name,
    kind: c.kind,
    baseUrl: c.baseUrl,
    status: c.status as ConnectionDTO['status'],
    lastError: c.lastError,
    lastCheckAt: c.lastCheckAt ? c.lastCheckAt.toISOString() : null,
    models: safeParse<ModelInfo[]>(c.models, []),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }
}

export function toChatMessageDTO(m: ChatMessage): ChatMessageDTO {
  return {
    id: m.id,
    role: m.role as 'user' | 'assistant',
    content: m.content,
    backend: m.backend,
    connectionName: m.connectionName,
    model: m.model,
    responseMetadata: safeParse(m.responseMetadata, null),
    contextFragmentId: m.contextFragmentId,
    createdAt: m.createdAt.toISOString(),
  }
}

export function analysisMeta(a: Analysis): {
  id: string
  versionId: string
  type: string
  backend: string
  model: string | null
  status: string
  summary: string
  fragmentCount: number | null
  createdAt: string
} {
  return {
    id: a.id,
    versionId: a.versionId,
    type: a.type,
    backend: a.backend,
    model: a.model,
    status: a.status,
    summary: a.summary,
    fragmentCount: a.fragmentCount,
    createdAt: a.createdAt.toISOString(),
  }
}

export type { Document, DocumentVersion }
