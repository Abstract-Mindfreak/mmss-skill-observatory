// ============================================================
// Exporters (owner: agent 1-c).
// ProjectArchive (json) / Markdown report / CSV tables /
// Research Handoff Report / self-contained graph export.
// Connections are NEVER included in exports (connectionsIncluded=false).
// Demo data is kept in the archive (full fidelity) but excluded
// from the Research Handoff Report and from metrics.
// ============================================================

import { db } from '@/lib/db'
import { cleanRunSkillText } from '@/lib/run-context-cleaner'
import { parseResearchDiscrepancy } from '@/lib/research-discrepancy'
import {
  sha256Hex,
  safeParse,
  toChatMessageDTO,
  toFindingDTO,
  toNoteDTO,
  toProjectDTO,
  toRunDTO,
  toScenarioDTO,
  toVersionDTO,
} from '@/lib/serialize'
import type {
  AssignmentDTO,
  ChatMessageDTO,
  DocumentVersionDTO,
  EvidenceChain,
  FindingDTO,
  GraphEdge,
  GraphEdgeKind,
  GraphNode,
  GraphNodeKind,
  HandoffSection,
  NoteDTO,
  ProjectArchive,
  RunDTO,
  RunStatus,
  ScenarioDTO,
} from '@/lib/types'
import {
  GRAPH_EDGE_KIND_TITLES,
  GRAPH_NODE_KIND_TITLES,
  PLACEHOLDER_REGISTRY,
  SCENARIO_STATUS_TITLES,
} from '@/lib/types'
import type {
  Analysis,
  Document,
  DocumentVersion,
  Fragment,
  Project,
  Run,
  Scenario,
} from '@prisma/client'

const campaignExportInclude = {
  roles: true,
  items: {
    include: {
      position: true,
      notApplicableChecks: true,
      checks: { include: { scenario: true, sources: { include: { fragment: true } } } },
      actions: { include: { run: true, sources: { include: { fragment: true } } } },
    },
  },
  actions: { include: { run: true, sources: { include: { fragment: true } } } },
} satisfies import('@prisma/client').Prisma.ResearchCampaignInclude
type CampaignExport = import('@prisma/client').Prisma.ResearchCampaignGetPayload<{ include: typeof campaignExportInclude }>

// ---------- part catalogs ----------

export const ARCHIVE_PARTS = [
  'documents',
  'scenarios',
  'runs',
  'findings',
  'notes',
  'analyses',
  'assignments',
  'chat',
  'semantic',
  'campaigns',
] as const

export const HANDOFF_PARTS = [
  'goal',
  'document',
  'changes',
  'analyses',
  'runs',
  'runs-full',
  'findings',
  'evidence',
  'disputed',
  'discrepancies',
  'hypotheses',
  'errors',
  'limitations',
  'placeholders',
  'next-steps',
  'campaigns',
] as const

export type ArchivePart = (typeof ARCHIVE_PARTS)[number]
export type HandoffPart = (typeof HANDOFF_PARTS)[number]

/** Parse ?parts= — 'all' expands to allExpansion (defaults to valid); throws Error(RU) on unknown part. */
export function parsePartsParam(
  raw: string | null,
  valid: readonly string[],
  allExpansion: readonly string[] = valid
): string[] {
  const tokens = (raw ?? 'all')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (tokens.length === 0) tokens.push('all')
  if (tokens.includes('all')) return [...allExpansion]
  const invalid = tokens.filter((t) => !valid.includes(t))
  if (invalid.length > 0) {
    throw new Error(
      `Недопустимые части экспорта: ${invalid.join(', ')}. Доступны: all, ${valid.join(', ')}`
    )
  }
  return tokens
}

// ---------- text helpers ----------

const RU_TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
}

/** ASCII filename slug with RU transliteration. */
export function projectSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .split('')
    .map((ch) => RU_TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'project'
}

/** Escape a value for a markdown table cell. */
function mdCell(value: unknown): string {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim()
}

/** Quote a value for CSV (RFC 4180, comma-separated). */
function csvCell(value: unknown): string {
  return '"' + String(value ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"'
}

function shortHash(hash: string | null | undefined): string {
  return (hash ?? '').slice(0, 10)
}

function topPath(path: string): string {
  return path.split('.')[0] ?? path
}

function mdTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((r) => `| ${r.map(mdCell).join(' | ')} |`).join('\n')
  return [head, sep, body].join('\n')
}

// RU title maps for reports
const RUN_STATUS_RU: Record<string, string> = {
  planned: 'запланирован',
  queued: 'в очереди',
  running: 'выполняется',
  completed: 'завершён',
  cancelled: 'отменён',
  failed: 'ошибка',
}
const VERDICT_RU: Record<string, string> = {
  pass: 'pass (пройден)',
  fail: 'fail (не пройден)',
  inconclusive: 'inconclusive (неопределённый)',
}
const SEVERITY_RU: Record<string, string> = {
  info: 'инфо',
  warning: 'предупреждение',
  issue: 'проблема',
}
const FINDING_STATUS_RU: Record<string, string> = {
  hypothesis: 'гипотеза',
  supported: 'подтверждена',
  disputed: 'оспорена',
  rejected: 'отклонена',
}
const NOTE_KIND_RU: Record<string, string> = {
  note: 'заметка',
  interpretation: 'интерпретация',
  objection: 'возражение',
  'user-verdict': 'вердикт пользователя',
  todo: 'задача',
}
const EVIDENCE_STEP_RU: Record<string, string> = {
  fragment: 'фрагмент',
  criterion: 'критерий',
  scenario: 'сценарий',
  'run-input': 'вход запуска',
  'executor-output': 'ответ исполнителя',
  'evaluator-conclusion': 'заключение проверяющего',
  objection: 'возражение',
  note: 'заметка',
  assumption: 'допущение',
  'program-check': 'программная проверка',
}
const EVIDENCE_STEP_STATUS_RU: Record<string, string> = {
  present: 'есть',
  missing: 'отсутствует',
  partial: 'частично',
}
const DISTINCTION_RU: Record<string, string> = {
  observation: 'наблюдение',
  inference: 'вывод',
  assumption: 'допущение',
  'new-requirement': 'новое требование',
  'model-evaluation': 'модельная оценка',
  'executed-check': 'выполненная проверка',
  'unverified-hypothesis': 'непроверенная гипотеза',
}

// ---------- shared data loader ----------

interface ExportData {
  project: Project
  documents: (Document & { versions: DocumentVersion[] })[]
  scenarios: Scenario[]
  runs: Run[]
  findings: (FindingRow)[]
  notes: NoteRow[]
  assignments: { role: string; backend: string | null; connectionId: string | null; model: string | null }[]
  chatMessages: ChatRow[]
  analyses: Analysis[]
  fragments: Fragment[]
  modelCalls: Awaited<ReturnType<typeof db.modelCall.findMany>>
  semanticPositions: Awaited<ReturnType<typeof db.semanticPosition.findMany>>
  semanticRelations: Awaited<ReturnType<typeof db.semanticRelation.findMany>>
  positionObservations: Awaited<ReturnType<typeof db.positionObservation.findMany>>
  semanticLinks: Awaited<ReturnType<typeof db.semanticPositionFragment.findMany>>
  campaigns: CampaignExport[]
}

type FindingRow = {
  id: string
  projectId: string
  versionId: string | null
  fragmentId: string | null
  scenarioId: string | null
  runId: string | null
  title: string
  description: string
  severity: string
  status: string
  provenance: string
  origin: string
  evidence: string
  createdAt: Date
}
type NoteRow = {
  id: string
  projectId: string
  versionId: string | null
  fragmentId: string | null
  kind: string
  body: string
  author: string
  origin: string
  linkedRunId: string | null
  createdAt: Date
}
type ChatRow = {
  id: string
  projectId: string
  role: string
  content: string
  backend: string | null
  connectionName: string | null
  model: string | null
  responseMetadata: string | null
  contextFragmentId: string | null
  createdAt: Date
}

async function loadExportData(projectId: string): Promise<ExportData | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      documents: { include: { versions: true } },
      scenarios: true,
      runs: true,
      findings: true,
      notes: true,
      assignments: true,
      chatMessages: true,
      modelCalls: true,
    },
  })
  if (!project) return null
  const analyses = await db.analysis.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
  })
  const fragments = await db.fragment.findMany({
    where: { version: { projectId } },
  })
  const [semanticPositions, semanticRelations, positionObservations, semanticLinks, campaigns] = await Promise.all([
    db.semanticPosition.findMany({ where: { projectId } }),
    db.semanticRelation.findMany({ where: { projectId } }),
    db.positionObservation.findMany({ where: { projectId } }),
    db.semanticPositionFragment.findMany({ where: { semanticPosition: { projectId } } }),
    db.researchCampaign.findMany({ where: { projectId }, include: campaignExportInclude, orderBy: { createdAt: 'asc' } }),
  ])
  return {
    project,
    documents: project.documents,
    scenarios: project.scenarios,
    runs: project.runs,
    findings: project.findings,
    notes: project.notes,
    assignments: project.assignments,
    chatMessages: project.chatMessages,
    analyses,
    fragments,
    modelCalls: project.modelCalls,
    semanticPositions,
    semanticRelations,
    positionObservations,
    semanticLinks,
    campaigns,
  }
}

