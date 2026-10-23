// ============================================================
// Importers (owner: agent 1-c).
// Validates and imports a ProjectArchive JSON into a NEW project
// (name suffixed with «(импорт)», origin='import').
// Connections are never imported (they are not in the archive).
// ============================================================

import { db } from '@/lib/db'
import { safeParse, sha256Hex, toProjectDTO } from '@/lib/serialize'
import { buildFragmentsForVersion } from '@/lib/parser'
import type { ProjectDTO } from '@/lib/types'
import { parseResearchDiscrepancy, remapResearchDiscrepancyIds } from '@/lib/research-discrepancy'
import { importedCampaignState } from '@/lib/research-campaign-core'
import { remapCampaignProcessHistory, remapRunInputReferences } from '@/lib/archive-import-mapping'
import { randomUUID } from 'node:crypto'

export class ArchiveValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArchiveValidationError'
  }
}

interface VersionArchiveShape {
  id?: string
  label?: unknown
  kind?: unknown
  source?: unknown
  sourceUrl?: unknown
  knownVersion?: unknown
  completeness?: unknown
  content?: unknown
  contentHash?: unknown
  parentVersionId?: unknown
  note?: unknown
  importDate?: unknown
  isActive?: unknown
}

interface ArchiveShape {
  format?: unknown
  archiveVersion?: unknown
  exportedAt?: unknown
  project?: {
    name?: unknown
    description?: unknown
    origin?: unknown
    documents?: unknown
    scenarios?: unknown
    runs?: unknown
    findings?: unknown
    notes?: unknown
    assignments?: unknown
    chatMessages?: unknown
    analyses?: unknown
    modelCalls?: unknown
    fragmentRefs?: unknown
    semanticIndexPolicy?: unknown
    semanticPositions?: unknown
    semanticRelations?: unknown
    positionObservations?: unknown
    researchCampaigns?: unknown
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function remapSourceIds(value: unknown, maps: {
  modelCallIdMap: Map<string, string>
  versionIdMap: Map<string, string>
  fragmentIdMap: Map<string, string>
  analysisIdMap?: Map<string, string>
  positionIdMap?: Map<string, string>
  relationIdMap?: Map<string, string>
  operationIdMap?: Map<string, string>
}): unknown {
  if (Array.isArray(value)) return value.map((item) => remapSourceIds(item, maps))
  if (!isPlainObject(value)) return value
  const result: Record<string, unknown> = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, remapSourceIds(item, maps)])
  )
  const callId = result.modelCallId
  if (typeof callId === 'string') {
    const mapped = maps.modelCallIdMap.get(callId)
    if (mapped) result.modelCallId = mapped
    else {
      delete result.modelCallId
      result.sourceModelCallId = callId
    }
  }
  for (const field of ['versionId', 'contextVersionId']) {
    const id = result[field]
    if (typeof id !== 'string') continue
    const mapped = maps.versionIdMap.get(id)
    if (mapped) result[field] = mapped
    else {
      delete result[field]
      result[`source${field[0].toUpperCase()}${field.slice(1)}`] = id
    }
  }
  const fragmentFields = ['contextFragmentId', 'selectedFragmentIds', 'includedFragmentIds']
  for (const field of fragmentFields) {
    const value = result[field]
    if (typeof value === 'string') {
      const mapped = maps.fragmentIdMap.get(value)
      if (mapped) result[field] = mapped
      else {
        delete result[field]
        result[`source${field[0].toUpperCase()}${field.slice(1)}`] = value
      }
    } else if (Array.isArray(value)) {
      const live: string[] = []
      const source: string[] = []
      for (const id of value) {
        if (typeof id !== 'string') continue
        const mapped = maps.fragmentIdMap.get(id)
        if (mapped) live.push(mapped)
        else source.push(id)
      }
      result[field] = live
      if (source.length) result[`source${field[0].toUpperCase()}${field.slice(1)}`] = source
    }
  }
  for (const field of ['fragmentIds', 'sourceFragmentIds']) {
    const value = result[field]
    if (Array.isArray(value)) result[field] = value.map((id) => typeof id === 'string' ? maps.fragmentIdMap.get(id) ?? `source:${id}` : id)
  }
  if (typeof result.entityId === 'string' && maps.fragmentIdMap.has(result.entityId)) result.entityId = maps.fragmentIdMap.get(result.entityId)
  for (const field of ['sourcePositionId', 'targetPositionId', 'positionId']) {
    const id = result[field]
    if (typeof id !== 'string') continue
    const mapped = maps.positionIdMap?.get(id)
    if (mapped) result[field] = mapped
    else { delete result[field]; result[`source${field[0].toUpperCase()}${field.slice(1)}`] = id }
  }
  if (Array.isArray(result.positionIds)) {
    const live: string[] = []
    const source: string[] = []
    for (const id of result.positionIds) {
      if (typeof id !== 'string') continue
      const mapped = maps.positionIdMap?.get(id)
      if (mapped) live.push(mapped)
      else source.push(id)
    }
    result.positionIds = live
    if (source.length) result.sourcePositionIds = source
  }
  for (const field of ['nodeId', 'fromNodeId', 'toNodeId']) {
    const id = result[field]
    if (typeof id !== 'string') continue
    const mapped = maps.positionIdMap?.get(id)
    if (mapped) result[field] = mapped
  }
  if (typeof result.relationId === 'string') {
    const mapped = maps.relationIdMap?.get(result.relationId)
    if (mapped) result.relationId = mapped
  }
  for (const field of ['analysisId', 'provenanceRef']) {
    const id = result[field]
    if (typeof id !== 'string') continue
    const mapped = maps.analysisIdMap?.get(id)
    if (mapped) result[field] = mapped
    else if (field === 'analysisId' || result.provenance === 'model-interpret') { delete result[field]; result[`source${field[0].toUpperCase()}${field.slice(1)}`] = id }
  }
  const operationId = result.operationId
  if (typeof operationId === 'string' && maps.operationIdMap?.has(operationId)) result.operationId = maps.operationIdMap.get(operationId)
  return result
}

