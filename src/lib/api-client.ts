// Typed API client for all backend routes. Used by the store and by studios.
// All errors are ApiError with Russian messages from the backend.

import type {
  AppStateDTO,
  AssignmentDTO,
  ChatMessageDTO,
  ConnectionDTO,
  DocumentDTO,
  DocumentVersionDTO,
  FindingDTO,
  FragmentCardDTO,
  FragmentDTO,
  GraphData,
  ImpactResult,
  MetricsBundle,
  ModelInfo,
  NoteDTO,
  ProjectDTO,
  ResearchDiscrepancyDTO,
  ResearchStateDTO,
  RemoteCheckResult,
  RunDTO,
  ScenarioDTO,
  VersionDiffDTO,
} from '@/lib/types'
import type { InstructionContextSelection } from '@/lib/instruction-context'
import type { RolePromptContext } from '@/lib/role-prompts'

export class ApiError extends Error {
  status: number
  detail?: string
  constructor(message: string, status: number, detail?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch (e) {
    throw new ApiError(
      'Сеть недоступна: не удалось обратиться к серверу приложения',
      0,
      e instanceof Error ? e.message : undefined
    )
  }
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) {
    const err = data as { error?: string; detail?: string } | null
    throw new ApiError(
      (err && typeof err === 'object' && err.error) || `Ошибка HTTP ${res.status}`,
      res.status,
      err && typeof err === 'object' ? err.detail : undefined
    )
  }
  return data as T
}

const post = <T>(path: string, body?: unknown) =>
  req<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const patch = <T>(path: string, body: unknown) =>
  req<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
const put = <T>(path: string, body: unknown) =>
  req<T>(path, { method: 'PUT', body: JSON.stringify(body) })
const del = <T>(path: string) => req<T>(path, { method: 'DELETE' })

// ---------- app ----------