function versionExtras(data: ExportData, v: DocumentVersion): Partial<DocumentVersionDTO> {
  const versionAnalyses = data.analyses.filter((a) => a.versionId === v.id)
  const local = versionAnalyses.filter((a) => a.type === 'local-structural')
  return {
    fragmentCount: data.fragments.filter((f) => f.versionId === v.id).length,
    hasLocalAnalysis: local.length > 0,
    lastAnalysisAt: versionAnalyses.length
      ? versionAnalyses.map((a) => a.createdAt.toISOString()).sort().at(-1) ?? null
      : null,
    childCount: data.documents
      .flatMap((d) => d.versions)
      .filter((x) => x.parentVersionId === v.id).length,
  }
}

// ============================================================
// JSON archive
// ============================================================

export async function buildProjectArchive(
  projectId: string,
  parts: string[]
): Promise<ProjectArchive | null> {
  const data = await loadExportData(projectId)
  if (!data) return null
  const include = new Set(parts)
  const has = (p: string) => include.has(p)

  const connectionIds = [
    ...new Set(
      data.assignments
        .map((a) => a.connectionId)
        .filter((x): x is string => Boolean(x))
    ),
  ]
  const connections = connectionIds.length
    ? await db.connection.findMany({ where: { id: { in: connectionIds } } })
    : []
  const connName = new Map(connections.map((c) => [c.id, c.name]))

  const runCountByScenario = new Map<string, number>()
  const lastRunByScenario = new Map<string, Run>()
  for (const r of data.runs) {
    if (!r.scenarioId) continue
    runCountByScenario.set(r.scenarioId, (runCountByScenario.get(r.scenarioId) ?? 0) + 1)
    const prev = lastRunByScenario.get(r.scenarioId)
    if (!prev || r.createdAt > prev.createdAt) lastRunByScenario.set(r.scenarioId, r)
  }

  const archive: ProjectArchive = {
    format: 'mmss-observatory-archive',
    archiveVersion: 1,
    exportedAt: new Date().toISOString(),
    project: {
      ...toProjectDTO(data.project),
      documents: has('documents')
        ? data.documents.map((doc) => ({
            id: doc.id,
            projectId: doc.projectId,
            title: doc.title,
            createdAt: doc.createdAt.toISOString(),
            versions: doc.versions
              .sort((a, b) => a.importDate.getTime() - b.importDate.getTime())
              .map((v) => ({
                ...toVersionDTO(v, versionExtras(data, v)),
                content: v.content,
              })),
          }))
        : [],
      scenarios: has('scenarios')
        ? data.scenarios.map((s) =>
            toScenarioDTO(s, {
              runCount: runCountByScenario.get(s.id) ?? 0,
              lastRunStatus: (lastRunByScenario.get(s.id)?.status as RunStatus | undefined) ?? null,
            })
          )
        : [],
      runs: has('runs') ? data.runs.map((r) => toRunDTO(r)) : [],
      findings: has('findings') ? data.findings.map((f) => toFindingDTO(f)) : [],
      notes: has('notes') ? data.notes.map((n) => toNoteDTO(n)) : [],
      assignments: has('assignments')
        ? data.assignments.map<AssignmentDTO>((a) => ({
            role: a.role as AssignmentDTO['role'],
            backend: (a.backend as AssignmentDTO['backend']) ?? null,
            connectionId: a.connectionId,
            connectionName: a.connectionId ? connName.get(a.connectionId) ?? null : null,
            model: a.model,
          }))
        : [],
      chatMessages: has('chat') ? data.chatMessages.map((m) => toChatMessageDTO(m)) : [],
      analyses: has('analyses')
        ? data.analyses.map((a) => ({
            id: a.id,
            versionId: a.versionId,
            type: a.type,
            backend: a.backend,
            model: a.model,
            status: a.status,
            summary: a.summary,
            result: safeParse<unknown>(a.result, null),
            createdAt: a.createdAt.toISOString(),
          }))
        : [],
      modelCalls: has('runs') || has('analyses') || has('chat') ? data.modelCalls.map((call) => ({
        id: call.id, runId: call.runId, versionId: call.versionId, role: call.role, action: call.action, contextMode: call.contextMode,
        contextMetadata: safeParse<unknown>(call.contextMetadata, null), messages: safeParse<unknown>(call.messages, null),
        backend: call.backend, connectionName: call.connectionName, requestedModel: call.requestedModel,
        actualProvider: call.actualProvider, actualModel: call.actualModel, status: call.status,
        relatedEntities: safeParse<unknown>(call.relatedEntities, []), createdAt: call.createdAt.toISOString(),
      })) : [],
      fragmentRefs: has('documents') ? data.fragments.map((fragment) => ({
        id: fragment.id, versionId: fragment.versionId, path: fragment.path, textHash: sha256Hex(fragment.text),
      })) : [],
      semanticIndexPolicy: 'rebuild-on-import',
      semanticPositions: has('semantic') && has('documents') ? data.semanticPositions.map((position) => ({
        id: position.id, versionId: position.versionId, title: position.title, purpose: position.purpose,
        regulatedDecision: position.regulatedDecision, conditions: position.conditions,
        expectedBehavior: position.expectedBehavior, limitations: position.limitations,
        provenance: position.provenance, provenanceRef: position.provenanceRef,
        sourceFragmentRefs: safeParse<unknown>(position.sourceFragmentRefs, []),
        status: position.status, createdAt: position.createdAt.toISOString(), updatedAt: position.updatedAt.toISOString(),
        fragments: data.semanticLinks.filter((link) => link.semanticPositionId === position.id).flatMap((link) => {
          const fragment = data.fragments.find((item) => item.id === link.fragmentId)
          return fragment ? [{ id: fragment.id, path: fragment.path, textHash: sha256Hex(fragment.text) }] : []
        }),
      })) : [],
      semanticRelations: has('semantic') && has('documents') ? data.semanticRelations.map((relation) => ({
        id: relation.id, versionId: relation.versionId, sourcePositionId: relation.sourcePositionId,
        targetPositionId: relation.targetPositionId, kind: relation.kind, rationale: relation.rationale,
        provenance: relation.provenance, status: relation.status, createdAt: relation.createdAt.toISOString(),
      })) : [],
      positionObservations: has('semantic') && has('documents') ? data.positionObservations.map((observation) => ({
        id: observation.id, versionId: observation.versionId, positionId: observation.positionId,
        runId: observation.runId, noteId: observation.noteId, observation: observation.observation,
        evidenceText: observation.evidenceText, conditions: observation.conditions, criterion: observation.criterion,
        status: observation.status, limitations: observation.limitations, createdAt: observation.createdAt.toISOString(),
      })) : [],
      researchCampaigns: has('campaigns') ? data.campaigns.map((campaign) => ({
        ...campaign,
        budgetHistory: safeParse<unknown[]>(campaign.budgetHistory, []),
        items: campaign.items.map((item) => ({
          ...item,
          checks: item.checks.map((check) => ({ ...check, sources: check.sources.map((source) => ({ id: source.id, fragmentId: source.fragmentId })) })),
          actions: item.actions.map((action) => ({ ...action, run: undefined, sources: action.sources.map((source) => ({ id: source.id, fragmentId: source.fragmentId })) })),
        })),
        actions: campaign.actions.map((action) => ({
          ...action, runId: action.run?.id ?? null, run: undefined,
          sources: action.sources.map((source) => ({ id: source.id, fragmentId: source.fragmentId })),
        })),
      })) : [],
      connectionsIncluded: false,
    },
  }
  return archive
}

// ============================================================
// Markdown report
// ============================================================

