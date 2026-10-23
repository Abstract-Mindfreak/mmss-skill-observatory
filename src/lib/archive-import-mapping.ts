export function remapCampaignProcessHistory(
  history: unknown[],
  campaignIdMap: Map<string, string>
): { history: unknown[]; warnings: string[] } {
  const warnings: string[] = []
  const remapped = history.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
    const event = entry as Record<string, unknown>
    const sourceId = typeof event.relatedCampaignId === 'string' ? event.relatedCampaignId
      : typeof event.sourceRelatedCampaignId === 'string' ? event.sourceRelatedCampaignId : null
    if (!sourceId) return entry
    const relatedCampaignId = campaignIdMap.get(sourceId)
    const { relatedCampaignId: _relatedCampaignId, sourceRelatedCampaignId: _sourceRelatedCampaignId, ...withoutLiveRef } = event
    if (relatedCampaignId) return { ...withoutLiveRef, relatedCampaignId }
    warnings.push(`историческая ссылка кампании ${sourceId} не разрешена в локальную запись`)
    return { ...withoutLiveRef, sourceRelatedCampaignId: sourceId }
  })
  return { history: remapped, warnings }
}

export function makeCampaignProcessHistoryPortable(value: unknown): unknown[] {
  const history = Array.isArray(value) ? value : []
  return history.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
    const event = entry as Record<string, unknown>
    if (typeof event.relatedCampaignId !== 'string') return entry
    const { relatedCampaignId, ...rest } = event
    return { ...rest, sourceRelatedCampaignId: relatedCampaignId }
  })
}

export interface RunInputReferenceMaps {
  versionIdMap: ReadonlyMap<string, string>
  fragmentIdMap: ReadonlyMap<string, string>
  scenarioIdMap: ReadonlyMap<string, string>
  runIdMap: ReadonlyMap<string, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function preserveHistoricalReference(target: Record<string, unknown>, field: string, id: string): void {
  const existing = target[field]
  if (existing === undefined || existing === id) {
    target[field] = id
  } else if (Array.isArray(existing)) {
    if (!existing.includes(id)) target[field] = [...existing, id]
  } else {
    target[field] = [existing, id]
  }
}

function remapSingleReference(
  target: Record<string, unknown>,
  field: string,
  historicalField: string,
  map: ReadonlyMap<string, string>,
  path: string,
  warnings: string[]
): void {
  const sourceId = target[field]
  if (typeof sourceId !== 'string' || sourceId.startsWith('source:')) return
  const importedId = map.get(sourceId)
  if (importedId) {
    target[field] = importedId
    return
  }
  delete target[field]
  preserveHistoricalReference(target, historicalField, sourceId)
  warnings.push(`${path}: цель не найдена; ссылка сохранена как историческая`)
}

function remapReferenceArray(
  target: Record<string, unknown>,
  field: string,
  historicalField: string,
  map: ReadonlyMap<string, string>,
  path: string,
  warnings: string[],
  prefixHistoricalInPlace = false
): void {
  const sourceIds = target[field]
  if (!Array.isArray(sourceIds)) return

  const importedIds: unknown[] = []
  const historicalIds: string[] = []
  for (const sourceId of sourceIds) {
    if (typeof sourceId !== 'string' || sourceId.startsWith('source:')) {
      importedIds.push(sourceId)
      continue
    }
    const importedId = map.get(sourceId)
    if (importedId) {
      importedIds.push(importedId)
    } else if (prefixHistoricalInPlace) {
      importedIds.push(`source:${sourceId}`)
      historicalIds.push(sourceId)
    } else {
      historicalIds.push(sourceId)
    }
  }
  target[field] = importedIds

  if (historicalIds.length > 0) {
    const existing = target[historicalField]
    const prior = Array.isArray(existing) ? existing : existing === undefined ? [] : [existing]
    target[historicalField] = [...new Set([...prior, ...historicalIds])]
    warnings.push(`${path}: ${historicalIds.length} цель(ей) не найдено; сохранены как исторические ссылки`)
  }
}

/** Remap only known structured Run.input references; prose and model messages stay byte-for-byte unchanged. */
export function remapRunInputReferences(
  value: unknown,
  maps: RunInputReferenceMaps
): { input: unknown; warnings: string[] } {
  if (!isRecord(value)) return { input: value, warnings: [] }

  const input: Record<string, unknown> = { ...value }
  const warnings: string[] = []

  if (isRecord(input.taskContext)) {
    const taskContext = { ...input.taskContext }
    remapSingleReference(taskContext, 'versionId', 'sourceVersionId', maps.versionIdMap, 'Run.input.taskContext.versionId', warnings)
    remapSingleReference(taskContext, 'scenarioId', 'sourceScenarioId', maps.scenarioIdMap, 'Run.input.taskContext.scenarioId', warnings)

    if (isRecord(taskContext.instructionContext)) {
      const instructionContext = { ...taskContext.instructionContext }
      remapSingleReference(instructionContext, 'versionId', 'sourceVersionId', maps.versionIdMap, 'Run.input.taskContext.instructionContext.versionId', warnings)
      remapReferenceArray(instructionContext, 'fragmentIds', 'sourceFragmentIds', maps.fragmentIdMap, 'Run.input.taskContext.instructionContext.fragmentIds', warnings, true)
      taskContext.instructionContext = instructionContext
    }
    input.taskContext = taskContext
  }

  if (isRecord(input.skillVerification)) {
    const skillVerification = { ...input.skillVerification }
    remapSingleReference(skillVerification, 'versionId', 'sourceVersionId', maps.versionIdMap, 'Run.input.skillVerification.versionId', warnings)
    input.skillVerification = skillVerification
  }

  if (isRecord(input.responseMetadata)) {
    const responseMetadata = { ...input.responseMetadata }
    remapReferenceArray(responseMetadata, 'contextFragmentIds', 'sourceContextFragmentIds', maps.fragmentIdMap, 'Run.input.responseMetadata.contextFragmentIds', warnings)
    input.responseMetadata = responseMetadata
  }

  if (Array.isArray(input.processControlHistory)) {
    input.processControlHistory = input.processControlHistory.map((entry, index) => {
      if (!isRecord(entry)) return entry
      const event = { ...entry }
      remapSingleReference(event, 'relatedRunId', 'sourceRelatedRunId', maps.runIdMap, `Run.input.processControlHistory[${index}].relatedRunId`, warnings)
      return event
    })
  }

  return { input, warnings }
}