export const api = {
  health: () => req<{ ok: boolean }>('/api/health'),
  processes: (projectId?: string, allProjects = false) => req<{ processes: import('@/lib/process-center').ProcessEntry[]; generatedAt: string; scope: string }>(`/api/processes?${allProjects ? 'allProjects=1' : `projectId=${encodeURIComponent(projectId ?? '')}`}`),
  processAction: (body: { projectId: string; type: string; id: string; action: string; basis?: string }) => post<Record<string, unknown>>('/api/processes', body),
  bootstrap: () => post<AppStateDTO>('/api/bootstrap'),
  getState: (projectId?: string) =>
    req<AppStateDTO>(`/api/state${projectId ? `?projectId=${projectId}` : ''}`),
  sessionCloud: () =>
    req<{ available: boolean; note: string; error?: string }>('/api/session-cloud'),
  previewRole: (body: { projectId: string; role: string; contextSelection: InstructionContextSelection; promptContext: RolePromptContext; scenarioId?: string; fragmentId?: string; findingId?: string; history?: { role: 'user' | 'assistant'; content: string }[] }) =>
    post<{ messages: { role: 'system' | 'user' | 'assistant'; content: string }[]; instruction: { mode: string; versionId: string | null; versionLabel: string | null; fullVersionSha256: string | null; fullVersionChars: number | null; selectedFragmentIds: string[]; includedFragmentIds: string[]; sentContextSha256: string | null; sentContextChars: number; text: string }; totalChars: number }>('/api/role-preview', body),

  // ---------- projects & documents ----------
  projects: () => req<ProjectDTO[]>('/api/projects'),
  createProject: (name: string, description?: string) =>
    post<ProjectDTO>('/api/projects', { name, description }),
  project: (id: string) => req<{ project: ProjectDTO; documents: DocumentDTO[] }>(`/api/projects/${id}`),
  updateProject: (id: string, body: { name?: string; description?: string; activeVersionId?: string }) =>
    patch<ProjectDTO>(`/api/projects/${id}`, body),
  deleteProject: (id: string) => del<void>(`/api/projects/${id}`),
  importDocument: (
    projectId: string,
    body: { title: string; content: string; source: 'paste' | 'upload'; knownVersion?: string; sourceUrl?: string; note?: string }
  ) => post<DocumentDTO>(`/api/projects/${projectId}/documents`, body),
  document: (id: string) => req<DocumentDTO>(`/api/documents/${id}`),

  // ---------- versions ----------
  version: (id: string) => req<{ version: DocumentVersionDTO; content: string }>(`/api/versions/${id}`),
  versionFragments: (id: string) => req<FragmentDTO[]>(`/api/versions/${id}/fragments`),
  updateVersion: (id: string, body: { label?: string; note?: string; isActive?: boolean }) =>
    patch<DocumentVersionDTO>(`/api/versions/${id}`, body),
  deleteVersion: (id: string) => del<void>(`/api/versions/${id}`),
  branchVersion: (id: string, body: { label?: string; content: string; note?: string }) =>
    post<DocumentVersionDTO>(`/api/versions/${id}/branch`, body),
  versionDiff: (id: string, other: string) =>
    req<VersionDiffDTO>(`/api/versions/${id}/diff?other=${other}`),
  analyzeVersion: (id: string) =>
    post<{ analysis: { id: string; createdAt: string; durationMs: number; fragmentCount: number }; result: unknown }>(
      `/api/versions/${id}/analyze`
    ),
  impactVersion: (id: string, newContent: string) =>
    post<ImpactResult>(`/api/versions/${id}/impact`, { newContent }),
  versionGraph: (id: string) => req<GraphData>(`/api/versions/${id}/graph`),
  semanticCodemap: (projectId: string, versionId: string, includeDiagnostics = false) =>
    req<{ positions: unknown[]; interpretations: unknown[]; includeDiagnostics: boolean }>(`/api/semantic?projectId=${projectId}&versionId=${versionId}&includeDiagnostics=${includeDiagnostics ? '1' : '0'}`),
  semanticContour: (projectId: string, versionId: string) => req<{ analysisId: string | null; state: unknown }>(`/api/semantic/contour?projectId=${projectId}&versionId=${versionId}`),
  researchState: (projectId: string, versionId: string) => req<ResearchStateDTO>(`/api/semantic/research-state?projectId=${projectId}&versionId=${versionId}`),
  researchDiscrepancies: (projectId: string, versionId: string) => req<{ discrepancies: ResearchDiscrepancyDTO[] }>(`/api/semantic/discrepancies?projectId=${projectId}&versionId=${versionId}`),
  createResearchDiscrepancy: (body: { projectId: string; versionId: string; assessment: 'different-criteria' | 'potential-contradiction' | 'insufficient-basis'; criterion: string; summary: string; runIds: string[]; observationIds?: string[]; positionIds?: string[]; fragmentIds?: string[]; evidence?: unknown[]; limitations?: string[] }) => post<ResearchDiscrepancyDTO>('/api/semantic/discrepancies', body),
  decideResearchDiscrepancy: (id: string, body: { decision: 'confirmed' | 'rejected'; note: string }) => patch<ResearchDiscrepancyDTO>(`/api/semantic/discrepancies/${id}`, body),
  runSemanticContour: (body: { action: 'start' | 'step' | 'cancel' | 'relations' | 'index-init' | 'index-step' | 'validation-init' | 'validation-step' | 'decision-flow' | 'decision-flow-update'; projectId: string; versionId: string; analysisId?: string; sourceFragmentIds?: string[]; positionIds?: string[]; caseLabel?: string; flowId?: string; flowPatch?: unknown }) => post<{ analysisId?: string; state?: unknown; flow?: unknown; error?: string }>('/api/semantic/contour', body),
  createSemanticPosition: (body: Record<string, unknown>) => post<{ position: unknown }>('/api/semantic', body),
  updateSemanticPosition: (id: string, body: Record<string, unknown>) => patch<{ position: unknown }>(`/api/semantic/positions/${id}`, body),
  createSemanticRelation: (body: Record<string, unknown>) => post<{ relation: unknown }>('/api/semantic/relations', body),
  updateSemanticRelation: (id: string, status: 'proposed' | 'accepted' | 'disputed', basis: string) => patch<{ relation: unknown }>(`/api/semantic/relations/${id}`, { status, basis }),
  createPositionObservation: (body: Record<string, unknown>) => post<{ observation: unknown }>('/api/semantic/observations', body),
  indexSemantic: (body: { projectId: string; versionId: string; items: { representation: 'functional' | 'source' | 'observation'; entityId: string }[] }) =>
    post<{ results: { entityId?: string; representation?: string; status: string; error?: string }[] }>('/api/semantic/index', body),
  searchSemantic: (body: { projectId: string; versionId: string; query: string; representation: 'functional' | 'source' | 'observation'; topK?: number; threshold?: number; includeDiagnostics?: boolean; sourceFragmentIds?: string[] }) =>
    post<{ representation: string; results: unknown[]; note?: string; error?: string; index?: { ready: number; stale: number; failed: number; missing: number } }>('/api/semantic/search', body),
  checkRemote: (id: string, url?: string) =>
    post<RemoteCheckResult>(`/api/versions/${id}/check-remote`, url ? { url } : {}),
  analyzeModel: (
    id: string,
    body: { backend: 'ollama' | 'freellmapi'; connectionId?: string; model?: string; fragmentIds: string[]; focus?: string; instructionContext?: InstructionContextSelection }
  ) =>
    post<{ analysis: { id: string }; items: { fragmentId: string; interpretation: string | null; alternatives: string[]; scopeNote: string | null; limitations: string | null; error?: string }[] }>(
      `/api/versions/${id}/analyze-model`,
      body
    ),

  // ---------- fragments & notes ----------
  fragmentCard: (id: string) => req<FragmentCardDTO>(`/api/fragments/${id}`),
  notes: (projectId: string, fragmentId?: string) =>
    req<NoteDTO[]>(`/api/projects/${projectId}/notes${fragmentId ? `?fragmentId=${fragmentId}` : ''}`),
  createNote: (body: { projectId: string; fragmentId?: string; versionId?: string; kind?: string; body: string }) =>
    post<NoteDTO>('/api/notes', body),
  updateNote: (id: string, body: { body?: string; kind?: string }) => patch<NoteDTO>(`/api/notes/${id}`, body),
  deleteNote: (id: string) => del<void>(`/api/notes/${id}`),

  // ---------- connections & assignments ----------
  connections: () => req<ConnectionDTO[]>('/api/connections'),
  createConnection: (name: string, baseUrl: string, kind: 'ollama' | 'freellmapi' = 'ollama') =>
    post<ConnectionDTO>('/api/connections', { name, baseUrl, kind }),
  updateConnection: (id: string, body: { name?: string; baseUrl?: string }) =>
    patch<ConnectionDTO>(`/api/connections/${id}`, body),
  deleteConnection: (id: string) => del<void>(`/api/connections/${id}`),
  testConnection: (id: string) =>
    post<{ ok: boolean; latencyMs?: number; modelCount?: number; error?: string }>(
      `/api/connections/${id}/test`
    ),
  refreshModels: (id: string) =>
    post<{ models: ModelInfo[]; error?: string }>(`/api/connections/${id}/models`),
  generateTest: (id: string, model: string, prompt: string) =>
    post<{ ok: boolean; output?: string; durationMs?: number; tokensIn?: number; tokensOut?: number; error?: string }>(
      `/api/connections/${id}/generate-test`,
      { model, prompt }
    ),
  embedTest: (id: string, model: string, text: string) =>
    post<{ ok: boolean; dimensions?: number; preview?: number[]; durationMs?: number; via?: string; error?: string }>(
      `/api/connections/${id}/embed-test`,
      { model, text }
    ),
  assignments: (projectId: string) =>
    req<AssignmentDTO[]>(`/api/assignments?projectId=${projectId}`),
  putAssignment: (body: {
    projectId: string
    role: string
    backend: 'ollama' | 'freellmapi' | null
    connectionId?: string
    model?: string
  }) => put<AssignmentDTO>('/api/assignments', body),

  // ---------- runs ----------
  runs: (projectId: string, limit = 200) =>
    req<RunDTO[]>(`/api/runs?projectId=${projectId}&limit=${limit}`),
  createRun: (body: {
    projectId: string
    role: string
    backend: 'ollama' | 'freellmapi'
    action?: string
    scenarioId?: string
    versionId?: string
    fragmentId?: string
    skillContextMode?: 'full' | 'relevant'
    connectionId?: string
    model?: string
    prompt?: string
    settings?: { temperature?: number; numPredict?: number; timeoutMs?: number; programChecks?: boolean }
    taskContext?: { scenarioId?: string; versionId?: string; criterion?: string; outputToEvaluate?: string; findingId?: string; fragmentId?: string; skillContextMode?: 'full' | 'relevant'; instructionContext?: InstructionContextSelection }
    series?: { count: number }
  }) => post<{ runs: RunDTO[] }>('/api/runs', body),
  run: (id: string) => req<RunDTO>(`/api/runs/${id}`),
  cancelRun: (id: string) => post<RunDTO>(`/api/runs/${id}/cancel`),
  retryRun: (id: string) => post<{ run: RunDTO }>(`/api/runs/${id}/retry`),
  setRunVerdict: (id: string, verdict: 'pass' | 'fail' | 'inconclusive') =>
    put<RunDTO>(`/api/runs/${id}/verdict`, { verdict }),

  // ---------- scenarios ----------
  scenarios: (projectId: string) => req<ScenarioDTO[]>(`/api/projects/${projectId}/scenarios`),
  createScenario: (
    projectId: string,
    body: { parentId?: string; title: string; description?: string; fragmentId?: string; status?: string }
  ) => post<ScenarioDTO>(`/api/projects/${projectId}/scenarios`, body),
  updateScenario: (
    id: string,
    body: { title?: string; description?: string; status?: string; stopReason?: string; pinned?: boolean; fragmentId?: string }
  ) => patch<ScenarioDTO>(`/api/scenarios/${id}`, body),
  deleteScenario: (id: string) => del<void>(`/api/scenarios/${id}`),
  suggestScenarios: (
    id: string,
    body: { backend: 'ollama' | 'freellmapi'; connectionId?: string; model?: string; count: number; contextSelection?: InstructionContextSelection }
  ) =>
    post<{ created: ScenarioDTO[]; raw: string; backend: string; model: string | null }>(
      `/api/scenarios/${id}/suggest`,
      body
    ),

  // ---------- chat & demo ----------
  chat: (projectId: string) => req<ChatMessageDTO[]>(`/api/projects/${projectId}/chat`),
  sendChat: (
    projectId: string,
    body: { content: string; contextFragmentId?: string; instructionContext?: InstructionContextSelection; backend: 'ollama' | 'freellmapi'; connectionId?: string; model?: string }
  ) =>
    post<{ messages: ChatMessageDTO[]; error?: string; saved?: boolean }>(
      `/api/projects/${projectId}/chat`,
      body
    ),
  seedDemo: (projectId: string) =>
    post<{ counts: { scenarios: number; runs: number; findings: number; notes: number }; note?: string }>(
      `/api/projects/${projectId}/demo`
    ),
  purgeDemo: (projectId: string) =>
    del<{ counts: { scenarios: number; runs: number; findings: number; notes: number } }>(
      `/api/projects/${projectId}/demo`
    ),

  // ---------- metrics & export ----------
  metrics: (projectId: string, versionId?: string) =>
    req<MetricsBundle>(`/api/projects/${projectId}/metrics${versionId ? `?versionId=${versionId}` : ''}`),
  importArchive: (archive: unknown) =>
    post<{ project: ProjectDTO; warnings: string[] }>('/api/import', archive),
}

// ---------- file download helper ----------

export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(path)
  } catch {
    throw new ApiError('Сеть недоступна: не удалось скачать файл', 0)
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const j = (await res.json()) as { error?: string }
      if (j.error) detail = j.error
    } catch {
      /* ignore */
    }
    throw new ApiError(`Экспорт недоступен: ${detail}`, res.status)
  }
  const blob = await res.blob()
  const dispo = res.headers.get('content-disposition') ?? ''
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(dispo)
  const name = match ? decodeURIComponent(match[1].replace(/"/g, '')) : fallbackName
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function exportUrl(projectId: string, format: 'md' | 'json' | 'csv', parts: string): string {
  return `/api/projects/${projectId}/export?format=${format}&parts=${parts}`
}
export function handoffUrl(projectId: string, format: 'md' | 'json', parts: string, includeFullSkillText = false): string {
  return `/api/projects/${projectId}/handoff?format=${format}&parts=${parts}&includeFullSkillText=${includeFullSkillText ? '1' : '0'}`
}
export function graphExportUrl(projectId: string, versionId: string, format: 'json' | 'md' | 'txt'): string {
  return `/api/projects/${projectId}/graph-export?versionId=${versionId}&format=${format}`
}