export async function buildMarkdownReport(
  projectId: string,
  parts: string[]
): Promise<string | null> {
  const data = await loadExportData(projectId)
  if (!data) return null
  const include = new Set(parts)
  const has = (p: string) => include.has(p)
  const out: string[] = []

  const fragById = new Map(data.fragments.map((f) => [f.id, f]))
  const fmtDate = (d: Date) => d.toISOString()

  out.push(`# Экспорт проекта — ${data.project.name}`, '')
  out.push(`- **Дата экспорта:** ${new Date().toISOString()}`)
  out.push(`- **Происхождение проекта:** ${data.project.origin}`)
  if (data.project.description) out.push(`- **Описание:** ${data.project.description}`)
  for (const doc of data.documents) {
    const active = doc.versions.find((v) => v.isActive) ?? doc.versions.at(-1)
    out.push(
      `- **Документ:** ${doc.title}${active ? ` — версия «${active.label}» (hash \`${shortHash(active.contentHash)}\`${active.isActive ? ', активная' : ''})` : ' — версий нет'}`
    )
  }
  out.push('')

  if (has('documents')) {
    out.push('## Документы и версии', '')
    const rows = data.documents.flatMap((doc) =>
      doc.versions
        .sort((a, b) => a.importDate.getTime() - b.importDate.getTime())
        .map((v) => [
          v.label,
          v.kind,
          v.source,
          v.knownVersion ?? '—',
          `\`${shortHash(v.contentHash)}\``,
          v.isActive ? 'да' : 'нет',
          String(versionExtras(data, v).fragmentCount ?? 0),
        ])
    )
    out.push(mdTable(['Версия', 'Тип', 'Источник', 'Известная версия', 'Hash', 'Активная', 'Фрагментов'], rows))
    out.push('')
  }

  if (has('scenarios')) {
    out.push('## Сценарии', '')
    if (data.scenarios.length === 0) {
      out.push('_Сценариев нет._', '')
    } else {
      const children = new Map<string | null, Scenario[]>()
      for (const s of data.scenarios) {
        const list = children.get(s.parentId) ?? []
        list.push(s)
        children.set(s.parentId, list)
      }
      const render = (parentId: string | null, depth: number) => {
        for (const s of (children.get(parentId) ?? []).sort((a, b) => a.order - b.order || a.createdAt.getTime() - b.createdAt.getTime())) {
          const demo = s.origin === 'demo' ? ' **[DEMO]**' : ''
          const frag = s.fragmentId ? fragById.get(s.fragmentId) : undefined
          const fragInfo = frag ? ` (§${frag.path})` : ''
          out.push(
            `${'  '.repeat(depth)}- ${s.title} — ${SCENARIO_STATUS_TITLES[s.status as ScenarioDTO['status']]}${fragInfo}${demo}`
          )
          render(s.id, depth + 1)
        }
      }
      render(null, 0)
      out.push('')
    }
  }

  if (has('runs')) {
    out.push('## Запуски', '')
    if (data.runs.length === 0) {
      out.push('_Запусков нет._', '')
    } else {
      const rows = [...data.runs]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((r) => [
          fmtDate(r.createdAt),
          r.role,
          `${r.backend}${r.model ? ` / ${r.model}` : ''}`,
          RUN_STATUS_RU[r.status] ?? r.status,
          r.verdict ? VERDICT_RU[r.verdict] ?? r.verdict : '—',
          r.durationMs !== null ? String(r.durationMs) : '—',
          r.origin === 'demo' ? 'DEMO' : '',
        ])
      out.push(mdTable(['Дата', 'Роль', 'Backend / модель', 'Статус', 'Вердикт', 'Время, мс', ''], rows))
      out.push('')
    }
  }

  if (has('findings')) {
    out.push('## Находки', '')
    if (data.findings.length === 0) {
      out.push('_Находок нет._', '')
    } else {
      const rows = [...data.findings]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((f) => [
          f.title,
          SEVERITY_RU[f.severity] ?? f.severity,
          FINDING_STATUS_RU[f.status] ?? f.status,
          f.fragmentId ? (fragById.get(f.fragmentId)?.path ?? '—') : '—',
          f.origin === 'demo' ? 'DEMO' : '',
        ])
      out.push(mdTable(['Название', 'Важность', 'Статус', 'Фрагмент', ''], rows))
      out.push('')
    }
  }

  if (has('notes')) {
    out.push('## Заметки', '')
    if (data.notes.length === 0) {
      out.push('_Заметок нет._', '')
    } else {
      for (const n of [...data.notes].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
        const frag = n.fragmentId ? fragById.get(n.fragmentId) : undefined
        out.push(
          `- **${fmtDate(n.createdAt)}** · ${NOTE_KIND_RU[n.kind] ?? n.kind} · ${n.author}${frag ? ` · §${frag.path}` : ''}${n.origin === 'demo' ? ' · DEMO' : ''}: ${n.body.replace(/\r?\n/g, ' ')}`
        )
      }
      out.push('')
    }
  }

  if (has('analyses')) {
    out.push('## Анализы', '')
    if (data.analyses.length === 0) {
      out.push('_Анализов нет._', '')
    } else {
      const rows = data.analyses.map((a) => [
        fmtDate(a.createdAt),
        a.type,
        a.backend,
        a.model ?? '—',
        a.status,
        a.summary,
      ])
      out.push(mdTable(['Дата', 'Тип', 'Backend', 'Модель', 'Статус', 'Сводка'], rows))
      out.push('')
    }
  }

  if (has('assignments')) {
    out.push('## Назначения моделей', '')
    if (data.assignments.length === 0) {
      out.push('_Назначений нет._', '')
    } else {
      const rows = data.assignments.map((a) => [a.role, a.backend ?? '—', a.model ?? '—'])
      out.push(mdTable(['Роль', 'Backend', 'Модель'], rows))
      out.push('')
    }
  }

  if (has('chat')) {
    out.push('## Чат с помощником', '')
    if (data.chatMessages.length === 0) {
      out.push('_Сообщений нет._', '')
    } else {
      for (const m of data.chatMessages) {
        out.push(`- **${m.role === 'user' ? 'Пользователь' : 'Помощник'}** (${fmtDate(m.createdAt)}${m.model ? `, ${m.model}` : ''}): ${m.content.replace(/\r?\n/g, ' ')}`)
      }
      out.push('')
    }
  }

  out.push('---')
  out.push('_Подключения (адреса серверов) в экспорт не включаются. DEMO-данные помечены и в метрики не входят._')
  return out.join('\n') + '\n'
}

// ============================================================
// CSV export
// ============================================================

export async function buildCsvExport(
  projectId: string,
  parts: string[]
): Promise<string | null> {
  const data = await loadExportData(projectId)
  if (!data) return null
  const include = new Set(parts)
  const out: string[] = []
  const fmtDate = (d: Date) => d.toISOString()

  const emit = (section: string, headers: string[], rows: string[][]) => {
    out.push(`# --- ${section} ---`)
    out.push(headers.map(csvCell).join(','))
    for (const row of rows) out.push(row.map(csvCell).join(','))
    out.push('')
  }

  if (include.has('scenarios')) {
    const parentTitle = new Map<string, string>()
    for (const s of data.scenarios) parentTitle.set(s.id, s.title)
    emit(
      'scenarios',
      ['id', 'title', 'status', 'origin', 'parentTitle'],
      data.scenarios.map((s) => [
        s.id,
        s.title,
        s.status,
        s.origin,
        s.parentId ? parentTitle.get(s.parentId) ?? '' : '',
      ])
    )
  }
  if (include.has('runs')) {
    emit(
      'runs',
      ['id', 'createdAt', 'role', 'backend', 'model', 'status', 'verdict', 'verdictBy', 'durationMs', 'scenarioId'],
      [...data.runs]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((r) => [
          r.id,
          fmtDate(r.createdAt),
          r.role,
          r.backend,
          r.model ?? '',
          r.status,
          r.verdict ?? '',
          r.verdictBy ?? '',
          r.durationMs !== null ? String(r.durationMs) : '',
          r.scenarioId ?? '',
        ])
    )
  }
  if (include.has('findings')) {
    emit(
      'findings',
      ['id', 'createdAt', 'title', 'severity', 'status', 'provenance', 'fragmentId'],
      [...data.findings]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((f) => [
          f.id,
          fmtDate(f.createdAt),
          f.title,
          f.severity,
          f.status,
          f.provenance,
          f.fragmentId ?? '',
        ])
    )
  }
  if (include.has('notes')) {
    emit(
      'notes',
      ['id', 'createdAt', 'kind', 'author', 'fragmentId', 'body'],
      [...data.notes]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((n) => [n.id, fmtDate(n.createdAt), n.kind, n.author, n.fragmentId ?? '', n.body])
    )
  }

  if (out.length === 0) {
    out.push('# --- нет данных для выбранного набора частей ---', '')
  }
  out.push('# Пояснение: секции разделены строками "# --- <имя> ---". Соединения в экспорт не включаются.')
  return '\ufeff' + out.join('\n')
}

// ============================================================
// Research Handoff Report
// ============================================================

export interface HandoffReportJson {
  title: string
  generatedAt: string
  project: { id: string; name: string; description: string | null; origin: string }
  demoExcluded: boolean
  parts: HandoffSection[]
  sections: Record<string, unknown>
}

interface HandoffModel {
  goal: { description: string; summary: string }
  document: {
    documents: {
      title: string
      versions: {
        label: string
        kind: string
        source: string
        sourceUrl: string | null
        knownVersion: string | null
        completeness: string
        contentHash: string
        isActive: boolean
      }[]
    }[]
  }
  changes: { version: string; parent: string | null; addedLines: number; removedLines: number; approximate: boolean }[]
  analyses: { createdAt: string; type: string; backend: string; model: string | null; connectionNames: string[]; actualProviders: string[]; actualModels: string[]; status: string; summary: string }[]
  runs: RunDTO[]
  runsShort: { id: string; createdAt: string; role: string; backend: string; connectionName: string | null; requestedModel: string | null; actualProvider: string | null; actualModel: string | null; contextMode: string; contextVersionId: string | null; contextFragmentIds: string[]; contextSha256: string | null; contextChars: number | null; status: string; verdict: string | null; verdictBy: string | null; durationMs: number | null; programChecks: RunDTO['programChecks'] }[]
  runsFull: boolean
  findings: FindingDTO[]
  evidence: {
    findingId: string
    title: string
    steps: number
    gaps: string[]
    distinction: string
  }[]
  disputed: { id: string; title: string; status: string; description: string; challengerRunExists: boolean }[]
  discrepancies: { noteId: string; versionId: string | null; createdAt: string; payload: import('@/lib/research-discrepancy').ResearchDiscrepancy }[]
  hypotheses: { id: string; title: string; description: string }[]
  errors: { id: string; role: string; backend: string; model: string | null; status: string; error: string | null; createdAt: string }[]
  limitations: string[]
  placeholders: { id: string; title: string; missing: string; workaround: string }[]
  nextSteps: string[]
  campaigns: unknown[]
}

