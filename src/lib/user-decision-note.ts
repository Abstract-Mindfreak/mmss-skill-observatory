import { db } from '@/lib/db'
import { makeUserDecisionHistoryEntry } from '@/lib/user-decision-history'

export async function recordUserDecision(input: {
  projectId: string
  versionId: string
  objectType: 'semantic-position' | 'semantic-relation' | 'research-discrepancy'
  objectId: string
  previousStatus: string
  newStatus: string
  basis: string
}) {
  const event = {
    schema: 1,
    type: 's2-user-decision-history',
    ...makeUserDecisionHistoryEntry(input.previousStatus, input.newStatus, input.basis),
    objectType: input.objectType,
    objectId: input.objectId,
  }
  return db.note.create({ data: {
    projectId: input.projectId,
    versionId: input.versionId,
    kind: 'user-verdict',
    author: 'user',
    body: JSON.stringify(event),
  } })
}