function remapRelatedEntities(value: unknown, maps: {
  runIdMap: Map<string, string>
  scenarioIdMap: Map<string, string>
  versionIdMap: Map<string, string>
  analysisIdMap: Map<string, string>
  positionIdMap: Map<string, string>
  relationIdMap: Map<string, string>
  chatMessageIdMap: Map<string, string>
  fragmentIdMap: Map<string, string>
  campaignIdMap?: Map<string, string>
  campaignPositionIdMap?: Map<string, string>
  campaignActionIdMap?: Map<string, string>
}): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry !== 'string') return []
    const separator = entry.indexOf(':')
    if (separator < 0) return [entry]
    const kind = entry.slice(0, separator)
    const sourceId = entry.slice(separator + 1)
    const map = kind === 'run' ? maps.runIdMap
      : kind === 'scenario' ? maps.scenarioIdMap
      : kind === 'analysis-version' ? maps.versionIdMap
      : kind === 'analysis' ? maps.analysisIdMap
      : kind === 'semantic-position' ? maps.positionIdMap
      : kind === 'semantic-relation' ? maps.relationIdMap
      : kind === 'chat-message' ? maps.chatMessageIdMap
      : kind === 'research-campaign' ? maps.campaignIdMap
      : kind === 'research-campaign-position' ? maps.campaignPositionIdMap
      : kind === 'research-campaign-action' ? maps.campaignActionIdMap
      : null
    if (map) {
      const mapped = map.get(sourceId)
      return mapped ? [`${kind}:${mapped}`] : [`source-${kind}:${sourceId}`]
    }
    if (kind === 'fragment') return maps.fragmentIdMap.has(sourceId) ? [`fragment:${maps.fragmentIdMap.get(sourceId)!}`] : [`source-fragment:${sourceId}`]
    return [entry]
  })
}

/** Full validation with JSON-pointer-style error paths (RU). Throws on any error. */
export function validateArchive(archive: unknown): asserts archive is ArchiveShape {
  if (!isPlainObject(archive)) {
    throw new ArchiveValidationError('корень архива должен быть JSON-объектом')
  }
  if (archive.format !== 'mmss-observatory-archive') {
    throw new ArchiveValidationError(
      'Неизвестный формат архива: ожидается mmss-observatory-archive'
    )
  }
  if (archive.archiveVersion !== 1) {
    throw new ArchiveValidationError(
      `archiveVersion: ожидается 1, получено ${JSON.stringify(archive.archiveVersion ?? null)}`
    )
  }
  const errors: string[] = []
  const project = archive.project
  if (!isPlainObject(project)) {
    errors.push('project отсутствует или не объект')
  } else {
    if (typeof project.name !== 'string' || project.name.trim() === '') {
      errors.push('project.name отсутствует или не строка')
    }
    if (project.description !== undefined && project.description !== null && typeof project.description !== 'string') {
      errors.push('project.description должен быть строкой или null')
    }
    if (project.documents !== undefined && !Array.isArray(project.documents)) {
      errors.push('project.documents должен быть массивом')
    }
    if (Array.isArray(project.documents)) {
      project.documents.forEach((doc, di) => {
        if (!isPlainObject(doc)) {
          errors.push(`project.documents[${di}] не является объектом`)
          return
        }
        if (typeof doc.title !== 'string' || doc.title.trim() === '') {
          errors.push(`project.documents[${di}].title отсутствует или не строка`)
        }
        if (!Array.isArray(doc.versions)) {
          errors.push(`project.documents[${di}].versions должен быть массивом`)
          return
        }
        doc.versions.forEach((ver: VersionArchiveShape, vi) => {
          if (!isPlainObject(ver)) {
            errors.push(`project.documents[${di}].versions[${vi}] не является объектом`)
            return
          }
          if (typeof ver.content !== 'string') {
            errors.push(`project.documents[${di}].versions[${vi}].content отсутствует или не строка`)
          }
          if (ver.label !== undefined && typeof ver.label !== 'string') {
            errors.push(`project.documents[${di}].versions[${vi}].label должен быть строкой`)
          }
        })
      })
    }
    const arrayFields: [string, string][] = [
      ['scenarios', 'project.scenarios'],
      ['runs', 'project.runs'],
      ['findings', 'project.findings'],
      ['notes', 'project.notes'],
      ['assignments', 'project.assignments'],
      ['chatMessages', 'project.chatMessages'],
      ['analyses', 'project.analyses'],
      ['modelCalls', 'project.modelCalls'],
      ['fragmentRefs', 'project.fragmentRefs'],
      ['semanticPositions', 'project.semanticPositions'],
      ['semanticRelations', 'project.semanticRelations'],
      ['positionObservations', 'project.positionObservations'],
      ['researchCampaigns', 'project.researchCampaigns'],
    ]
    for (const [field, pointer] of arrayFields) {
      const v = (project as Record<string, unknown>)[field]
      if (v !== undefined && !Array.isArray(v)) {
        errors.push(`${pointer} должен быть массивом`)
      }
    }
  }
  if (errors.length > 0) {
    throw new ArchiveValidationError(errors.join('; '))
  }
}

function toDate(value: unknown, fallback = new Date()): Date {
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d
  }
  return fallback
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

interface ImportResult {
  project: ProjectDTO
  warnings: string[]
}

/**
 * Import an archive into a new project. All ids are re-generated; references
 * are remapped. Fragments are reconstructed from immutable version content;
 * analysis and research processes are never started automatically.
 */