function lineDiffStat(a: string, b: string): { added: number; removed: number; approximate: boolean } {
  const A = a.split('\n')
  const B = b.split('\n')
  if (A.length * B.length > 4_000_000) {
    // fallback: multiset difference (approximate)
    const count = (arr: string[]) => {
      const m = new Map<string, number>()
      for (const x of arr) m.set(x, (m.get(x) ?? 0) + 1)
      return m
    }
    const ca = count(A)
    const cb = count(B)
    let removed = 0
    let added = 0
    for (const [line, n] of ca) {
      const other = cb.get(line) ?? 0
      if (n > other) removed += n - other
    }
    for (const [line, n] of cb) {
      const other = ca.get(line) ?? 0
      if (n > other) added += n - other
    }
    return { added, removed, approximate: true }
  }
  // LCS over lines (DP with rolling rows)
  const n = A.length
  const m = B.length
  let prev = new Int32Array(m + 1)
  let curr = new Int32Array(m + 1)
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      curr[j] = A[i - 1] === B[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1])
    }
    const tmp = prev
    prev = curr
    curr = tmp
    curr.fill(0)
  }
  const lcs = prev[m]
  return { added: m - lcs, removed: n - lcs, approximate: false }
}

async function buildHandoffModel(
  projectId: string,
  parts: string[],
  includeFullSkillText: boolean
): Promise<{ data: ExportData; model: HandoffModel; sections: HandoffSection[] } | null> {
  const data = await loadExportData(projectId)
  if (!data) return null
  const include = new Set(parts)

  const realScenarios = data.scenarios.filter((s) => s.origin !== 'demo')
  const realRuns = data.runs.filter((r) => r.origin !== 'demo')
  const realFindings = data.findings.filter((f) => f.origin !== 'demo')

  const activeVersion =
    data.documents.flatMap((d) => d.versions).find((v) => v.isActive) ??
    data.documents.flatMap((d) => d.versions).at(-1) ??
    null
  const activeFragments = activeVersion
    ? data.fragments.filter((f) => f.versionId === activeVersion.id)
    : []
  const runDTOs = realRuns.map((r) => toRunDTO(r))
  const findingDTOs = realFindings.map((f) => toFindingDTO(f))

  // goal
  const exploredCount = realScenarios.filter((s) => s.status === 'explored' || s.status === 'run-verified').length
  const completedRuns = realRuns.filter((r) => r.status === 'completed').length
  const failedRuns = realRuns.filter((r) => r.status === 'failed' || r.status === 'cancelled').length
  const summary =
    `Документов: ${data.documents.length}; версий: ${data.documents.reduce((acc, d) => acc + d.versions.length, 0)}. ` +
    `Фрагментов в активной версии${activeVersion ? ` («${activeVersion.label}»)` : ''}: ${activeFragments.length}. ` +
    `Сценариев (реальных): ${realScenarios.length}, из них исследованных: ${exploredCount}. ` +
    `Запусков (реальных): ${realRuns.length}, завершено: ${completedRuns}, ошибок/отмен: ${failedRuns}. ` +
    `Находок (реальных): ${realFindings.length}: подтверждённых ${realFindings.filter((f) => f.status === 'supported').length}, ` +
    `оспоренных ${realFindings.filter((f) => f.status === 'disputed' || f.status === 'rejected').length}, ` +
    `гипотез ${realFindings.filter((f) => f.status === 'hypothesis').length}.`

  // changes
  const versionById = new Map<string, DocumentVersion>()
  for (const d of data.documents) for (const v of d.versions) versionById.set(v.id, v)
  const changes: HandoffModel['changes'] = []
  for (const d of data.documents) {
    for (const v of [...d.versions].sort((a, b) => a.importDate.getTime() - b.importDate.getTime())) {
      const parent = v.parentVersionId ? versionById.get(v.parentVersionId) : null
      if (parent) {
        const diff = lineDiffStat(parent.content, v.content)
        changes.push({
          version: v.label,
          parent: parent.label,
          addedLines: diff.added,
          removedLines: diff.removed,
          approximate: diff.approximate,
        })
      } else {
        changes.push({ version: v.label, parent: null, addedLines: 0, removedLines: 0, approximate: false })
      }
    }
  }

  // evidence passports
  const evidence = findingDTOs
    .filter((f) => f.evidence)
    .map((f) => ({
      findingId: f.id,
      title: f.title,
      steps: f.evidence?.steps.length ?? 0,
      gaps: f.evidence?.gaps ?? [],
      distinction: f.evidence ? DISTINCTION_RU[f.evidence.distinction] ?? f.evidence.distinction : '—',
    }))

  // disputed + challenger runs
  const challengerFindingIds = new Set<string>()
  for (const r of realRuns) {
    if (r.role !== 'challenger') continue
    const input = safeParse<{ taskContext?: { findingId?: string } } | null>(r.input, null)
    if (input?.taskContext?.findingId) challengerFindingIds.add(input.taskContext.findingId)
  }
  const disputed = realFindings
    .filter((f) => f.status === 'disputed' || f.status === 'rejected')
    .map((f) => ({
      id: f.id,
      title: f.title,
      status: f.status,
      description: f.description,
      challengerRunExists: challengerFindingIds.has(f.id),
    }))
  const hypotheses = realFindings
    .filter((f) => f.status === 'hypothesis')
    .map((f) => ({ id: f.id, title: f.title, description: f.description }))

  // errors
  const errors = realRuns
    .filter((r) => r.status === 'failed' || r.status === 'cancelled')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((r) => ({
      id: r.id,
      role: r.role,
      backend: r.backend,
      model: r.model,
      status: r.status,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
    }))

  // limitations: union of local-structural limitations + fixed notes
  const limitations = new Set<string>()
  const seenAnalyses = new Set<string>()
  for (const a of [...data.analyses].reverse()) {
    if (a.type !== 'local-structural' || seenAnalyses.has(a.versionId)) continue
    seenAnalyses.add(a.versionId)
    const res = safeParse<{ limitations?: string[] } | null>(a.result, null)
    for (const lim of res?.limitations ?? []) limitations.add(lim)
  }
  limitations.add('Все метрики и отчёты вычисляются локально и детерминированно (LOCAL); модельные оценки используются только там, где явно указаны.')
  limitations.add('Демо-данные (origin=demo) исключены из всех разделов отчёта.')
  limitations.add('Подключения и адреса серверов в экспорт и архив не включаются.')
  limitations.add('Графовый экспорт — упрощённая реконструкция по результатам локального анализа, не полный движок графа.')

  // next steps (computed)
  const nextSteps: string[] = []
  const topSections = new Map<string, { title: string | null; fragmentId: string }>()
  for (const f of activeFragments) {
    if (f.kind !== 'section' || f.path.includes('.')) continue
    topSections.set(topPath(f.path), { title: f.title, fragmentId: f.id })
  }
  const coveredSections = new Set<string>()
  const fragById = new Map(activeFragments.map((f) => [f.id, f]))
  for (const s of realScenarios) {
    if (!s.fragmentId) continue
    const frag = fragById.get(s.fragmentId)
    if (frag) coveredSections.add(topPath(frag.path))
  }
  const uncovered = [...topSections.entries()]
    .filter(([path]) => !coveredSections.has(path))
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([path, info]) => `${path}. ${info.title ?? ''}`.trim())
  if (uncovered.length > 0) {
    nextSteps.push(
      `Разделы без покрытия сценариями (${uncovered.length}): ${uncovered.slice(0, 10).join('; ')}${uncovered.length > 10 ? '; …' : ''} — добавьте сценарии с привязкой к фрагментам этих разделов.`
    )
  }
  const disputedWithoutChallenge = disputed.filter((d) => !d.challengerRunExists)
  for (const d of disputedWithoutChallenge) {
    nextSteps.push(`Оспорённая находка «${d.title}» не имеет запуска Challenger — запустите опровержение или закройте спор.`)
  }
  const childrenIds = new Set(realScenarios.map((s) => s.parentId).filter((x): x is string => Boolean(x)))
  const unexploredLeaves = realScenarios.filter(
    (s) => s.status === 'unexplored' && !childrenIds.has(s.id)
  )
  if (unexploredLeaves.length > 0) {
    const examples = unexploredLeaves.slice(0, 5).map((s) => `«${s.title}»`).join(', ')
    nextSteps.push(
      `Неисследованных листьев дерева сценариев: ${unexploredLeaves.length} (например: ${examples}${unexploredLeaves.length > 5 ? ', …' : ''}) — начните с них.`
    )
  }
  const versionsWithoutAnalysis: string[] = []
  for (const d of data.documents) {
    for (const v of d.versions) {
      if (!data.analyses.some((a) => a.versionId === v.id && a.type === 'local-structural')) {
        versionsWithoutAnalysis.push(v.label)
      }
    }
  }
  if (versionsWithoutAnalysis.length > 0) {
    nextSteps.push(`Версии без локального анализа: ${[...new Set(versionsWithoutAnalysis)].join(', ')} — запустите «Локальный анализ» для полноты сравнения.`)
  }
  if (completedRuns === 0) {
    nextSteps.push('Реальных завершённых запусков нет — проверьте подключение Ollama для реальных запусков.')
  } else {
    nextSteps.push('Проверьте подключение Ollama для реальных запусков новых сценариев.')
  }

  const model: HandoffModel = {
    goal: { description: data.project.description ?? '(описание проекта не задано)', summary },
    document: {
      documents: data.documents.map((d) => ({
        title: d.title,
        versions: [...d.versions]
          .sort((a, b) => a.importDate.getTime() - b.importDate.getTime())
          .map((v) => ({
            label: v.label,
            kind: v.kind,
            source: v.source,
            sourceUrl: v.sourceUrl,
            knownVersion: v.knownVersion,
            completeness: v.completeness,
            contentHash: v.contentHash,
            isActive: v.isActive,
          })),
      })),
    },
    changes,
    analyses: data.analyses.map((a) => {
      const result = safeParse<{ items?: { connectionName?: string | null; actualProvider?: string | null; actualModel?: string | null }[] } | null>(a.result, null)
      return {
        createdAt: a.createdAt.toISOString(), type: a.type, backend: a.backend, model: a.model,
        connectionNames: [...new Set((result?.items ?? []).map((i) => i.connectionName).filter((v): v is string => Boolean(v)))],
        actualProviders: [...new Set((result?.items ?? []).map((i) => i.actualProvider).filter((v): v is string => Boolean(v)))],
        actualModels: [...new Set((result?.items ?? []).map((i) => i.actualModel).filter((v): v is string => Boolean(v)))],
        status: a.status, summary: a.summary,
      }
    }),
    runs: runDTOs.map((run) => {
      const versionContent = run.versionId
        ? data.documents.flatMap((document) => document.versions).find((version) => version.id === run.versionId)?.content
        : undefined
      return cleanRunSkillText(run, includeFullSkillText, versionContent)
    }),
    runsShort: runDTOs.map((r) => ({
      id: r.id, createdAt: r.createdAt, role: r.role, backend: r.backend, connectionName: r.connectionName,
      requestedModel: r.model, actualProvider: r.input?.responseMetadata?.actualProvider ?? null,
      actualModel: r.input?.responseMetadata?.actualModel ?? null,
      contextMode: r.input?.contextProvenance?.mode ?? 'unknown', contextVersionId: r.input?.contextProvenance?.versionId ?? null,
      contextFragmentIds: r.input?.contextProvenance?.includedFragmentIds ?? [], contextSha256: r.input?.contextProvenance?.sentContextSha256 ?? null,
      contextChars: r.input?.contextProvenance?.sentContextChars ?? null, status: r.status, verdict: r.verdict,
      verdictBy: r.verdictBy, durationMs: r.durationMs, programChecks: r.programChecks,
    })),
    runsFull: include.has('runs-full'),
    findings: findingDTOs,
    evidence,
    disputed,
    discrepancies: data.notes.flatMap((note) => {
      const payload = note.origin === 'demo' ? null : parseResearchDiscrepancy(note.body)
      return payload ? [{ noteId: note.id, versionId: note.versionId, createdAt: note.createdAt.toISOString(), payload }] : []
    }),
    hypotheses,
    errors,
    limitations: [...limitations],
    placeholders: PLACEHOLDER_REGISTRY,
    nextSteps,
    campaigns: data.campaigns.map((campaign) => ({
      id: campaign.id, versionId: campaign.versionId, contentHash: campaign.contentHash,
      predecessorCampaignId: campaign.predecessorCampaignId,
      processHistory: safeParse<unknown[]>(campaign.processHistory, []),
      scopeType: campaign.scopeType, scopeSnapshot: safeParse<unknown>(campaign.scopeSnapshot, {}),
      depth: campaign.depth, policy: {
        maxScenariosPerPosition: campaign.maxScenariosPerPosition, maxModelActions: campaign.maxModelActions,
        budgetHistory: safeParse<unknown[]>(campaign.budgetHistory, []),
        maxAdditionalChecksPerPosition: campaign.maxAdditionalChecksPerPosition, maxRetriesPerAction: campaign.maxRetriesPerAction,
        maxConcurrent: campaign.maxConcurrent, stopOnQuota: campaign.stopOnQuota,
        stopOnTechnicalError: campaign.stopOnTechnicalError, allowRewriteExperiment: campaign.allowRewriteExperiment,
      }, status: campaign.status, stage: campaign.stage, modelActionsUsed: campaign.modelActionsUsed,
      pauseReason: campaign.pauseReason, lastError: campaign.lastError,
      roles: campaign.roles.map((role) => ({ role: role.role, backend: role.backend, connectionName: role.connectionName, model: role.model })),
      positions: campaign.items.map((item) => ({
        positionId: item.positionId, title: item.position.title, status: item.status, stage: item.stage,
        conclusion: item.conclusion, conclusionSummary: item.conclusionSummary, limitations: item.limitations,
        checks: item.checks.map((check) => ({ objective: check.objective, input: check.input, expectedBehavior: check.expectedBehavior,
          criterion: check.criterion, status: check.status, scenarioId: check.scenarioId, scenarioTitle: check.scenario.title,
          sources: check.sources.map((source) => ({ fragmentId: source.fragmentId, path: source.fragment.path })) })),
        notApplicableChecks: item.notApplicableChecks.map(({ checkType, rationale }) => ({ checkType, rationale })),
      })),
      actions: campaign.actions.map((action) => {
        const input = action.run ? safeParse<Record<string, unknown>>(action.run.input, {}) : {}
        const responseMetadata = input.responseMetadata && typeof input.responseMetadata === 'object'
          ? input.responseMetadata as Record<string, unknown> : {}
        const modelCall = action.run ? data.modelCalls.find((call) => call.runId === action.run?.id) : undefined
        return { id: action.id, actionType: action.actionType, role: action.role, attempt: action.attempt,
          status: action.status, error: action.error, runId: action.run?.id ?? null,
          runStatus: action.run?.status ?? null, output: action.run?.output ?? null,
          actualProvider: modelCall?.actualProvider ?? (typeof responseMetadata.actualProvider === 'string' ? responseMetadata.actualProvider : null),
          actualModel: modelCall?.actualModel ?? (typeof responseMetadata.actualModel === 'string' ? responseMetadata.actualModel : null),
          sourcePaths: action.sources.map((source) => source.fragment.path) }
      }),
    })),
  }

  const sectionList: HandoffSection[] = HANDOFF_PARTS.map((id) => ({
    id,
    title: HANDOFF_SECTION_TITLES[id],
    included: include.has(id),
  }))

  return { data, model, sections: sectionList }
}

