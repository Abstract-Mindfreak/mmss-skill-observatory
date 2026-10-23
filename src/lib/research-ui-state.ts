import { isTemporaryProviderError } from './research-campaign-core'

export type ResearchStopCause =
  | 'policy-budget-exhausted'
  | 'provider-quota'
  | 'temporary-upstream-error'
  | 'imported-needs-reconciliation'
  | 'application-error'
  | 'user-pause'
  | 'user-cancellation'
  | 'version-changed'
  | 'unknown'
  | 'none'

export function classifyResearchStop(pauseReason: string | null | undefined, lastError: string | null | undefined): ResearchStopCause {
  const error = lastError ?? ''
  if (pauseReason === 'policy-budget-exhausted') return 'policy-budget-exhausted'
  if (pauseReason === 'import-reconciliation' || pauseReason === 'imported-needs-reconciliation') return 'imported-needs-reconciliation'
  if (pauseReason === 'user-paused') return 'user-pause'
  if (pauseReason === 'user-cancelled') return 'user-cancellation'
  if (pauseReason === 'version-changed') return 'version-changed'
  if (pauseReason === 'provider-quota') return /quota|daily limit|rate.?limit|too many requests|\b429\b|квот|лимит запросов/i.test(error) ? 'provider-quota' : 'unknown'
  if (pauseReason === 'technical-error') {
    if (isTemporaryProviderError(error)) return 'temporary-upstream-error'
    if (error) return 'application-error'
    return 'unknown'
  }
  return pauseReason ? 'unknown' : 'none'
}

export type CampaignResumeSnapshot = {
  status: string
  pauseReason?: string | null
  lastError?: string | null
  versionState: string
  modelActionsUsed: number
  maxModelActions: number | null
  maxRetriesPerAction: number
  latestFailedAttempt?: number | null
}

export function campaignResumeBlock(snapshot: CampaignResumeSnapshot): string | null {
  if (snapshot.versionState !== 'current') return 'Версия кампании изменилась; требуется новая кампания по текущей версии.'
  if (snapshot.status !== 'paused' && snapshot.status !== 'prepared') return 'Это состояние нельзя продолжить.'
  if (classifyResearchStop(snapshot.pauseReason, snapshot.lastError) === 'imported-needs-reconciliation') return 'Импортированная кампания требует сверки данных перед продолжением.'
  if (snapshot.status === 'paused' && classifyResearchStop(snapshot.pauseReason, snapshot.lastError) === 'unknown') return 'Причина остановки не распознана. Проверьте исходную ошибку и используйте новую кампанию, если безопасное продолжение нельзя подтвердить.'
  if (snapshot.latestFailedAttempt != null && snapshot.latestFailedAttempt >= snapshot.maxRetriesPerAction) return 'Лимит попыток для последнего действия исчерпан.'
  if (snapshot.maxModelActions !== null && snapshot.modelActionsUsed >= snapshot.maxModelActions) return 'Предел текстовых действий исчерпан.'
  if (snapshot.status === 'paused' && classifyResearchStop(snapshot.pauseReason, snapshot.lastError) === 'user-cancellation') return 'Отменённую кампанию продолжить нельзя.'
  return null
}

export type RequiredStage = { id: string; label: string; status: string }

export function campaignRequiredStages(depth: string, item: {
  interpretationStatus: string
  interactionStatus: string
  scenarioStatus: string
  executionStatus: string
}): RequiredStage[] {
  const stages: RequiredStage[] = [{ id: 'interpretation', label: 'Интерпретация', status: item.interpretationStatus }]
  if (['interactions', 'scenarios', 'full'].includes(depth)) stages.push({ id: 'interaction', label: 'Взаимодействия', status: item.interactionStatus })
  if (['scenarios', 'full'].includes(depth)) stages.push({ id: 'scenarios', label: 'План сценариев', status: item.scenarioStatus })
  if (depth === 'full') stages.push({ id: 'execution', label: 'Исполнение и оценки', status: item.executionStatus })
  return stages
}

export function requiredStagesCompletion(stages: RequiredStage[]): 'complete' | 'incomplete' | 'unknown' {
  if (!stages.length) return 'unknown'
  const terminal = new Set(['supported', 'concern', 'inconclusive', 'skipped', 'compatible', 'completed', 'empty', 'pass', 'fail'])
  if (stages.some((stage) => !terminal.has(stage.status))) return 'incomplete'
  return 'complete'
}
