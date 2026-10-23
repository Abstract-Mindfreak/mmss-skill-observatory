export const RESEARCH_DISCREPANCY_TYPE = 's2-research-discrepancy-v1'

export type DiscrepancyAssessment = 'different-criteria' | 'potential-contradiction' | 'insufficient-basis'
export type DiscrepancyStatus = 'proposed' | 'accepted' | 'disputed'
export type UserDiscrepancyDecision = { decision: 'confirmed' | 'rejected'; note: string } | null
export type DiscrepancyDecisionHistoryEntry = { previousStatus: DiscrepancyStatus; newStatus: DiscrepancyStatus; basis: string; decidedAt: string; actorType: 'user' }

export interface DiscrepancyEvidence {
  kind: 'scenario-criterion' | 'run-output' | 'local-check' | 'observation' | 'fragment'
  id: string
  label: string
  excerpt?: string
  path?: string
  sourceId?: string
}

export interface ResearchDiscrepancy {
  schema: 1
  type: typeof RESEARCH_DISCREPANCY_TYPE
  assessment: DiscrepancyAssessment
  status: DiscrepancyStatus
  criterion: string
  summary: string
  runIds: string[]
  observationIds: string[]
  positionIds: string[]
  fragmentIds: string[]
  evidence: DiscrepancyEvidence[]
  limitations: string[]
  userDecision: UserDiscrepancyDecision
  decisionHistory?: DiscrepancyDecisionHistoryEntry[]
}

export function parseResearchDiscrepancy(body: string): ResearchDiscrepancy | null {
  try {
    const value = JSON.parse(body) as Partial<ResearchDiscrepancy>
    if (value?.type !== RESEARCH_DISCREPANCY_TYPE || value.schema !== 1) return null
    if (!['different-criteria', 'potential-contradiction', 'insufficient-basis'].includes(String(value.assessment))) return null
    if (!['proposed', 'accepted', 'disputed'].includes(String(value.status))) return null
    return value as ResearchDiscrepancy
  } catch { return null }
}

export function makeResearchDiscrepancy(input: Omit<ResearchDiscrepancy, 'schema' | 'type' | 'status' | 'userDecision'>): ResearchDiscrepancy {
  return { schema: 1, type: RESEARCH_DISCREPANCY_TYPE, status: 'proposed', userDecision: null, ...input }
}

export function remapResearchDiscrepancyIds(
  payload: ResearchDiscrepancy,
  maps: { run: Map<string, string>; observation: Map<string, string>; position: Map<string, string>; fragment: Map<string, string>; scenario: Map<string, string> }
): ResearchDiscrepancy & Record<string, unknown> {
  const output = structuredClone(payload) as ResearchDiscrepancy & Record<string, unknown>
  const mapList = (field: 'runIds' | 'observationIds' | 'positionIds' | 'fragmentIds', sourceField: string, map: Map<string, string>) => {
    const sourceIds = payload[field]
    const live: string[] = [], historical: string[] = []
    for (const id of sourceIds) {
      const mapped = map.get(id)
      if (mapped) live.push(mapped)
      else historical.push(id)
    }
    output[field] = live as never
    if (historical.length) output[sourceField] = historical
  }
  mapList('runIds', 'sourceRunIds', maps.run)
  mapList('observationIds', 'sourceObservationIds', maps.observation)
  mapList('positionIds', 'sourcePositionIds', maps.position)
  mapList('fragmentIds', 'sourceFragmentIds', maps.fragment)
  output.evidence = payload.evidence.map((entry) => {
    const map = entry.kind === 'run-output' || entry.kind === 'local-check' ? maps.run
      : entry.kind === 'observation' ? maps.observation
      : entry.kind === 'fragment' ? maps.fragment
      : entry.kind === 'scenario-criterion' ? maps.scenario
      : null
    if (!map) return entry
    const mapped = map.get(entry.id)
    return mapped ? { ...entry, id: mapped } : { ...entry, sourceId: entry.id }
  }) as never
  return output
}