const HANDOFF_SECTION_TITLES: Record<string, string> = {
  goal: 'Цель исследования',
  document: 'Документ',
  changes: 'Версии и изменения',
  analyses: 'Выполненные анализы',
  runs: 'Запуски',
  'runs-full': 'Запуски — полные входы и выходы',
  findings: 'Находки',
  evidence: 'Паспорта цепочек доказательств',
  disputed: 'Спорные выводы',
  discrepancies: 'Расхождения оценок и свидетельств',
  hypotheses: 'Непроверенные гипотезы',
  errors: 'Ошибки выполнения',
  limitations: 'Ограничения методов',
  placeholders: 'Нереализованные функции (заглушки)',
  'next-steps': 'Полезные следующие шаги',
  campaigns: 'Ограниченные кампании исследования',
}

function renderEvidenceChain(f: FindingDTO): string[] {
  const lines: string[] = []
  const ev = f.evidence as EvidenceChain | null
  if (!ev || ev.steps.length === 0) {
    lines.push('  - цепочка доказательств не заполнена')
    return lines
  }
  const chain = ev.steps
    .map((s) => `${EVIDENCE_STEP_RU[s.kind] ?? s.kind}: ${s.label} (${EVIDENCE_STEP_STATUS_RU[s.status] ?? s.status})`)
    .join(' → ')
  lines.push(`  - цепочка: ${chain}`)
  lines.push(`  - тип вывода: ${DISTINCTION_RU[ev.distinction] ?? ev.distinction}`)
  for (const gap of ev.gaps) lines.push(`  - ⚠ пропуск: ${gap}`)
  return lines
}