export async function importProjectArchive(archiveUnknown: unknown): Promise<ImportResult> {
  validateArchive(archiveUnknown)
  const archive = archiveUnknown as ArchiveShape
  const aProject = archive.project!
  const warnings: string[] = []

  const created = await db.$transaction(
    async (tx) => {
      const project = await tx.project.create({
        data: {
          name: `${String(aProject.name).slice(0, 180)} (импорт)`,
          description: str(aProject.description),
          origin: 'import',
        },
      })

      // ---- documents + versions ----
      const docIdMap = new Map<string, string>()
      const versionIdMap = new Map<string, string>()
      const fragmentIdMap = new Map<string, string>()
      const activeVersionIds: string[] = []
      let activatedFallback = 0

      const documents = Array.isArray(aProject.documents) ? aProject.documents : []
      for (const docRaw of documents) {
        const doc = docRaw as Record<string, unknown> & { versions?: VersionArchiveShape[] }
        const newDoc = await tx.document.create({
          data: { projectId: project.id, title: String(doc.title ?? 'Документ') },
        })
        if (typeof doc.id === 'string') docIdMap.set(doc.id, newDoc.id)

        const versions = Array.isArray(doc.versions) ? doc.versions : []
        const versionRows: { newId: string; old: VersionArchiveShape }[] = []
        for (const ver of versions) {
          const content = String(ver.content ?? '')
          const recomputedHash = sha256Hex(content)
          const storedHash = typeof ver.contentHash === 'string' ? ver.contentHash : null
          if (storedHash && storedHash !== recomputedHash) {
            warnings.push(
              `хэш контента версии «${String(ver.label ?? 'version')}» не совпадает с архивным — содержимое изменилось`
            )
          }
          const newVer = await tx.documentVersion.create({
            data: {
              documentId: newDoc.id,
              projectId: project.id,
              label: typeof ver.label === 'string' && ver.label ? ver.label : 'version',
              kind: typeof ver.kind === 'string' ? ver.kind : 'original',
              source: typeof ver.source === 'string' ? ver.source : 'import',
              sourceUrl: str(ver.sourceUrl),
              knownVersion: str(ver.knownVersion),
              completeness: typeof ver.completeness === 'string' ? ver.completeness : 'unknown',
              content,
              contentHash: recomputedHash,
              note: str(ver.note),
              importDate: toDate(ver.importDate),
              isActive: false,
            },
          })
          if (typeof ver.id === 'string') versionIdMap.set(ver.id, newVer.id)
          const fragmentPayloads = buildFragmentsForVersion(newVer.id, content)
          if (fragmentPayloads.length) await tx.fragment.createMany({ data: fragmentPayloads })
          const createdFragments = await tx.fragment.findMany({ where: { versionId: newVer.id }, select: { id: true, path: true, text: true } })
          const sourceRefs = Array.isArray(aProject.fragmentRefs) ? aProject.fragmentRefs : []
          for (const refRaw of sourceRefs) {
            if (!isPlainObject(refRaw) || refRaw.versionId !== ver.id || typeof refRaw.id !== 'string' || typeof refRaw.path !== 'string') continue
            const match = createdFragments.find((fragment) => fragment.path === refRaw.path && sha256Hex(fragment.text) === refRaw.textHash)
            if (match) fragmentIdMap.set(refRaw.id, match.id)
          }
          versionRows.push({ newId: newVer.id, old: ver })
          if (ver.isActive === true) activeVersionIds.push(newVer.id)
        }
        // second pass: remap parents
        for (const row of versionRows) {
          const parentOld = row.old.parentVersionId
          if (typeof parentOld === 'string' && versionIdMap.has(parentOld)) {
            await tx.documentVersion.update({
              where: { id: row.newId },
              data: { parentVersionId: versionIdMap.get(parentOld)! },
            })
          }
        }
        if (versionRows.length > 0 && !versionRows.some((r) => r.old.isActive === true)) {
          await tx.documentVersion.update({
            where: { id: versionRows[0].newId },
            data: { isActive: true },
          })
          activatedFallback += 1
        }
      }
      for (const id of activeVersionIds) {
        await tx.documentVersion.update({ where: { id }, data: { isActive: true } })
      }
      if (activatedFallback > 0) {
        warnings.push(
          `${activatedFallback} документ(ов): ни одна версия в архиве не помечена активной — активирована первая`
        )
      }

      // ---- scenarios ----
      const scenarioIdMap = new Map<string, string>()
      const scenarioRows: { newId: string; oldParentId: unknown; oldFragmentId: unknown }[] = []
      const scenarios = Array.isArray(aProject.scenarios) ? aProject.scenarios : []
      let scenarioFragmentDrops = 0
      for (const sRaw of scenarios) {
        const s = sRaw as Record<string, unknown>
        const newS = await tx.scenario.create({
          data: {
            projectId: project.id,
            title: String(s.title ?? 'Сценарий'),
            description: str(s.description),
            status: typeof s.status === 'string' ? s.status : 'unexplored',
            stopReason: str(s.stopReason),
            origin: typeof s.origin === 'string' ? s.origin : 'user',
            generationMetadata: JSON.stringify(remapSourceIds(s.generationMetadata, { modelCallIdMap: new Map(), versionIdMap: new Map(), fragmentIdMap: new Map() })),
            pinned: s.pinned === true,
            order: typeof s.order === 'number' ? s.order : 0,
            createdAt: toDate(s.createdAt),
            updatedAt: toDate(s.updatedAt),
          },
        })
        if (typeof s.id === 'string') scenarioIdMap.set(s.id, newS.id)
        scenarioRows.push({ newId: newS.id, oldParentId: s.parentId, oldFragmentId: s.fragmentId })
      }
      for (const row of scenarioRows) {
        const data: { parentId?: string; fragmentId?: string | null } = {}
        if (typeof row.oldParentId === 'string' && scenarioIdMap.has(row.oldParentId)) data.parentId = scenarioIdMap.get(row.oldParentId)!
        if (typeof row.oldFragmentId === 'string') data.fragmentId = fragmentIdMap.get(row.oldFragmentId) ?? null
        if (typeof row.oldFragmentId === 'string' && !fragmentIdMap.has(row.oldFragmentId)) scenarioFragmentDrops += 1
        if (Object.keys(data).length) {
          await tx.scenario.update({
            where: { id: row.newId },
            data,
          })
        }
      }
      if (scenarioFragmentDrops > 0) {
        warnings.push(
          `привязка к фрагментам сброшена у ${scenarioFragmentDrops} сценария(ев) — фрагменты не входят в архив, пересоздаются локальным анализом`
        )
      }

      // ---- runs ----
      const runIdMap = new Map<string, string>()
      const runRows: { newId: string; oldParentRunId: unknown }[] = []
      const runs = Array.isArray(aProject.runs) ? aProject.runs : []
      let runScenarioDrops = 0
      for (const rRaw of runs) {
        const r = rRaw as Record<string, unknown>
        const remapScenario =
          typeof r.scenarioId === 'string' ? scenarioIdMap.get(r.scenarioId) ?? null : null
        if (typeof r.scenarioId === 'string' && !remapScenario) runScenarioDrops += 1
        const inputObj = isPlainObject(r.input) || Array.isArray(r.input) ? r.input : {}
        const newRun = await tx.run.create({
          data: {
            projectId: project.id,
            scenarioId: remapScenario,
            versionId: typeof r.versionId === 'string' ? versionIdMap.get(r.versionId) ?? null : null,
            role: typeof r.role === 'string' ? r.role : 'executor',
            backend: typeof r.backend === 'string' ? r.backend : 'demo',
            connectionId: null, // connections are not part of the archive
            connectionName: str(r.connectionName),
            model: str(r.model),
            status: typeof r.status === 'string' ? r.status : 'completed',
            input: JSON.stringify(inputObj),
            output: str(r.output),
            error: str(r.error),
            verdict: str(r.verdict),
            verdictBy: str(r.verdictBy),
            modelVerdict: str(r.modelVerdict),
            modelVerdictBy: str(r.modelVerdictBy),
            durationMs: typeof r.durationMs === 'number' ? r.durationMs : null,
            tokensIn: typeof r.tokensIn === 'number' ? r.tokensIn : null,
            tokensOut: typeof r.tokensOut === 'number' ? r.tokensOut : null,
            origin: r.origin === 'demo' ? 'demo' : 'real',
            createdAt: toDate(r.createdAt),
            startedAt: r.startedAt != null ? toDate(r.startedAt) : null,
            finishedAt: r.finishedAt != null ? toDate(r.finishedAt) : null,
          },
        })
        if (typeof r.id === 'string') runIdMap.set(r.id, newRun.id)
        runRows.push({ newId: newRun.id, oldParentRunId: r.parentRunId })
      }
      for (const row of runRows) {
        if (typeof row.oldParentRunId === 'string' && runIdMap.has(row.oldParentRunId)) {
          await tx.run.update({
            where: { id: row.newId },
            data: { parentRunId: runIdMap.get(row.oldParentRunId)! },
          })
        }
      }
      const modelCalls = Array.isArray(aProject.modelCalls) ? aProject.modelCalls : []
      const modelCallIdMap = new Map<string, string>()
      const modelCallRows: { id: string; sourceRelatedEntities: unknown; sourceContextMetadata: unknown }[] = []
      let droppedModelCallRunLinks = 0
      for (const callRaw of modelCalls) {
        const call = callRaw as Record<string, unknown>
        const oldRunId = typeof call.runId === 'string' ? call.runId : null
        const newRunId = oldRunId ? runIdMap.get(oldRunId) ?? null : null
        if (oldRunId && !newRunId) droppedModelCallRunLinks += 1
        const versionId = typeof call.versionId === 'string' ? versionIdMap.get(call.versionId) ?? null : null
        const newCall = await tx.modelCall.create({
          data: {
            projectId: project.id, runId: newRunId,
            role: typeof call.role === 'string' ? call.role : 'executor',
            action: typeof call.action === 'string' ? call.action : 'imported-archive',
            versionId,
            contextMode: typeof call.contextMode === 'string' ? call.contextMode : 'unknown',
            contextMetadata: JSON.stringify(remapSourceIds(call.contextMetadata, { modelCallIdMap, versionIdMap, fragmentIdMap })),
            messages: JSON.stringify(Array.isArray(call.messages) ? call.messages : []),
            backend: typeof call.backend === 'string' ? call.backend : 'unknown',
            connectionId: null, connectionName: str(call.connectionName),
            requestedModel: str(call.requestedModel), actualProvider: str(call.actualProvider), actualModel: str(call.actualModel),
            status: typeof call.status === 'string' ? call.status : 'unknown',
            relatedEntities: JSON.stringify([]),
            createdAt: toDate(call.createdAt),
          },
        })
        if (typeof call.id === 'string') modelCallIdMap.set(call.id, newCall.id)
        modelCallRows.push({ id: newCall.id, sourceRelatedEntities: call.relatedEntities, sourceContextMetadata: call.contextMetadata })
      }
      if (droppedModelCallRunLinks) warnings.push(`${droppedModelCallRunLinks} запись(ей) вызова потеряла связь с Run при импорте`)
      if (runScenarioDrops > 0) {
        warnings.push(`${runScenarioDrops} запуск(ов) потеряли ссылку на сценарий (сценарий отсутствует в архиве)`)
      }

      // ---- findings ----
      const findings = Array.isArray(aProject.findings) ? aProject.findings : []
      let findingFragmentDrops = 0
      for (const fRaw of findings) {
        const f = fRaw as Record<string, unknown>
        if (f.fragmentId && !fragmentIdMap.has(String(f.fragmentId))) findingFragmentDrops += 1
        await tx.finding.create({
          data: {
            projectId: project.id,
            versionId: typeof f.versionId === 'string' ? versionIdMap.get(f.versionId) ?? null : null,
            fragmentId: typeof f.fragmentId === 'string' ? fragmentIdMap.get(f.fragmentId) ?? null : null,
            scenarioId: typeof f.scenarioId === 'string' ? scenarioIdMap.get(f.scenarioId) ?? null : null,
            runId: typeof f.runId === 'string' ? runIdMap.get(f.runId) ?? null : null,
            title: String(f.title ?? 'Находка'),
            description: String(f.description ?? ''),
            severity: typeof f.severity === 'string' ? f.severity : 'info',
            status: typeof f.status === 'string' ? f.status : 'hypothesis',
            provenance: typeof f.provenance === 'string' ? f.provenance : 'local-heuristic',
            origin: f.origin === 'demo' ? 'demo' : 'real',
            evidence: JSON.stringify(isPlainObject(f.evidence) ? f.evidence : {}),
            createdAt: toDate(f.createdAt),
          },
        })
      }
      if (findingFragmentDrops > 0) {
        warnings.push(`${findingFragmentDrops} находка(и) потеряли привязку к фрагментам — фрагменты не входят в архив`)
      }

      // ---- notes ----
      const notes = Array.isArray(aProject.notes) ? aProject.notes : []
      const noteIdMap = new Map<string, string>()
      let noteFragmentDrops = 0
      for (const nRaw of notes) {
        const n = nRaw as Record<string, unknown>
        if (n.fragmentId && !fragmentIdMap.has(String(n.fragmentId))) noteFragmentDrops += 1
        const newNote = await tx.note.create({
          data: {
            projectId: project.id,
            versionId: typeof n.versionId === 'string' ? versionIdMap.get(n.versionId) ?? null : null,
            fragmentId: typeof n.fragmentId === 'string' ? fragmentIdMap.get(n.fragmentId) ?? null : null,
            kind: typeof n.kind === 'string' ? n.kind : 'note',
            body: String(n.body ?? ''),
            author: typeof n.author === 'string' ? n.author : 'user',
            origin: n.origin === 'demo' ? 'demo' : 'real',
            linkedRunId: typeof n.linkedRunId === 'string' ? runIdMap.get(n.linkedRunId) ?? null : null,
            createdAt: toDate(n.createdAt),
          },
        })
        if (typeof n.id === 'string') noteIdMap.set(n.id, newNote.id)
      }
      if (noteFragmentDrops > 0) {
        warnings.push(`${noteFragmentDrops} заметка(и) потеряли привязку к фрагментам — фрагменты не входят в архив`)
      }

      // ---- assignments (connection refs dropped by design) ----
      const assignments = Array.isArray(aProject.assignments) ? aProject.assignments : []
      let assignmentConnectionDrops = 0
      for (const aRaw of assignments) {
        const a = aRaw as Record<string, unknown>
        if (a.connectionId) assignmentConnectionDrops += 1
        await tx.assignment.create({
          data: {
            projectId: project.id,
            role: typeof a.role === 'string' ? a.role : 'executor',
            backend: str(a.backend),
            connectionId: null,
            model: str(a.model),
          },
        })
      }
      if (assignments.length > 0 && assignmentConnectionDrops > 0) {
        warnings.push(
          'назначения моделей переносятся без подключений — подключения не входят в архив; подключите модели заново в кабинете подключений'
        )
      }

      // ---- chat messages ----
      const chatMessages = Array.isArray(aProject.chatMessages) ? aProject.chatMessages : []
      const chatMessageIdMap = new Map<string, string>()
      let chatFragmentDrops = 0
      for (const mRaw of chatMessages) {
        const m = mRaw as Record<string, unknown>
        if (m.contextFragmentId && !fragmentIdMap.has(String(m.contextFragmentId))) chatFragmentDrops += 1
        const metadata = remapSourceIds(m.responseMetadata, { modelCallIdMap, versionIdMap, fragmentIdMap })
        const newMessage = await tx.chatMessage.create({
          data: {
            projectId: project.id,
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: String(m.content ?? ''),
            backend: str(m.backend),
            model: str(m.model),
            responseMetadata: isPlainObject(metadata) && Object.keys(metadata).length ? JSON.stringify(metadata) : null,
            contextFragmentId: typeof m.contextFragmentId === 'string' ? fragmentIdMap.get(m.contextFragmentId) ?? null : null,
            createdAt: toDate(m.createdAt),
          },
        })
        if (typeof m.id === 'string') chatMessageIdMap.set(m.id, newMessage.id)
      }
      if (chatFragmentDrops > 0) {
        warnings.push(`${chatFragmentDrops} сообщение(й) чата потеряли контекст фрагмента — фрагменты не входят в архив`)
      }

      // ---- analyses (result object -> JSON string) ----
      const analyses = Array.isArray(aProject.analyses) ? aProject.analyses : []
      const analysisIdMap = new Map<string, string>()
      const operationIdMap = new Map<string, string>()
      let droppedAnalyses = 0
      for (const aRaw of analyses) {
        const a = aRaw as Record<string, unknown>
        const remappedVersionId =
          typeof a.versionId === 'string' ? versionIdMap.get(a.versionId) : undefined
        if (!remappedVersionId) {
          droppedAnalyses += 1
          continue
        }
        const newAnalysis = await tx.analysis.create({
          data: {
            versionId: remappedVersionId,
            projectId: project.id,
            type: typeof a.type === 'string' ? a.type : 'local-structural',
            backend: typeof a.backend === 'string' ? a.backend : 'local',
            model: str(a.model),
            status: typeof a.status === 'string' ? a.status : 'completed',
            summary: typeof a.summary === 'string' ? a.summary : '',
            result: JSON.stringify(remapSourceIds(a.result, { modelCallIdMap, versionIdMap, fragmentIdMap })),
            error: str(a.error),
            durationMs: typeof a.durationMs === 'number' ? a.durationMs : null,
            fragmentCount: typeof a.fragmentCount === 'number' ? a.fragmentCount : null,
            createdAt: toDate(a.createdAt),
          },
        })
        if (typeof a.id === 'string') {
          analysisIdMap.set(a.id, newAnalysis.id)
          if (isPlainObject(a.result) && typeof a.result.operationId === 'string') operationIdMap.set(a.result.operationId, newAnalysis.id)
        }
      }
      if (droppedAnalyses > 0) {
        warnings.push(`${droppedAnalyses} анализ(ов) не перенесён(ы) — версия, к которой они относились, отсутствует в архиве`)
      }

      // ---- semantic positions, relations and observations ----
      const positionIdMap = new Map<string, string>()
      const relationIdMap = new Map<string, string>()
      const semanticPositions = Array.isArray(aProject.semanticPositions) ? aProject.semanticPositions : []
      for (const raw of semanticPositions) {
        if (!isPlainObject(raw)) continue
        const newVersionId = typeof raw.versionId === 'string' ? versionIdMap.get(raw.versionId) : null
        if (!newVersionId) { warnings.push(`смысловое положение «${String(raw.title ?? '')}» пропущено: версия отсутствует в архиве`); continue }
        const refs = Array.isArray(raw.fragments) ? raw.fragments.filter(isPlainObject) : []
        const liveLinks = refs.flatMap((ref) => typeof ref.id === 'string' && fragmentIdMap.has(ref.id) ? [{ fragmentId: fragmentIdMap.get(ref.id)! }] : [])
        const historicalRefs = refs.filter((ref) => typeof ref.id !== 'string' || !fragmentIdMap.has(ref.id)).map((ref) => ({ id: str(ref.id), path: str(ref.path), textHash: str(ref.textHash) }))
        if (historicalRefs.length) warnings.push(`положение «${String(raw.title ?? '')}»: ${historicalRefs.length} исходных ссылок не сопоставлены; они сохранены как исторические`)
        const provenanceRef = typeof raw.provenanceRef === 'string' ? analysisIdMap.get(raw.provenanceRef) ?? null : null
        if (typeof raw.provenanceRef === 'string' && !provenanceRef) warnings.push(`активная provenanceRef положения «${String(raw.title ?? '')}» не создана: Analysis отсутствует в архиве`)
        const importedPosition = await tx.semanticPosition.create({ data: {
          projectId: project.id, versionId: newVersionId,
          title: String(raw.title ?? 'Положение'), purpose: String(raw.purpose ?? ''),
          regulatedDecision: String(raw.regulatedDecision ?? ''), conditions: String(raw.conditions ?? ''),
          expectedBehavior: String(raw.expectedBehavior ?? ''), limitations: String(raw.limitations ?? ''),
          provenance: raw.provenance === 'model-interpret' ? 'model-interpret' : 'user',
          provenanceRef,
          sourceFragmentRefs: JSON.stringify(remapSourceIds(raw.sourceFragmentRefs ?? historicalRefs, { modelCallIdMap, versionIdMap, fragmentIdMap, analysisIdMap })),
          status: ['proposed', 'accepted', 'disputed'].includes(String(raw.status)) ? String(raw.status) : 'proposed',
          createdAt: toDate(raw.createdAt), updatedAt: toDate(raw.updatedAt),
          fragments: { create: liveLinks },
        } })
        if (typeof raw.id === 'string') positionIdMap.set(raw.id, importedPosition.id)
      }
      const relations = Array.isArray(aProject.semanticRelations) ? aProject.semanticRelations : []
      for (const raw of relations) {
        if (!isPlainObject(raw) || typeof raw.sourcePositionId !== 'string' || typeof raw.targetPositionId !== 'string') { warnings.push('связь смысловых положений пропущена: отсутствуют корректные source/target ID'); continue }
        const sourcePositionId = positionIdMap.get(raw.sourcePositionId), targetPositionId = positionIdMap.get(raw.targetPositionId)
        const versionId = typeof raw.versionId === 'string' ? versionIdMap.get(raw.versionId) : null
        if (!sourcePositionId || !targetPositionId || !versionId) { warnings.push(`связь смысловых положений ${String(raw.id ?? '')} пропущена: source, target или версия отсутствуют в архиве`); continue }
        const newRelation = await tx.semanticRelation.create({ data: {
          projectId: project.id, versionId, sourcePositionId, targetPositionId,
          kind: String(raw.kind ?? 'supports'), rationale: String(raw.rationale ?? ''),
          provenance: raw.provenance === 'model-proposal' ? 'model-proposal' : 'user',
          status: ['proposed', 'accepted', 'disputed'].includes(String(raw.status)) ? String(raw.status) : 'proposed',
          createdAt: toDate(raw.createdAt),
        } })
        if (typeof raw.id === 'string') relationIdMap.set(raw.id, newRelation.id)
      }
      const observations = Array.isArray(aProject.positionObservations) ? aProject.positionObservations : []
      const observationIdMap = new Map<string, string>()
      for (const raw of observations) {
        if (!isPlainObject(raw) || typeof raw.positionId !== 'string') continue
        const positionId = positionIdMap.get(raw.positionId)
        const versionId = typeof raw.versionId === 'string' ? versionIdMap.get(raw.versionId) : null
        if (!positionId || !versionId) { warnings.push(`наблюдение положения ${String(raw.id ?? '')} пропущено: положение или версия отсутствуют в архиве`); continue }
        const oldRunId = typeof raw.runId === 'string' ? raw.runId : typeof raw.sourceRunId === 'string' ? raw.sourceRunId : null
        const oldNoteId = typeof raw.noteId === 'string' ? raw.noteId : typeof raw.sourceNoteId === 'string' ? raw.sourceNoteId : null
        const runId = oldRunId ? runIdMap.get(oldRunId) ?? null : null
        const noteId = oldNoteId ? noteIdMap.get(oldNoteId) ?? null : null
        const importedObservation = await tx.positionObservation.create({ data: {
          projectId: project.id, versionId, positionId, runId, noteId,
          sourceRunId: oldRunId && !runId ? oldRunId : null,
          sourceNoteId: oldNoteId && !noteId ? oldNoteId : null,
          observation: String(raw.observation ?? ''), evidenceText: String(raw.evidenceText ?? ''),
          conditions: String(raw.conditions ?? ''), criterion: String(raw.criterion ?? ''),
          status: String(raw.status ?? 'unverified'), limitations: String(raw.limitations ?? ''),
          createdAt: toDate(raw.createdAt),
        } })
        if (typeof raw.id === 'string') observationIdMap.set(raw.id, importedObservation.id)
      }

      // Structured research-discrepancy Notes keep live IDs and retain omitted records separately.
      for (const raw of notes) {
        if (!isPlainObject(raw) || typeof raw.id !== 'string') continue
        const importedNoteId = noteIdMap.get(raw.id)
        if (importedNoteId && raw.author === 'user' && raw.kind === 'user-verdict' && typeof raw.body === 'string') {
          try {
            const event = JSON.parse(raw.body) as Record<string, unknown>
            if (event.type === 's2-user-decision-history' && typeof event.objectId === 'string') {
              const objectMap = event.objectType === 'semantic-position' ? positionIdMap
                : event.objectType === 'semantic-relation' ? relationIdMap
                : event.objectType === 'research-discrepancy' ? noteIdMap : null
              if (objectMap) {
                const mappedId = objectMap.get(event.objectId)
                if (mappedId) event.objectId = mappedId
                else { event.sourceObjectId = event.objectId; delete event.objectId }
                await tx.note.update({ where: { id: importedNoteId }, data: { body: JSON.stringify(event) } })
              }
            }
          } catch { /* Preserve malformed historical event bodies verbatim. */ }
        }
        const payload = typeof raw.body === 'string' ? parseResearchDiscrepancy(raw.body) : null
        if (!importedNoteId || !payload) continue
        const remapped = remapResearchDiscrepancyIds(payload, {
          run: runIdMap, observation: observationIdMap, position: positionIdMap, fragment: fragmentIdMap, scenario: scenarioIdMap,
        })
        await tx.note.update({ where: { id: importedNoteId }, data: { body: JSON.stringify(remapped) } })
      }

      // ---- bounded research campaigns (unfinished work is imported blocked) ----
      const campaignIdMap = new Map<string, string>()
      const campaignPositionIdMap = new Map<string, string>()
      const campaignCheckIdMap = new Map<string, string>()
      const campaignActionIdMap = new Map<string, string>()
      const campaignPolicySnapshotMap = new Map<string, unknown>()
      const campaignArchives = Array.isArray(aProject.researchCampaigns) ? aProject.researchCampaigns.filter(isPlainObject) : []
      for (const source of campaignArchives) {
        const versionId = typeof source.versionId === 'string' ? versionIdMap.get(source.versionId) : null
        if (!versionId) { warnings.push(`кампания ${String(source.id ?? '')} пропущена: версия не включена в архив`); continue }
        const sourceItems = Array.isArray(source.items) ? source.items.filter(isPlainObject) : []
        const sourceActions = Array.isArray(source.actions) ? source.actions.filter(isPlainObject) : []
        const unresolved = ['running', 'paused'].includes(String(source.status))
          || sourceActions.some((action) => action.status === 'planned' || action.status === 'running')
          || sourceItems.some((item) => item.status === 'in-progress')
        const state = importedCampaignState(String(source.status ?? 'prepared'), unresolved)
        let sourceScope = source.scopeSnapshot
        if (typeof sourceScope === 'string') {
          try { sourceScope = JSON.parse(sourceScope) as unknown } catch { sourceScope = {} }
        }
        const sourcePolicy = isPlainObject(source.policy) ? { ...source.policy } : {
          maxScenariosPerPosition: source.maxScenariosPerPosition,
          maxModelActions: source.maxModelActions,
          maxAdditionalChecksPerPosition: source.maxAdditionalChecksPerPosition,
          maxRetriesPerAction: source.maxRetriesPerAction,
          maxConcurrent: source.maxConcurrent,
          stopOnQuota: source.stopOnQuota,
          stopOnTechnicalError: source.stopOnTechnicalError,
          allowRewriteExperiment: source.allowRewriteExperiment,
          budgetHistory: source.budgetHistory,
        }
        const processHistory = Array.isArray(source.processHistory) ? source.processHistory
          : typeof source.processHistory === 'string' ? safeParse<unknown[]>(source.processHistory, []) : []
        const importedProcessHistory = [...processHistory]
        if (sourcePolicy.allowRewriteExperiment === true || (typeof sourcePolicy.maxConcurrent === 'number' && sourcePolicy.maxConcurrent !== 1)) {
          const policySnapshot = { at: new Date().toISOString(), action: 'imported-policy-snapshot', basis: 'Историческая policy исходной кампании; импортируемое выполнение использует безопасные настройки.', sourcePolicy }
          importedProcessHistory.push(policySnapshot)
          if (typeof source.id === 'string') campaignPolicySnapshotMap.set(source.id, policySnapshot)
        }
        const campaign = await tx.researchCampaign.create({ data: {
          projectId: project.id, versionId, contentHash: String(source.contentHash ?? ''),
          scopeType: String(source.scopeType ?? 'positions'),
          scopeSnapshot: JSON.stringify(remapSourceIds(sourceScope, { modelCallIdMap, versionIdMap, fragmentIdMap, positionIdMap })),
          depth: String(source.depth ?? 'full'), maxScenariosPerPosition: Number(source.maxScenariosPerPosition ?? 2),
          predecessorCampaignId: null,
          processHistory: JSON.stringify(importedProcessHistory),
          maxModelActions: source.policy && isPlainObject(source.policy)
            ? (source.policy.maxModelActions === null ? null : Number(source.policy.maxModelActions ?? source.maxModelActions ?? 20))
            : (source.maxModelActions === null ? null : Number(source.maxModelActions ?? 20)),
          budgetHistory: JSON.stringify(Array.isArray(source.policy && isPlainObject(source.policy) ? source.policy.budgetHistory : source.budgetHistory)
            ? (source.policy && isPlainObject(source.policy) ? source.policy.budgetHistory : source.budgetHistory)
            : []),
          maxAdditionalChecksPerPosition: Number(source.maxAdditionalChecksPerPosition ?? 1),
          maxRetriesPerAction: Number(source.maxRetriesPerAction ?? 3), maxConcurrent: 1,
          stopOnQuota: source.stopOnQuota !== false, stopOnTechnicalError: source.stopOnTechnicalError === true,
          allowRewriteExperiment: false, status: state === 'blocked-reconciliation' ? 'blocked' : String(source.status ?? 'prepared'),
          stage: String(source.stage ?? 'interpretation'), modelActionsUsed: Number(source.modelActionsUsed ?? 0),
          unmappedFragmentsCount: Number(source.unmappedFragmentsCount ?? 0),
          pauseReason: state === 'blocked-reconciliation' ? 'import-reconciliation' : str(source.pauseReason),
          lastError: state === 'blocked-reconciliation' ? 'Imported campaign requires review before it can continue.' : str(source.lastError),
          startedAt: source.startedAt ? toDate(source.startedAt) : null, finishedAt: source.finishedAt ? toDate(source.finishedAt) : null,
          createdAt: toDate(source.createdAt), updatedAt: toDate(source.updatedAt),
        } })
        if (typeof source.id === 'string') campaignIdMap.set(source.id, campaign.id)
        const roles = Array.isArray(source.roles) ? source.roles.filter(isPlainObject) : []
        for (const role of roles) await tx.researchCampaignRole.create({ data: {
          campaignId: campaign.id, role: String(role.role ?? 'executor'), backend: String(role.backend ?? 'unknown'),
          connectionId: 'source-connection-unavailable', connectionName: String(role.connectionName ?? 'Источник архива'), model: String(role.model ?? 'unknown'),
        } })
        for (const item of sourceItems) {
          const positionId = typeof item.positionId === 'string' ? positionIdMap.get(item.positionId) : null
          if (!positionId) { warnings.push(`элемент кампании пропущен: положение ${String(item.positionId ?? '')} отсутствует в архиве`); continue }
          const itemStatus = state === 'blocked-reconciliation' && item.status === 'in-progress' ? 'blocked' : String(item.status ?? 'unexplored')
          const importedItem = await tx.researchCampaignPosition.create({ data: {
            campaignId: campaign.id, positionId, order: Number(item.order ?? 0), status: itemStatus,
            stage: String(item.stage ?? 'interpretation'), interpretationStatus: String(item.interpretationStatus ?? 'pending'),
            interactionStatus: String(item.interactionStatus ?? 'pending'), scenarioStatus: String(item.scenarioStatus ?? 'pending'),
            executionStatus: String(item.executionStatus ?? 'pending'), reviewStatus: String(item.reviewStatus ?? 'pending'),
            verifiedSourceEvidence: item.verifiedSourceEvidence === true, additionalChecksUsed: Number(item.additionalChecksUsed ?? 0),
            conclusion: state === 'blocked-reconciliation' && itemStatus === 'blocked' ? 'blocked' : String(item.conclusion ?? 'not-explored'),
            conclusionSummary: state === 'blocked-reconciliation' && itemStatus === 'blocked' ? 'Импортированная незавершённая кампания требует сверки.' : str(item.conclusionSummary),
            limitations: str(item.limitations), startedAt: item.startedAt ? toDate(item.startedAt) : null,
            finishedAt: item.finishedAt ? toDate(item.finishedAt) : null, createdAt: toDate(item.createdAt), updatedAt: toDate(item.updatedAt),
          } })
          if (typeof item.id === 'string') campaignPositionIdMap.set(item.id, importedItem.id)
          const checks = Array.isArray(item.checks) ? item.checks.filter(isPlainObject) : []
          for (const check of checks) {
            const scenarioId = typeof check.scenarioId === 'string' ? scenarioIdMap.get(check.scenarioId) : null
            if (!scenarioId) { warnings.push(`критерий кампании ${String(check.id ?? '')} пропущен: сценарий отсутствует в архиве`); continue }
            const importedCheck = await tx.researchCampaignCheck.create({ data: {
              campaignPositionId: importedItem.id, scenarioId, ordinal: Number(check.ordinal ?? 0),
              objective: String(check.objective ?? ''), input: String(check.input ?? ''), expectedBehavior: String(check.expectedBehavior ?? ''),
              criterion: String(check.criterion ?? ''), status: String(check.status ?? 'planned'), createdAt: toDate(check.createdAt),
            } })
            if (typeof check.id === 'string') campaignCheckIdMap.set(check.id, importedCheck.id)
            const sources = Array.isArray(check.sources) ? check.sources.filter(isPlainObject) : []
            for (const sourceRef of sources) {
              const fragmentId = typeof sourceRef.fragmentId === 'string' ? fragmentIdMap.get(sourceRef.fragmentId) : null
              if (fragmentId) await tx.researchCampaignCheckSource.create({ data: { checkId: importedCheck.id, fragmentId } })
              else warnings.push(`источник критерия кампании ${String(check.id ?? '')} пропущен: фрагмент отсутствует в архиве`)
            }
          }
          const notApplicable = Array.isArray(item.notApplicableChecks) ? item.notApplicableChecks.filter(isPlainObject) : []
          for (const row of notApplicable) await tx.researchCampaignNotApplicableCheck.create({ data: {
            campaignPositionId: importedItem.id, checkType: String(row.checkType ?? 'unknown'), rationale: String(row.rationale ?? ''), createdAt: toDate(row.createdAt),
          } })
        }
        for (const action of sourceActions) {
          const campaignPositionId = typeof action.campaignPositionId === 'string' ? campaignPositionIdMap.get(action.campaignPositionId) : null
          if (!campaignPositionId) { warnings.push(`действие кампании ${String(action.id ?? '')} пропущено: позиция отсутствует в архиве`); continue }
          const runId = typeof action.runId === 'string' ? runIdMap.get(action.runId) ?? null : null
          const checkId = typeof action.checkId === 'string' ? campaignCheckIdMap.get(action.checkId) ?? null : null
          if (typeof action.runId === 'string' && !runId) warnings.push(`ссылка действия кампании ${String(action.id ?? '')} на Run не восстановлена: Run отсутствует в архиве`)
          if (typeof action.checkId === 'string' && !checkId) warnings.push(`ссылка действия кампании ${String(action.id ?? '')} на критерий не восстановлена: критерий отсутствует в архиве`)
          if (typeof action.scenarioId === 'string' && !scenarioIdMap.has(action.scenarioId)) warnings.push(`ссылка действия кампании ${String(action.id ?? '')} на сценарий не восстановлена: сценарий отсутствует в архиве`)
          const actionStatus = state === 'blocked-reconciliation' && (action.status === 'planned' || action.status === 'running') ? 'blocked' : String(action.status ?? 'planned')
          const importedAction = await tx.researchCampaignAction.create({ data: {
            actionKey: `import:${campaign.id}:${String(action.id ?? randomUUID())}`,
            campaignId: campaign.id, campaignPositionId, scenarioId: typeof action.scenarioId === 'string' ? scenarioIdMap.get(action.scenarioId) ?? null : null,
            checkId, actionType: String(action.actionType ?? 'imported'), role: String(action.role ?? 'executor'),
            attempt: Number(action.attempt ?? 1), status: actionStatus,
            error: state === 'blocked-reconciliation' && actionStatus === 'blocked' ? 'Requires reconciliation after import.' : str(action.error),
            startedAt: action.startedAt ? toDate(action.startedAt) : null, finishedAt: action.finishedAt ? toDate(action.finishedAt) : null,
            createdAt: toDate(action.createdAt), updatedAt: toDate(action.updatedAt),
            sources: { create: (Array.isArray(action.sources) ? action.sources.filter(isPlainObject) : []).flatMap((ref) => {
              const fragmentId = typeof ref.fragmentId === 'string' ? fragmentIdMap.get(ref.fragmentId) : null
              if (!fragmentId) warnings.push(`источник действия кампании ${String(action.id ?? '')} пропущен: фрагмент отсутствует в архиве`)
              return fragmentId ? [{ fragmentId }] : []
            }) },
          } })
          if (typeof action.id === 'string') campaignActionIdMap.set(action.id, importedAction.id)
          if (runId) await tx.run.update({ where: { id: runId }, data: { campaignActionId: importedAction.id } })
        }
      }
      for (const source of campaignArchives) {
        if (!isPlainObject(source) || typeof source.id !== 'string') continue
        const importedId = campaignIdMap.get(source.id)
        if (typeof source.predecessorCampaignId === 'string') {
          const predecessorId = campaignIdMap.get(source.predecessorCampaignId)
          if (importedId && predecessorId) await tx.researchCampaign.update({ where: { id: importedId }, data: { predecessorCampaignId: predecessorId } })
          else if (importedId) warnings.push(`предшествующая кампания ${source.predecessorCampaignId} отсутствует в архиве; локальная связь не создана`)
        }
        const importedIdForHistory = campaignIdMap.get(source.id)
        const sourceHistory = Array.isArray(source.processHistory) ? source.processHistory : typeof source.processHistory === 'string' ? safeParse<unknown[]>(source.processHistory, []) : []
        if (importedIdForHistory && sourceHistory.length) {
          const { history: remappedHistory, warnings: historyWarnings } = remapCampaignProcessHistory(sourceHistory, campaignIdMap)
          warnings.push(...historyWarnings)
          const importedPolicySnapshot = campaignPolicySnapshotMap.get(source.id)
          if (importedPolicySnapshot) remappedHistory.push(importedPolicySnapshot)
          await tx.researchCampaign.update({ where: { id: importedIdForHistory }, data: { processHistory: JSON.stringify(remappedHistory) } })
        }
      }
      if (campaignArchives.length) warnings.push('Подключения кампаний сохранены только как исторические снимки; импортированные незавершённые действия заблокированы для ручной сверки.')
      if (semanticPositions.length && aProject.semanticIndexPolicy === 'rebuild-on-import') {
        warnings.push('Векторный индекс не переносился: по политике rebuild-on-import выберите записи и постройте индекс заново с текущим назначением Ollama.')
      }

      for (const [sourceId, importedId] of analysisIdMap) {
        const sourceAnalysis = analyses.find((entry) => isPlainObject(entry) && entry.id === sourceId)
        if (!isPlainObject(sourceAnalysis)) continue
        const remapped = remapSourceIds(sourceAnalysis.result, { modelCallIdMap, versionIdMap, fragmentIdMap, analysisIdMap, positionIdMap, relationIdMap, operationIdMap }) as Record<string, unknown>
        if (isPlainObject(remapped) && sourceAnalysis.type === 'functional-semantic-contour') remapped.importedIndexRebuildRequired = true
        await tx.analysis.update({ where: { id: importedId }, data: { result: JSON.stringify(remapped) } })
      }

      for (const row of modelCallRows) {
        const relatedEntities = remapRelatedEntities(row.sourceRelatedEntities, { runIdMap, scenarioIdMap, versionIdMap, analysisIdMap, positionIdMap, relationIdMap, chatMessageIdMap, fragmentIdMap, campaignIdMap, campaignPositionIdMap, campaignActionIdMap })
        const runReference = relatedEntities.find((entity) => entity.startsWith('run:'))
        await tx.modelCall.update({
          where: { id: row.id },
          data: {
            contextMetadata: JSON.stringify(remapSourceIds(row.sourceContextMetadata, { modelCallIdMap, versionIdMap, fragmentIdMap, analysisIdMap, positionIdMap, relationIdMap, operationIdMap })),
            relatedEntities: JSON.stringify(relatedEntities),
            ...(runReference ? { runId: runReference.slice('run:'.length) } : {}),
          },
        })
      }

      // Runs are imported before ModelCalls; remap their embedded provenance now.
      for (const [sourceId, importedId] of runIdMap) {
        const sourceRun = runs.find((entry) => isPlainObject(entry) && entry.id === sourceId)
        if (!isPlainObject(sourceRun) || !isPlainObject(sourceRun.input)) continue
        const input = { ...sourceRun.input }
        const sourceCallId = isPlainObject(input.responseMetadata) && typeof input.responseMetadata.modelCallId === 'string'
          ? input.responseMetadata.modelCallId
          : typeof input.modelCallId === 'string' ? input.modelCallId : null
        const commonMaps = { modelCallIdMap, versionIdMap, fragmentIdMap }
        if (isPlainObject(input.contextProvenance)) input.contextProvenance = remapSourceIds(input.contextProvenance, commonMaps)
        if (isPlainObject(input.responseMetadata)) input.responseMetadata = remapSourceIds(input.responseMetadata, commonMaps)
        if (typeof input.modelCallId === 'string') {
          const mapped = modelCallIdMap.get(input.modelCallId)
          if (mapped) input.modelCallId = mapped
          else { input.sourceModelCallId = input.modelCallId; delete input.modelCallId }
        }
        const importedCallId = sourceCallId ? modelCallIdMap.get(sourceCallId) : null
        if (importedCallId) {
          await tx.modelCall.update({ where: { id: importedCallId }, data: { runId: importedId } })
        }
        const runInputRefs = remapRunInputReferences(input, { versionIdMap, fragmentIdMap, scenarioIdMap, runIdMap })
        warnings.push(...runInputRefs.warnings)
        await tx.run.update({ where: { id: importedId }, data: { input: JSON.stringify(runInputRefs.input) } })
      }

      return project
    },
    { timeout: 60_000, maxWait: 10_000 }
  )

  if (!Array.isArray(aProject.analyses) || aProject.analyses.length === 0) {
    warnings.push('Архив не содержит Analysis; если нужен локальный структурный разбор, запустите его вручную после импорта.')
  }

  const fresh = await db.project.findUnique({ where: { id: created.id } })
  return { project: toProjectDTO(fresh ?? created), warnings }
}
