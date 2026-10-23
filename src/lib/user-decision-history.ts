export type UserDecisionHistoryEntry = {
  previousStatus: string
  newStatus: string
  basis: string
  decidedAt: string
  actorType: 'user'
}

export function makeUserDecisionHistoryEntry(previousStatus: string, newStatus: string, basis: string, decidedAt = new Date().toISOString()): UserDecisionHistoryEntry {
  return { previousStatus, newStatus, basis: basis.trim(), decidedAt, actorType: 'user' }
}

export function appendUserDecisionHistory<T extends object>(
  current: T,
  previousStatus: string,
  newStatus: string,
  basis: string,
  decidedAt?: string,
) {
  const currentRecord = current as Record<string, unknown>
  const history = Array.isArray(currentRecord.decisionHistory) ? currentRecord.decisionHistory : []
  return { ...current, status: newStatus, decisionHistory: [...history, makeUserDecisionHistoryEntry(previousStatus, newStatus, basis, decidedAt)] }
}