export async function buildHandoffReport(
  projectId: string,
  parts: string[],
  format: 'md' | 'json',
  includeFullSkillText = false
): Promise<string | HandoffReportJson | null> {
  const built = await buildHandoffModel(projectId, parts, includeFullSkillText)
  if (!built) return null
  const { data, model, sections } = built
  const include = new Set(parts)
  const fmtDate = (iso: string) => iso

  if (format === 'json') {
    // section keys match the requested part ids exactly (incl. kebab-case)
    const jsonSections: Record<string, unknown> = {}
    if (include.has('goal')) jsonSections['goal'] = model.goal
    if (include.has('document')) jsonSections['document'] = model.document
    if (include.has('changes')) jsonSections['changes'] = model.changes
    if (include.has('analyses')) jsonSections['analyses'] = model.analyses
    if (include.has('runs')) jsonSections['runs'] = model.runsShort
    if (include.has('runs-full')) jsonSections['runs-full'] = model.runs
    if (include.has('findings')) jsonSections['findings'] = model.findings
    if (include.has('evidence')) jsonSections['evidence'] = model.evidence
    if (include.has('disputed')) jsonSections['disputed'] = model.disputed
    if (include.has('discrepancies')) jsonSections['discrepancies'] = model.discrepancies
    if (include.has('hypotheses')) jsonSections['hypotheses'] = model.hypotheses
    if (include.has('errors')) jsonSections['errors'] = model.errors
    if (include.has('limitations')) jsonSections['limitations'] = model.limitations
    if (include.has('placeholders')) jsonSections['placeholders'] = model.placeholders
    if (include.has('next-steps')) jsonSections['next-steps'] = model.nextSteps
    if (include.has('campaigns')) jsonSections['campaigns'] = model.campaigns
    const report: HandoffReportJson = {
      title: `Research Handoff Report — ${data.project.name}`,
      generatedAt: new Date().toISOString(),
      project: {
        id: data.project.id,
        name: data.project.name,
        description: data.project.description,
        origin: data.project.origin,
      },
      demoExcluded: true,
      parts: sections,
      sections: jsonSections,
    }
    return report
  }

  // markdown
  const out: string[] = []
  out.push(`# Research Handoff Report — ${data.project.name}`, '')
  out.push(`Сформирован: ${new Date().toISOString()}. Демо-данные (origin=demo) исключены.`, '')

  if (include.has('goal')) {
    out.push('## 1. Цель исследования', '')
    out.push(model.goal.description, '')
    out.push(`**Автоматическая сводка.** ${model.goal.summary}`, '')
  }
  if (include.has('document')) {
    out.push('## 2. Документ', '')
    for (const doc of model.document.documents) {
      out.push(`### ${doc.title}`, '')
      const rows = doc.versions.map((v) => [
        v.label,
        v.kind,
        v.source + (v.sourceUrl ? ` (${v.sourceUrl})` : ''),
        v.knownVersion ?? '—',
        v.completeness,
        `\`${shortHash(v.contentHash)}\``,
        v.isActive ? 'да' : 'нет',
      ])
      out.push(mdTable(['Версия', 'Тип', 'Источник', 'Известная версия', 'Полнота', 'Hash', 'Активная'], rows))
      out.push('')
    }
  }
  if (include.has('changes')) {
    out.push('## 3. Версии и изменения', '')
    if (model.changes.length === 0) {
      out.push('_Версий нет._', '')
    } else {
      for (const c of model.changes) {
        if (c.parent) {
          out.push(
            `- «${c.version}» (ветвь от «${c.parent}»): +${c.addedLines} строк / −${c.removedLines} строк${c.approximate ? ' (приближённо)' : ''}`
          )
        } else {
          out.push(`- «${c.version}» — базовая версия (без родителя)`)
        }
      }
      out.push('')
    }
  }
  if (include.has('analyses')) {
    out.push('## 4. Выполненные анализы', '')
    if (model.analyses.length === 0) {
      out.push('_Анализов нет._', '')
    } else {
      const rows = [...model.analyses]
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((a) => [fmtDate(a.createdAt), a.type, a.backend, a.connectionNames.join(', ') || '—', a.model ?? '—', a.actualProviders.join(', ') || '—', a.actualModels.join(', ') || '—', a.status, a.summary])
      out.push(mdTable(['Дата', 'Тип', 'Тип подключения', 'Название подключения', 'Запрошенная модель', 'Фактический провайдер', 'Фактическая модель', 'Статус', 'Сводка'], rows))
      out.push('')
    }
  }
  if (include.has('runs')) {
    out.push('## 5. Запуски (сводно)', '')
    if (model.runs.length === 0) {
      out.push('_Реальных запусков нет._', '')
    } else {
      const rows = model.runsShort.map((r) => [
        r.createdAt,
        r.role,
        `${r.backend} · ${r.connectionName ?? '—'} · запрос: ${r.requestedModel ?? '—'} · факт: ${r.actualProvider ?? '—'} / ${r.actualModel ?? '—'}`,
        RUN_STATUS_RU[r.status] ?? r.status,
        r.verdict ? `${VERDICT_RU[r.verdict] ?? r.verdict}${r.verdictBy === 'user' ? ' (вердикт пользователя)' : ''}` : '—',
        r.durationMs !== null ? String(r.durationMs) : '—',
      ])
      out.push(mdTable(['Дата', 'Роль', 'Подключение и модель (запрос / факт)', 'Статус', 'Вердикт', 'Время, мс'], rows))
      out.push('')
    }
  }
  if (include.has('runs-full')) {
    out.push('## 6. Запуски — полные входы и выходы', '')
    if (model.runs.length === 0) {
      out.push('_Реальных запусков нет._', '')
    } else {
      for (const r of model.runs) {
        out.push(`### ${r.createdAt} · ${r.role} · ${r.backend} / ${r.connectionName ?? '—'} · запрос: ${r.model ?? '—'} · факт: ${r.input?.responseMetadata?.actualProvider ?? '—'} / ${r.input?.responseMetadata?.actualModel ?? '—'} — ${RUN_STATUS_RU[r.status] ?? r.status}`)
        out.push('')
        out.push('**Вход:**', '')
        if (r.input?.sentMessages && r.input.contextProvenance) {
          const c = r.input.contextProvenance
          out.push(`Контекст инструкции: ${c.mode === 'none' ? 'дополнительная инструкция отсутствует' : c.mode === 'full' ? 'полная версия' : c.mode === 'selected' ? 'выбранные фрагменты' : 'состав неизвестен'} · версия ${c.versionLabel ?? c.versionId ?? 'не сообщена'} · фрагменты ${c.includedFragmentIds.join(', ') || '—'} · SHA-256 отправленной выборки ${c.sentContextSha256 ?? 'не применимо'} · ${c.sentContextChars} символов. Обязательный материал задачи остаётся внутри сохранённых сообщений.`, '')
        } else if (!r.input?.sentMessages) {
          out.push('Состав отправленных сообщений неизвестен; контекст и границы очистки по сообщениям определить нельзя.', '')
        }
        if (r.input?.skillVerification && r.input.sentMessages) {
          const v = r.input.skillVerification
          out.push(`Контекст скилла: [Контекст скилла #1] · версия ${v.versionId ?? r.versionId ?? 'не сообщено'} · SHA-256 ${v.fullTextSha256 ?? 'не сообщено'} · ${v.fullTextChars ?? 'не сообщено'} символов · режим ${v.mode} · сверка ${v.status} (${v.detail})`, '')
        }
        out.push('```json')
        out.push(JSON.stringify(r.input, null, 2) ?? 'null')
        out.push('```')
        out.push('')
        out.push('**Выход:**', '')
        out.push('```')
        out.push(r.output ?? '(нет вывода)')
        out.push('```')
        if (r.error) out.push(``, `**Ошибка:** ${r.error}`)
        if (r.programChecks.length > 0) {
          out.push('', '**Программные проверки (LOCAL):**')
          for (const pc of r.programChecks) out.push(`- ${pc.name}: ${pc.passed ? 'пройдена' : 'не пройдена'} — ${pc.detail}`)
        }
        out.push('')
      }
    }
  }
  if (include.has('findings')) {
    out.push('## 7. Находки', '')
    if (model.findings.length === 0) {
      out.push('_Находок нет._', '')
    } else {
      for (const f of model.findings) {
        out.push(
          `### ${f.title}`,
          '',
          `- Важность: ${SEVERITY_RU[f.severity] ?? f.severity}; статус: ${FINDING_STATUS_RU[f.status] ?? f.status}; происхождение: ${f.provenance}`,
          `- Создана: ${f.createdAt}${f.fragmentId ? `; фрагмент: ${f.fragmentId}` : ''}`,
          '',
          f.description.replace(/\r?\n/g, ' '),
          '',
          ...renderEvidenceChain(f),
          ''
        )
      }
    }
  }
  if (include.has('evidence')) {
    out.push('## 8. Паспорта цепочек доказательств', '')
    if (model.evidence.length === 0) {
      out.push('_Находок с цепочками доказательств нет._', '')
    } else {
      const rows = model.evidence.map((e) => [
        e.title,
        String(e.steps),
        e.gaps.length === 0 ? 'нет' : e.gaps.map((g) => `⚠ ${g}`).join('; '),
        e.distinction,
      ])
      out.push(mdTable(['Находка', 'Шагов', 'Пропуски', 'Тип вывода'], rows))
      out.push('')
    }
  }
  if (include.has('disputed')) {
    out.push('## 9. Спорные выводы', '')
    if (model.disputed.length === 0) {
      out.push('_Спорных выводов нет._', '')
    } else {
      for (const d of model.disputed) {
        out.push(
          `- **${d.title}** (${FINDING_STATUS_RU[d.status] ?? d.status}): ${d.description.replace(/\r?\n/g, ' ')}${d.challengerRunExists ? ' — запуск Challenger выполнен.' : ' — запуска Challenger нет, спор не проверен.'}`
        )
      }
      out.push('')
    }
  }
  if (include.has('discrepancies')) {
    out.push('## Расхождения оценок и свидетельств', '')
    if (!model.discrepancies.length) out.push('_Структурированных расхождений нет._', '')
    else for (const item of model.discrepancies) {
      out.push(`- **${item.payload.assessment} / ${item.payload.status}** (Note ${item.noteId}): ${item.payload.summary}`)
      out.push(`  - критерий: ${item.payload.criterion}`)
      out.push(`  - Run: ${item.payload.runIds.join(', ') || 'неизвестно'}; Observation: ${item.payload.observationIds.join(', ') || 'нет'}`)
      out.push(`  - пользовательское решение: ${item.payload.userDecision?.decision ?? 'не принято'}${item.payload.userDecision?.note ? ` — ${item.payload.userDecision.note}` : ''}`)
      if (item.payload.limitations.length) out.push(`  - ограничения: ${item.payload.limitations.join('; ')}`)
    }
    out.push('')
  }
  if (include.has('hypotheses')) {
    out.push('## 10. Непроверенные гипотезы', '')
    if (model.hypotheses.length === 0) {
      out.push('_Гипотез нет._', '')
    } else {
      for (const h of model.hypotheses) {
        out.push(`- **${h.title}**: ${h.description.replace(/\r?\n/g, ' ')}`)
      }
      out.push('')
    }
  }
  if (include.has('errors')) {
    out.push('## 11. Ошибки выполнения', '')
    if (model.errors.length === 0) {
      out.push('_Ошибок выполнения нет._', '')
    } else {
      for (const e of model.errors) {
        out.push(`- ${e.createdAt} · ${e.role} · ${e.backend}${e.model ? ` / ${e.model}` : ''} — ${RUN_STATUS_RU[e.status] ?? e.status}: ${e.error ?? '(текст ошибки не сохранён)'}`)
      }
      out.push('')
    }
  }
  if (include.has('limitations')) {
    out.push('## 12. Ограничения методов', '')
    for (const lim of model.limitations) out.push(`- ${lim}`)
    out.push('')
  }
  if (include.has('placeholders')) {
    out.push('## 13. Нереализованные функции (заглушки)', '')
    for (const p of model.placeholders) {
      out.push(`- **${p.title}** (\`${p.id}\`) — не реализовано: ${p.missing}. Обход: ${p.workaround}`)
    }
    out.push('')
  }
  if (include.has('next-steps')) {
    out.push('## 14. Полезные следующие шаги', '')
    for (const step of model.nextSteps) out.push(`- [ ] ${step}`)
    out.push('')
  }
  if (include.has('campaigns')) {
    out.push('## Ограниченные кампании исследования', '')
    if (!model.campaigns.length) out.push('_Кампаний нет._', '')
    else {
      out.push('Статусы и выводы отражают только сохранённые действия кампании; отсутствие выявленных проблем ограничено выполненными проверками.', '')
      out.push('```json', JSON.stringify(model.campaigns, null, 2), '```', '')
    }
  }

  out.push('---')
  out.push(`_Разделы отчёта: ${sections.filter((s) => s.included).map((s) => s.title).join(' · ')}._`)
  return out.join('\n') + '\n'
}

