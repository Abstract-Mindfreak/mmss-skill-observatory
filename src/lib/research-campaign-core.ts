export type CampaignConclusion =
  | 'no-issue-in-checked-cases'
  | 'likely-revision'
  | 'insufficient-data'
  | 'blocked'
  | 'in-progress'
  | 'not-explored'

export type CampaignDepth = 'interpretation' | 'interactions' | 'scenarios' | 'full'

export interface CampaignPolicyInput {
  depth: CampaignDepth
  maxScenariosPerPosition: number
  maxModelActions: number | null
  maxAdditionalChecksPerPosition: number
  maxRetriesPerAction: number
  maxConcurrent: number
  stopOnQuota: boolean
  stopOnTechnicalError: boolean
  allowRewriteExperiment: boolean
}

export function validateCampaignPolicy(policy: CampaignPolicyInput): string[] {
  const errors: string[] = []
  if (!['interpretation', 'interactions', 'scenarios', 'full'].includes(policy.depth)) errors.push('Выберите глубину проверки.')
  if (!Number.isInteger(policy.maxScenariosPerPosition) || policy.maxScenariosPerPosition < 1 || policy.maxScenariosPerPosition > 2) errors.push('Допускается от 1 до 2 сценариев на положение.')
  if (policy.maxModelActions !== null && (!Number.isSafeInteger(policy.maxModelActions) || policy.maxModelActions < 1)) errors.push('Ограниченный предел текстовых действий должен быть положительным безопасным целым числом.')
  if (!Number.isInteger(policy.maxAdditionalChecksPerPosition) || policy.maxAdditionalChecksPerPosition < 0 || policy.maxAdditionalChecksPerPosition > 1) errors.push('Допускается не более одной дополнительной проверки на положение.')
  if (!Number.isInteger(policy.maxRetriesPerAction) || policy.maxRetriesPerAction < 1 || policy.maxRetriesPerAction > 3) errors.push('Допускается от 1 до 3 попыток на действие.')
  if (policy.maxConcurrent !== 1) errors.push('Для кампании разрешена конкурентность 1.')
  if (policy.allowRewriteExperiment) errors.push('Экспериментальная правка в этой кампании запрещена.')
  return errors
}

export function isQuotaOrRateLimitError(message: string): boolean {
  return /quota|daily limit|rate.?limit|too many requests|\b429\b|исчерпан.{0,20}квот|дневн.{0,20}квот|лимит запросов/i.test(message)
}

export function isTemporaryProviderError(message: string): boolean {
  return /\btimeout\b|\btimed out\b|\bETIMEDOUT\b|\bEAI_AGAIN\b|\bECONNRESET\b|\bsocket hang ?up\b|\bconnection reset\b|\btemporar(?:y|ily) unavailable\b|\bupstream timeout\b|\bHTTP(?: error)? 5\d\d\b|\b5\d\d\b|временн.{0,30}(?:сбой|недоступ)|тайм.?аут|истекл.{0,30}ожидани|ожидани.{0,30}истекл/i.test(message)
}

export type CampaignFailureAction = 'pause-for-quota' | 'retry' | 'inconclusive'

export function campaignFailureAction(message: string, attempt: number, maxAttempts: number, runStatus?: string | null): CampaignFailureAction {
  if (runStatus === 'cancelled') return 'inconclusive'
  if (isQuotaOrRateLimitError(message)) return 'pause-for-quota'
  if (isTemporaryProviderError(message) && attempt < maxAttempts) return 'retry'
  return 'inconclusive'
}

export type CampaignRunRecovery = 'create-new' | 'execute-existing' | 'wait-existing' | 'use-existing-result' | 'inspect-failure'

export function campaignRunRecovery(status: string | null | undefined): CampaignRunRecovery {
  if (status === 'queued') return 'execute-existing'
  if (status === 'running') return 'wait-existing'
  if (status === 'completed') return 'use-existing-result'
  if (status === 'failed' || status === 'cancelled') return 'inspect-failure'
  return 'create-new'
}

export function isSourceQuoteVerified(sourceText: string, quote: string): boolean {
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLocaleLowerCase()
  const normalizedQuote = normalize(quote)
  return normalizedQuote.length >= 12 && normalize(sourceText).includes(normalizedQuote)
}

export interface CampaignEvidenceState {
  status: 'prepared' | 'running' | 'paused' | 'completed' | 'cancelled' | 'blocked'
  depth: CampaignDepth
  stageStatuses: {
    interpretation: 'supported' | 'concern' | 'inconclusive' | 'pending' | 'skipped'
    interaction: 'compatible' | 'concern' | 'inconclusive' | 'pending' | 'skipped'
    scenarios: 'completed' | 'empty' | 'pending' | 'skipped'
    evaluations: ('pass' | 'fail' | 'inconclusive' | 'pending')[]
  }
  verifiedSourceEvidence: boolean
  challengerConfirmsConcern: boolean
  blockedByQuota: boolean
  exhaustedBudget: boolean
  hasUnmappedSourceContent: boolean
  hasConflictingObservation: boolean
}

export function deriveCampaignConclusion(input: CampaignEvidenceState): { conclusion: CampaignConclusion; summary: string } {
  if (input.status === 'prepared') return { conclusion: 'not-explored', summary: 'Кампания подготовлена; проверки ещё не запускались.' }
  if (input.status === 'running') return { conclusion: 'in-progress', summary: 'Проверки выполняются в пределах сохранённой политики.' }
  if (input.status === 'cancelled') return { conclusion: 'insufficient-data', summary: 'Кампания отменена; итоговые проверки не завершены.' }
  if (input.status === 'blocked' || input.blockedByQuota) return { conclusion: 'blocked', summary: 'Необходимое действие заблокировано провайдером или техническим ограничением.' }

  const testedBehavior = input.depth === 'full'
    && input.stageStatuses.interpretation === 'supported'
    && input.stageStatuses.interaction === 'compatible'
    && input.stageStatuses.scenarios === 'completed'
    && input.stageStatuses.evaluations.length > 0
    && input.stageStatuses.evaluations.every((verdict) => verdict === 'pass')
    && !input.hasUnmappedSourceContent
    && !input.hasConflictingObservation
  if (testedBehavior) return { conclusion: 'no-issue-in-checked-cases', summary: 'Проблем не обнаружено в выполненных проверках; вывод ограничен указанными сценариями и источниками.' }

  const concern = input.stageStatuses.interpretation === 'concern'
    || input.stageStatuses.interaction === 'concern'
    || input.stageStatuses.evaluations.includes('fail')
  if (concern && input.verifiedSourceEvidence && input.challengerConfirmsConcern) {
    return { conclusion: 'likely-revision', summary: 'Есть подтверждённое исходным текстом замечание, которое выдержало ограниченную проверку альтернативного объяснения; нужна ручная проверка.' }
  }

  const reason = input.exhaustedBudget
    ? 'Предел модельных действий исчерпан до достаточного заключения.'
    : concern
      ? 'Обнаружено модельное замечание, но оснований недостаточно для вывода о вероятной необходимости правки.'
      : 'Выполненных этапов недостаточно для заключения по выбранной политике.'
  return { conclusion: 'insufficient-data', summary: reason }
}

export function campaignVersionState(snapshotHash: string, currentHash: string): 'current' | 'stale' {
  return snapshotHash === currentHash ? 'current' : 'stale'
}

export function importedCampaignState(status: string, hasUnresolvedAction: boolean): 'ready' | 'blocked-reconciliation' {
  return status === 'running' || hasUnresolvedAction ? 'blocked-reconciliation' : 'ready'
}