// ============================================================
// Graph export (self-contained, export-oriented)
// ============================================================

export interface GraphExportStats {
  nodeCount: number
  edgeCount: number
  edgesByKind: Record<string, number>
  isolatedNodes: string[]
  sectionsWithoutScenarios: { path: string; title: string | null }[]
  methodSummary: string
  limitations: string[]
}

export interface GraphExportData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  stats: GraphExportStats
  provenance: 'LOCAL'
  versionId: string
  versionLabel: string
  generatedAt: string
}

export type GraphExportResult =
  | { ok: true; data: GraphExportData }
  | { ok: false; status: 404; error: string }

const SECTION_KIND_BY_PATH: Record<string, GraphNodeKind> = {
  '4': 'operation',
  '8': 'contract',
  '9': 'contract',
  '10': 'contract',
  '12': 'contract',
  '15': 'validation',
  '18': 'completion',
}

function guessNodeKind(layers: string[], sectionTop: string): GraphNodeKind {
  if (layers.includes('definition')) return 'definition'
  if (layers.includes('prohibition')) return 'constraint'
  if (layers.includes('obligation')) return 'requirement'
  if (layers.includes('condition')) return 'condition'
  if (layers.includes('exception')) return 'exception'
  if (layers.includes('evidence')) return 'validation'
  return SECTION_KIND_BY_PATH[sectionTop] ?? 'requirement'
}

function refToPath(ref: string): string | null {
  const m = ref.match(/(?:Section\s+|§)\s*(\d+(?:\.\d+)*)/)
  return m ? m[1] : null
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function buildGraphExport(
  projectId: string,
  versionIdParam?: string,
  format: 'json' | 'md' | 'txt' = 'json'
): Promise<GraphExportResult & { text?: string }> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { documents: { include: { versions: true } } },
  })
  if (!project) return { ok: false, status: 404, error: 'Проект не найден' }
  const versions = project.documents.flatMap((d) => d.versions)
  const version = versionIdParam
    ? versions.find((v) => v.id === versionIdParam)
    : versions.find((v) => v.isActive) ?? [...versions].sort((a, b) => b.importDate.getTime() - a.importDate.getTime())[0]
  if (!version) {
    return { ok: false, status: 404, error: 'Версия не найдена' }
  }

  const fragments = await db.fragment.findMany({
    where: { versionId: version.id },
    orderBy: { order: 'asc' },
  })
  const analysis = await db.analysis.findFirst({
    where: { versionId: version.id, type: 'local-structural' },
    orderBy: { createdAt: 'desc' },
  })
  if (!analysis) {
    return {
      ok: false,
      status: 404,
      error: 'Сначала выполните локальный анализ — граф экспортируется по его результатам',
    }
  }
  const result = safeParse<{
    annotations?: {
      fragmentId: string
      layers: { layer: string }[]
      terms: string[]
      sectionRefs: string[]
    }[]
    repetitions?: { fragmentIds: string[]; similarity: number; method: string }[]
    conflictCandidates?: {
      aFragmentId: string
      bFragmentId: string
      sharedTerms: string[]
      clashConditions: string
    }[]
  }>(analysis.result, {})

  const annotations = result.annotations ?? []
  const fragById = new Map(fragments.map((f) => [f.id, f]))
  const annByFragment = new Map(annotations.map((a) => [a.fragmentId, a]))
  const sectionFragByPath = new Map<string, Fragment>()
  for (const f of fragments) {
    if (f.kind === 'section') sectionFragByPath.set(f.path, f)
  }
  const sectionTopByFragment = new Map<string, string>()
  for (const f of fragments) sectionTopByFragment.set(f.id, topPath(f.path))
  const topSectionFrag = new Map<string, Fragment>()
  for (const f of fragments) {
    if (f.kind === 'section' && !f.path.includes('.')) topSectionFrag.set(f.path, f)
  }

  // --- nodes ---
  const referenced = new Set<string>()
  for (const rep of result.repetitions ?? []) rep.fragmentIds.forEach((id) => referenced.add(id))
  for (const c of result.conflictCandidates ?? []) {
    referenced.add(c.aFragmentId)
    referenced.add(c.bFragmentId)
  }
  const scenarios = await db.scenario.findMany({
    where: { projectId, origin: { not: 'demo' }, fragmentId: { not: null } },
  })
  for (const s of scenarios) if (s.fragmentId) referenced.add(s.fragmentId)

  const nodeFragments: Fragment[] = []
  for (const f of fragments) {
    if (f.kind === 'section') {
      nodeFragments.push(f) // structural anchors for uses/scenario edges
      continue
    }
    const ann = annByFragment.get(f.id)
    if ((ann && (ann.layers.length > 0 || ann.sectionRefs.length > 0)) || referenced.has(f.id)) {
      nodeFragments.push(f)
    }
  }

  const nodeIds = new Set(nodeFragments.map((f) => f.id))
  const degree = new Map<string, number>()
  for (const f of nodeFragments) degree.set(f.id, 0)

  const mkNode = (f: Fragment): GraphNode => {
    const ann = annByFragment.get(f.id)
    const layers = ann?.layers.map((l) => l.layer) ?? []
    const top = sectionTopByFragment.get(f.id) ?? topPath(f.path)
    const sectionTitle = topSectionFrag.get(top)?.title ?? null
    const rawLabel =
      f.kind === 'section' ? (f.title ?? f.path) : f.text.replace(/\s+/g, ' ').trim()
    const label = rawLabel.length > 80 ? rawLabel.slice(0, 77).trimEnd() + '…' : rawLabel
    return {
      id: f.id,
      fragmentId: f.id,
      label,
      kind: guessNodeKind(layers, top),
      path: f.path,
      sectionPath: top,
      sectionTitle,
      degree: 0,
      layers: layers as GraphNode['layers'],
    }
  }

  const nodes = new Map<string, GraphNode>()
  for (const f of nodeFragments) nodes.set(f.id, mkNode(f))

  // --- edges ---
  const edges: GraphEdge[] = []
  let edgeCounter = 0
  const seenEdge = new Set<string>()
  const addEdge = (
    source: string,
    target: string,
    kind: GraphEdgeKind,
    basis: GraphEdge['basis']
  ) => {
    if (source === target) return
    if (!nodes.has(source) || !nodes.has(target)) return
    const key = `${source}->${target}:${kind}:${basis.detail}`
    if (seenEdge.has(key)) return
    seenEdge.add(key)
    edgeCounter += 1
    edges.push({ id: `e${edgeCounter}`, source, target, kind, basis })
    degree.set(source, (degree.get(source) ?? 0) + 1)
    degree.set(target, (degree.get(target) ?? 0) + 1)
  }

  const DEF_TERM_TARGET_CAP = 10

  // defines: definition fragment + term -> fragments containing the term
  for (const ann of annotations) {
    const src = annByFragment.get(ann.fragmentId)
    if (!src || !src.layers.some((l) => l.layer === 'definition')) continue
    for (const term of src.terms) {
      if (!term || term.length < 4) continue
      const re = new RegExp(escapeRegExp(term), 'i')
      let targets = 0
      for (const f of nodeFragments) {
        if (f.id === ann.fragmentId || f.kind === 'section') continue
        if (targets >= DEF_TERM_TARGET_CAP) break
        if (re.test(f.text)) {
          addEdge(ann.fragmentId, f.id, 'defines', {
            type: 'definition',
            detail: `термин «${term}»`,
          })
          targets += 1
        }
      }
    }
  }

  // uses: sectionRefs -> section nodes
  for (const ann of annotations) {
    for (const ref of ann.sectionRefs) {
      const path = refToPath(ref)
      if (!path) continue
      const sectionFrag = sectionFragByPath.get(path)
      if (!sectionFrag) continue
      if (!nodeIds.has(ann.fragmentId)) continue
      addEdge(ann.fragmentId, sectionFrag.id, 'uses', {
        type: 'section-reference',
        detail: `ссылка «${ref}»`,
      })
    }
  }

  // repeats
  for (const rep of result.repetitions ?? []) {
    for (let i = 0; i + 1 < rep.fragmentIds.length; i++) {
      addEdge(rep.fragmentIds[i], rep.fragmentIds[i + 1], 'repeats', {
        type: 'lexical-similarity',
        detail: rep.method,
        similarity: rep.similarity,
      })
    }
  }

  // conflicts
  for (const c of result.conflictCandidates ?? []) {
    addEdge(c.aFragmentId, c.bFragmentId, 'conflicts', {
      type: 'shared-term',
      detail: `общие термины: ${c.sharedTerms.join(', ')}; ${c.clashConditions}`,
    })
  }

  // scenario-supported: scenario fragment -> its top section node
  for (const s of scenarios) {
    if (!s.fragmentId) continue
    const frag = fragById.get(s.fragmentId)
    if (!frag) continue
    const top = topPath(frag.path)
    const sectionFrag = topSectionFrag.get(top)
    if (!sectionFrag) continue
    addEdge(frag.id, sectionFrag.id, 'scenario-supported', {
      type: 'scenario-link',
      detail: `сценарий «${s.title}» — ${SCENARIO_STATUS_TITLES[s.status as ScenarioDTO['status']] ?? s.status}`,
    })
  }

  for (const node of nodes.values()) node.degree = degree.get(node.id) ?? 0

  // --- stats ---
  const edgesByKind: Record<string, number> = {}
  for (const e of edges) edgesByKind[e.kind] = (edgesByKind[e.kind] ?? 0) + 1
  const isolatedNodes = [...nodes.values()].filter((n) => n.degree === 0).map((n) => n.id)
  const scenarioSections = new Set(
    edges
      .filter((e) => e.kind === 'scenario-supported')
      .map((e) => nodes.get(e.target)?.sectionPath ?? '')
      .filter(Boolean)
  )
  const sectionsWithoutScenarios = [...topSectionFrag.values()]
    .filter((f) => !scenarioSections.has(f.path))
    .sort((a, b) => Number(a.path) - Number(b.path))
    .map((f) => ({ path: f.path, title: f.title }))

  const stats: GraphExportStats = {
    nodeCount: nodes.size,
    edgeCount: edges.length,
    edgesByKind,
    isolatedNodes,
    sectionsWithoutScenarios,
    methodSummary:
      'Самодостаточная экспортная реконструкция графа по сохранённому локальному структурному анализу: узлы — фрагменты со слоями (+ разделы как структурные опоры), связи defines/uses/repeats/conflicts восстановлены из полей анализа, scenario-supported — из таблицы сценариев (demo исключены).',
    limitations: [
      'Это упрощённая экспортная реконструкция, а не полный графовый движок: часть видов связей (restricts/refines/excepts/depends-on/disputed/missing-link) не восстанавливается.',
      'Тип узла — эвристическая догадка по слоям и номеру раздела, не семантический разбор.',
      'Число связей «определяет» на один термин ограничено 10 первыми вхождениями.',
      'Повторы — лексическое сходство представления, не логическая эквивалентность.',
    ],
  }

  const data: GraphExportData = {
    nodes: [...nodes.values()],
    edges,
    stats,
    provenance: 'LOCAL',
    versionId: version.id,
    versionLabel: version.label,
    generatedAt: new Date().toISOString(),
  }

  if (format === 'json') return { ok: true, data }

  // --- md / txt rendering: adjacency grouped by section ---
  const plain = format === 'txt'
  const out: string[] = []
  const headerTitle = `Экспорт графа правил — ${project.name}`
  out.push(plain ? headerTitle : `# ${headerTitle}`)
  out.push('')
  out.push(
    `Версия: «${version.label}» (hash ${shortHash(version.contentHash)}) · Сформировано: ${data.generatedAt} · Узлов: ${nodes.size}, связей: ${edges.length}`
  )
  out.push(`Метод: ${stats.methodSummary}`)
  out.push('Ограничения:')
  for (const lim of stats.limitations) out.push(`- ${lim}`)
  out.push('')

  const edgesFrom = new Map<string, GraphEdge[]>()
  for (const e of edges) {
    const list = edgesFrom.get(e.source) ?? []
    list.push(e)
    edgesFrom.set(e.source, list)
  }

  const sectionNum = (p: string) => Number(topPath(p)) || 0
  const sectionGroups = new Map<string, GraphNode[]>()
  for (const n of nodes.values()) {
    const list = sectionGroups.get(n.sectionPath) ?? []
    list.push(n)
    sectionGroups.set(n.sectionPath, list)
  }
  const sortedSections = [...sectionGroups.keys()].sort(
    (a, b) => sectionNum(a) - sectionNum(b) || a.localeCompare(b)
  )
  for (const secPath of sortedSections) {
    const group = sectionGroups.get(secPath) ?? []
    const title = group[0]?.sectionTitle ?? topSectionFrag.get(secPath)?.title ?? ''
    const heading = `Раздел ${secPath}${title ? ` — ${title}` : ''}`
    out.push(plain ? `=== ${heading} ===` : `## ${heading}`)
    out.push('')
    for (const n of [...group].sort((a, b) => sectionNum(a.path) - sectionNum(b.path) || a.path.localeCompare(b.path))) {
      const arrow = plain ? '->' : '→'
      out.push(
        plain
          ? `- §${n.path} "${n.label}" [${GRAPH_NODE_KIND_TITLES[n.kind]}]`
          : `- §${n.path} «${n.label}» [${GRAPH_NODE_KIND_TITLES[n.kind]}]`
      )
      const nodeEdges = edgesFrom.get(n.id) ?? []
      if (nodeEdges.length === 0) {
        out.push(plain ? '    (связей нет)' : '  - _связей нет_')
      } else {
        for (const e of nodeEdges) {
          const target = nodes.get(e.target)
          if (!target) continue
          const targetLabel = plain ? `"${target.label}"` : `«${target.label}»`
          out.push(
            `${plain ? '    ' : '  - '}${GRAPH_EDGE_KIND_TITLES[e.kind]} ${arrow} §${target.path} ${targetLabel} — ${e.basis.detail}`
          )
        }
      }
    }
    out.push('')
  }

  if (stats.sectionsWithoutScenarios.length > 0) {
    const list = stats.sectionsWithoutScenarios
      .map((s) => `${s.path}. ${s.title ?? ''}`.trim())
      .join('; ')
    out.push(plain ? `Разделы без сценариев: ${list}` : `_Разделы без поддержки сценариями: ${list}._`)
    out.push('')
  }

  return { ok: true, data, text: out.join('\n') + '\n' }
}
