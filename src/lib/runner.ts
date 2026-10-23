// ============================================================
// MMSS Skill Observatory — run engine.
// Owned by agent 1-b.
//
// Responsibilities:
//  - create run rows (queued) with resolved prompts per role
//  - execute them (Ollama / FreeLLMAPI / session-cloud / demo-origin only)
//  - parse evaluator verdicts (loose first-JSON extraction)
//  - LOCAL program checks after executor runs (JSON syntax,
//    NaN/Infinity literals, duplicate keys)
//  - explicit cancellation and guarded result persistence
//
// Honesty rules:
//  - never fabricate model responses; errors are first-class
//  - backend 'demo' only allowed for origin='demo' rows
//  - after ANY completed run linked to a scenario, the scenario is
//    promoted unexplored → explored; 'run-verified' is NEVER set
//    automatically (it is a user/UI decision after evaluation)
// ============================================================

import { db } from '@/lib/db'
import { skillContextVerification } from '@/lib/skill-context-verification'
import type { DocumentVersion, Fragment, Run } from '@prisma/client'
import type { RoleId, RunInputDTO } from '@/lib/types'
import { safeParse } from '@/lib/serialize'
import { buildRolePrompt, type RolePromptContext } from '@/lib/role-prompts'
import { chat as ollamaChat, normalizeBaseUrl, OllamaError } from '@/lib/ollama'
import { chatFreeLLM, FreeLLMApiError } from '@/lib/freellmapi'
import { SessionCloudError } from '@/lib/session-cloud'
import { registerRun, unregisterRun } from '@/lib/run-registry'
import { inspectJsonOutputScopes } from '@/lib/json-output-checks'
import { findNonFiniteJsonLiteral, inspectDuplicateKeys } from '@/lib/program-checks-core'
export { findDuplicateJsonKeys } from '@/lib/program-checks-core'
import { callSelectedTextBackend } from '@/lib/backend-routing'
import { resolveInstructionContext, type InstructionContextSelection } from '@/lib/instruction-context'
import { buildRoleMessages, withAssistantHistory, type ModelMessage } from '@/lib/role-messages'
import { startModelCallRecord, finishModelCallRecord } from '@/lib/model-call-record'
import { registerModelOperation, unregisterModelOperation } from '@/lib/model-operation-registry'

// ---------------- errors ----------------

/** Validation error thrown before/at run creation; carries an HTTP status. */
export class RunValidationError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'RunValidationError'
    this.status = status
  }
}

// ---------------- stored input shape ----------------

export interface ProgramCheck {
  name: string
  passed: boolean
  detail: string
  status?: 'passed' | 'failed' | 'unverified'
  scope?: 'raw-response' | 'normalized-response' | 'syntax-scan'
  version?: string
  provenance?: 'local-program'
}

export interface StoredRunInput extends RunInputDTO {
  programChecks: ProgramCheck[]
  processControlHistory?: { at: string; action: string; relatedRunId?: string; basis?: string; result?: string }[]
  /** Only for origin='demo' rows: the synthetic output to return. */
  demoOutput?: string
}

export type RunBackend = 'ollama' | 'freellmapi' | 'session-cloud' | 'demo'

export interface CreateRunOptions {
  projectId: string
  role: RoleId
  backend: RunBackend
  connectionId?: string | null
  model?: string | null
  scenarioId?: string | null
  versionId?: string | null
  fragmentId?: string | null
  parentRunId?: string | null
  campaignActionId?: string | null
  retryOfRunId?: string | null
  prompt?: string
  messages?: { role: 'user' | 'assistant'; content: string }[]
  sentMessages?: ModelMessage[]
  contextProvenance?: RunInputDTO['contextProvenance']
  action?: string
  preserveMissingVersion?: boolean
  settings?: {
    temperature?: number
    numPredict?: number
    timeoutMs?: number
    programChecks?: boolean
  }
  taskContext?: {
    scenarioId?: string
    fragmentId?: string
    versionId?: string
    criterion?: string
    outputToEvaluate?: string
    findingId?: string
    skillContextMode?: 'full' | 'relevant'
    instructionContext?: InstructionContextSelection
  }
  origin?: 'real' | 'demo'
  demoOutput?: string
}

// ---------------- JSON helpers ----------------

/** Strip surrounding markdown code fences if the whole text is fenced. */
export function stripMarkdownFences(text: string): string {
  const t = text.trim()
  const m = t.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?\s*```$/)
  return m ? m[1].trim() : t
}

function findBalancedEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Loose JSON extraction: find the first balanced {...} block in a text
 * (prose/markdown tolerated) that parses as a JSON object.
 */
export function extractFirstJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    const end = findBalancedEnd(text, start)
    if (end === -1) continue
    const candidate = text.slice(start, end + 1)
    try {
      const parsed: unknown = JSON.parse(candidate)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // try the next '{'
    }
  }
  return null
}

/**
 * Local scanner for duplicate keys inside JSON object literals.
 * Walks brace depth, reads string literals, tracks keys per object level.
 */
// ---------------- local program checks ----------------

/**
 * LOCAL program checks on an executor output (settings.programChecks=true).
 * These are honest local computations, clearly labelled in `detail`.
 */
export function runProgramChecks(output: string): ProgramCheck[] {
  const checks: ProgramCheck[] = []
  const checkVersion = 'executor-json-v2'
  const jsonScopes = inspectJsonOutputScopes(output)

  // A. Exact transport output: wrappers are a contract failure.
  checks.push({
    name: 'Raw JSON без внешней оболочки',
    passed: jsonScopes.rawValid,
    status: jsonScopes.rawValid ? 'passed' : 'failed',
    scope: 'raw-response',
    version: checkVersion,
    provenance: 'local-program',
    detail: jsonScopes.rawValid
      ? 'Локальная проверка: весь исходный ответ является JSON без Markdown-оболочки.'
      : `Локальная проверка исходного ответа: raw JSON не подтверждён — ${jsonScopes.rawError}`,
  })

  // B. Preserve the established syntax check on explicitly normalized fences.
  const stripped = jsonScopes.normalizedText
  const jsonOk = jsonScopes.normalizedValid
  checks.push({
    name: 'JSON синтаксис после снятия fences',
    passed: jsonOk,
    status: jsonOk ? 'passed' : 'failed',
    scope: 'normalized-response',
    version: checkVersion,
    provenance: 'local-program',
    detail: jsonOk
      ? 'Локальная проверка: после явного снятия Markdown fences содержимое является синтаксически корректным JSON.'
      : `Локальная проверка: после снятия Markdown fences содержимое не является корректным JSON — ${jsonScopes.normalizedError}`,
  })

  // 2. NaN / Infinity literals (raw output)
  const badLiteral = findNonFiniteJsonLiteral(output)
  checks.push({
    name: 'NaN/Infinity литералы',
    passed: !badLiteral,
    status: badLiteral ? 'failed' : 'passed',
    scope: 'syntax-scan',
    version: checkVersion,
    provenance: 'local-program',
    detail: badLiteral
      ? `Локальная проверка: найден недопустимый для JSON литерал «${badLiteral}»`
      : 'Локальная проверка: литералы NaN/Infinity не найдены',
  })

  // 3. Duplicate keys (local scanner over object literals)
  const duplicateCheck = inspectDuplicateKeys(stripped, jsonOk)
  checks.push({
    name: 'дубликаты ключей',
    passed: duplicateCheck.passed,
    status: duplicateCheck.status,
    scope: 'normalized-response',
    version: checkVersion,
    provenance: 'local-program',
    detail: duplicateCheck.detail,
  })

  return checks
}

// ---------------- evaluator verdict parsing ----------------

interface VerdictFields {
  verdict: string | null
  verdictBy: string | null
  modelVerdict: string | null
  modelVerdictBy: string | null
}

const NO_VERDICT: VerdictFields = {
  verdict: null,
  verdictBy: null,
  modelVerdict: null,
  modelVerdictBy: null,
}

/**
 * Parse the evaluator verdict from the model output.
 *  - JSON with a valid verdict field → verdict = modelVerdict, verdictBy='model'
 *  - JSON without a valid verdict field → verdict='inconclusive', verdictBy='model'
 *  - no parseable JSON → all null (frontend shows «вердикт не распознан»)
 */
export function parseEvaluatorVerdict(content: string): VerdictFields {
  const parsed = extractFirstJsonObject(content)
  if (!parsed) return NO_VERDICT
  const v = parsed.verdict
  if (v === 'pass' || v === 'fail' || v === 'inconclusive') {
    return { verdict: v, verdictBy: 'model', modelVerdict: v, modelVerdictBy: 'model' }
  }
  return { verdict: 'inconclusive', verdictBy: 'model', modelVerdict: null, modelVerdictBy: null }
}

// ---------------- skill context ----------------

const SKILL_CONTEXT_LIMIT = 24000

/** Active version of a project: isActive first, else the latest imported. */
export async function resolveActiveVersion(
  projectId: string
): Promise<DocumentVersion | null> {
  const active = await db.documentVersion.findFirst({
    where: { projectId, isActive: true },
    orderBy: { importDate: 'desc' },
  })
  if (active) return active
  return db.documentVersion.findFirst({
    where: { projectId },
    orderBy: { importDate: 'desc' },
  })
}

/** Table of contents built from `^##? ` headings (markdown # / ##). */
function buildToc(content: string): string {
  return content
    .split('\n')
    .filter((line) => /^#{1,2}\s+\S/.test(line))
    .map((line) => line.trim())
    .join('\n')
}

/** The enclosing section fragment (kind='section') for a fragment path, or null. */
export async function findSectionFragment(fragment: Fragment): Promise<Fragment | null> {
  const sections = await db.fragment.findMany({
    where: { versionId: fragment.versionId, kind: 'section' },
    orderBy: { path: 'asc' },
  })
  let best: Fragment | null = null
  for (const s of sections) {
    if (fragment.path === s.path || fragment.path.startsWith(`${s.path}.`)) {
      if (!best || s.path.length > best.path.length) best = s
    }
  }
  return best
}

/**
 * Skill text for prompts. Full content when it fits the budget;
 * otherwise TOC + the section of the linked fragment (truncation is
 * stated inside the text — never silently replaced).
 */
export async function buildSkillContext(
  version: DocumentVersion,
  fragmentId?: string | null
): Promise<{ text: string; mode: 'full' | 'section' | 'toc' }> {
  if (version.content.length <= SKILL_CONTEXT_LIMIT) {
    return { text: version.content, mode: 'full' }
  }
  const toc = buildToc(version.content)
  let sectionText: string | null = null
  if (fragmentId) {
    const frag = await db.fragment.findUnique({ where: { id: fragmentId } })
    if (frag && frag.versionId === version.id) {
      const section = await findSectionFragment(frag)
      sectionText = section ? section.text : frag.text
    }
  }
  const header = sectionText
    ? 'NOTE: The full skill text exceeds the context budget (24000 chars). Below are the table of contents and the relevant section only.'
    : 'NOTE: The full skill text exceeds the context budget (24000 chars). Below is the table of contents only.'
  const text = [
    header,
    '',
    '=== TABLE OF CONTENTS ===',
    toc,
    ...(sectionText ? ['', '=== RELEVANT SECTION ===', sectionText] : []),
  ].join('\n')
  return { text, mode: sectionText ? 'section' : 'toc' }
}

// ---------------- run creation ----------------

async function validateBackendForCreation(opts: CreateRunOptions): Promise<string | null> {
  if (opts.backend === 'demo') {
    if (opts.origin !== 'demo') {
      throw new RunValidationError('Демо-бэкенд доступен только через загрузку DEMO-данных')
    }
    return null
  }
  if (opts.backend === 'ollama' || opts.backend === 'freellmapi') {
    if (!opts.connectionId || !opts.model) {
      throw new RunValidationError(`Для ${opts.backend === 'freellmapi' ? 'FreeLLMAPI' : 'Ollama'} укажите подключение и модель`)
    }
    const conn = await db.connection.findUnique({ where: { id: opts.connectionId } })
    if (!conn) throw new RunValidationError('Указанное подключение не найдено', 400)
    if (opts.backend === 'freellmapi' && conn.kind !== 'freellmapi') throw new RunValidationError('Для FreeLLMAPI выберите подключение FreeLLMAPI', 400)
    if (opts.backend === 'ollama' && conn.kind === 'freellmapi') throw new RunValidationError('Для этого подключения выберите провайдер FreeLLMAPI', 400)
    return conn.name
  }
  return null
}

/** Validate options and create a queued run row (does NOT execute it). */
export async function createRun(opts: CreateRunOptions): Promise<Run> {
  if (opts.backend === 'session-cloud') {
    throw new RunValidationError('session-cloud недоступен для локального запуска. Выберите Ollama или FreeLLMAPI в назначении роли либо для нового действия.', 400)
  }
  if (opts.backend === 'demo' && opts.origin !== 'demo') {
    throw new RunValidationError('Демо-бэкенд доступен только через загрузку DEMO-данных')
  }
  const connectionName = await validateBackendForCreation(opts)

  const scenario = opts.scenarioId
    ? await db.scenario.findUnique({ where: { id: opts.scenarioId } })
    : null
  if (opts.scenarioId && (!scenario || scenario.projectId !== opts.projectId)) {
    throw new RunValidationError('Указанный сценарий не найден', 400)
  }

  let version: DocumentVersion | null = null
  if (opts.versionId) {
    version = await db.documentVersion.findUnique({ where: { id: opts.versionId } })
    if (!version || version.projectId !== opts.projectId) {
      if (opts.sentMessages && opts.preserveMissingVersion) version = null
      else throw new RunValidationError('Указанная версия недоступна в текущем проекте', 400)
    }
  } else {
    version = opts.preserveMissingVersion ? null : await resolveActiveVersion(opts.projectId)
  }

  const fragment = opts.fragmentId
    ? await db.fragment.findUnique({ where: { id: opts.fragmentId } })
    : null
  if (opts.fragmentId && !opts.sentMessages && (!fragment || fragment.versionId !== version?.id)) {
    throw new RunValidationError('Указанный фрагмент не принадлежит выбранной версии', 400)
  }
  if (fragment) {
    const fragmentVersion = await db.documentVersion.findUnique({ where: { id: fragment.versionId }, select: { projectId: true } })
    if (fragmentVersion?.projectId !== opts.projectId) throw new RunValidationError('Обязательный фрагмент не принадлежит текущему проекту')
  }

  const taskContext: NonNullable<RunInputDTO['taskContext']> = { ...opts.taskContext }
  if (opts.scenarioId) taskContext.scenarioId = opts.scenarioId
  if (opts.fragmentId) taskContext.fragmentId = opts.fragmentId
  if (version?.id) taskContext.versionId = version.id
  if (scenario && !taskContext.scenarioId) taskContext.scenarioId = scenario.id
  if (fragment && !taskContext.fragmentId) taskContext.fragmentId = fragment.id
  if (version && !taskContext.versionId) taskContext.versionId = version.id

  let prompt = opts.prompt?.trim() || undefined
  let parentRunId = opts.parentRunId ?? null

  // ---- role-specific prompt / context resolution ----
  if (opts.role === 'executor') {
    if (!prompt) prompt = scenario?.description?.trim() || undefined
    if (!prompt) {
      throw new RunValidationError(
        'Для роли executor укажите задачу (prompt) или сценарий с описанием'
      )
    }
    if (!version) {
      throw new RunValidationError(
        'У проекта нет версий документа — исполнителю нечего исполнять'
      )
    }
  } else if (opts.role === 'evaluator') {
    let outputToEvaluate = taskContext.outputToEvaluate
    if (!outputToEvaluate && scenario) {
      const latestExecutor = await db.run.findFirst({
        where: {
          scenarioId: scenario.id,
          role: 'executor',
          status: 'completed',
          origin: 'real',
        },
        orderBy: { createdAt: 'desc' },
      })
      if (latestExecutor?.output) {
        outputToEvaluate = latestExecutor.output
        if (!parentRunId) parentRunId = latestExecutor.id
      }
    }
    let criterion = taskContext.criterion
    if (!criterion && scenario) {
      criterion = scenario.description
        ? `${scenario.title}\n${scenario.description}`
        : scenario.title
    }
    if (!outputToEvaluate) {
      throw new RunValidationError(
        'Для evaluator укажите outputToEvaluate или привяжите сценарий с завершённым executor-запуском'
      )
    }
    if (!criterion) {
      throw new RunValidationError('Для evaluator укажите критерий (criterion) или сценарий')
    }
    taskContext.outputToEvaluate = outputToEvaluate
    taskContext.criterion = criterion
    if (!prompt) prompt = 'Оценка результата по полному критерию и полному выводу; подробности сохранены отдельно.'
  } else if (opts.role === 'challenger') {
    if (!prompt && taskContext.findingId) {
      const finding = await db.finding.findUnique({ where: { id: taskContext.findingId } })
      if (finding) {
        prompt = `Опровергните или поддержите следующую находку.\n\nЗаголовок: ${finding.title}\n\nОписание:\n${finding.description}`
      }
    }
    if (!prompt) {
      throw new RunValidationError('Для роли challenger укажите задачу (prompt) или findingId')
    }
  } else if (opts.role === 'assistant') {
    if (!opts.messages?.length && !prompt) {
      throw new RunValidationError('Для роли assistant укажите messages или prompt')
    }
  } else {
    // explorer / editor / interpreter
    if (!prompt) {
      throw new RunValidationError(`Для роли ${opts.role} укажите задачу (prompt)`)
    }
  }

  const settings = {
    temperature: opts.settings?.temperature,
    numPredict: opts.settings?.numPredict,
    timeoutMs: opts.settings?.timeoutMs ?? 120000,
    programChecks: opts.settings?.programChecks ?? true,
  }

  const legacyContextMode = taskContext.skillContextMode ?? 'full'
  if (taskContext.skillContextMode && taskContext.skillContextMode !== 'full' && taskContext.skillContextMode !== 'relevant') {
    throw new RunValidationError('Неизвестный режим контекста скилла', 400)
  }
  const instructionContext: InstructionContextSelection = taskContext.instructionContext ?? {
    mode: opts.role === 'executor' ? (legacyContextMode === 'full' || !taskContext.fragmentId ? 'full' : 'selected') : 'none',
    versionId: version?.id ?? null,
    fragmentIds: opts.role === 'executor' && legacyContextMode === 'relevant' && taskContext.fragmentId ? [taskContext.fragmentId] : [],
    includeParentSections: false,
  }
  taskContext.instructionContext = instructionContext
  try {
    if (!opts.sentMessages) await resolveInstructionContext({ projectId: opts.projectId, selection: instructionContext, fallbackVersionId: version?.id })
  } catch (error) {
    throw new RunValidationError(error instanceof Error ? error.message : String(error), 400)
  }
  const input: StoredRunInput = {
    prompt: prompt ?? '',
    action: opts.action ?? 'behavior-lab-run',
    ...(opts.messages?.length ? { messages: opts.messages } : {}),
    ...(opts.sentMessages?.length ? { sentMessages: opts.sentMessages } : {}),
    ...(opts.contextProvenance ? { contextProvenance: opts.contextProvenance } : {}),
    settings,
    ...(Object.keys(taskContext).length ? { taskContext } : {}),
    programChecks: [],
    ...(opts.retryOfRunId ? { processControlHistory: [{ at: new Date().toISOString(), action: 'retry-created', relatedRunId: opts.retryOfRunId }] } : {}),
    ...(opts.demoOutput !== undefined ? { demoOutput: opts.demoOutput } : {}),
  }

  return db.run.create({
    data: {
      projectId: opts.projectId,
      scenarioId: opts.scenarioId ?? null,
      versionId: version?.id ?? null,
      parentRunId,
      role: opts.role,
      backend: opts.backend,
      connectionId: opts.connectionId ?? null,
      connectionName,
      model: opts.model ?? null,
      status: 'queued',
      input: JSON.stringify(input),
      origin: opts.origin ?? 'real',
      campaignActionId: opts.campaignActionId ?? null,
    },
  })
}

// ---------------- run execution ----------------

async function failRun(runId: string, message: string): Promise<Run | null> {
  await db.run.updateMany({
    where: { id: runId, status: { in: ['queued', 'running'] } },
    data: { status: 'failed', error: message, finishedAt: new Date() },
  })
  return db.run.findUnique({ where: { id: runId } })
}

/**
 * Execute a queued run: queued → running → completed | cancelled | failed.
 * Registers an AbortController so the run can be cancelled.
 */
export async function executeRun(runId: string): Promise<Run | null> {
  const run = await db.run.findUnique({ where: { id: runId } })
  if (!run) return null
  const input = safeParse<StoredRunInput | null>(run.input, null)
  if (!input) {
    return failRun(runId, 'Внутренняя ошибка: повреждённый input запуска')
  }
  const settings = input.settings ?? { timeoutMs: 120000, programChecks: true }
  const timeoutMs =
    typeof settings.timeoutMs === 'number' && settings.timeoutMs > 0
      ? settings.timeoutMs
      : 120000

  const claimed = await db.run.updateMany({
    where: { id: runId, status: { in: ['queued', 'planned'] } },
    data: { status: 'running', startedAt: new Date(), error: null },
  })
  if (!claimed.count) return db.run.findUnique({ where: { id: runId } })

  const controller = new AbortController()
  registerRun(runId, controller)
  let modelCallId: string | null = null

  try {
    // ---- build the prompt ----
    const taskContext = input.taskContext ?? {}
    const scenario = run.scenarioId
      ? await db.scenario.findUnique({ where: { id: run.scenarioId } })
      : null
    const version = run.versionId
      ? await db.documentVersion.findUnique({ where: { id: run.versionId } })
      : null
    // Explorer's scenario and its linked source fragment are task material.
    // Keep the run builder aligned with the role preview's scenario resolver.
    const fragmentId = taskContext.fragmentId ?? (run.role === 'explorer' ? scenario?.fragmentId ?? null : null)
    const fragment = fragmentId
      ? await db.fragment.findFirst({ where: { id: fragmentId, version: { projectId: run.projectId } } })
      : null

    const selection = input.taskContext?.instructionContext
    const instruction = !input.sentMessages
      ? await resolveInstructionContext({ projectId: run.projectId, selection: selection ?? { mode: 'none', versionId: run.versionId, fragmentIds: [], includeParentSections: false }, fallbackVersionId: run.versionId })
      : null
    const legacySkill = !selection && !input.sentMessages && input.skillText !== undefined
      ? { text: input.skillText, mode: input.skillContextMode === 'full' ? 'full' as const : 'section' as const }
      : null
    let sectionText: string | undefined
    if (fragment) {
      const section = await findSectionFragment(fragment)
      sectionText = section ? section.text : undefined
    }

    const finding =
      taskContext.findingId && run.role === 'challenger'
        ? await db.finding.findUnique({ where: { id: taskContext.findingId } })
        : null

    const ctx: RolePromptContext = {
      skillText: legacySkill?.text ?? (run.role === 'executor' && instruction?.mode === 'none' ? '' : undefined),
      sectionText: selection ? undefined : sectionText,
      task: run.role === 'evaluator' ? (scenario ? `Оценка результата сценария «${scenario.title}»` : 'Оценка сохранённого результата') : input.prompt,
      fragmentText: fragment
        ? `[[обязательный материал id=${fragment.id} path=${fragment.path} version=${fragment.versionId}]]\n${fragment.text}`
        : undefined,
      criterion: taskContext.criterion,
      outputToEvaluate: taskContext.outputToEvaluate,
      finding: finding ? { title: finding.title, description: finding.description } : undefined,
      scenario: scenario
        ? { title: scenario.title, description: scenario.description }
        : undefined,
      history: input.messages,
    }
    const generatedMessages = instruction
      ? withAssistantHistory(buildRoleMessages(run.role as RoleId, {
          ...ctx,
          ...(run.role === 'interpreter' ? { fragmentText: fragment ? `[[обязательный материал id=${fragment.id} path=${fragment.path} version=${fragment.versionId}]]\n${fragment.text}` : undefined } : {}),
          ...(run.role === 'challenger' && finding ? { finding: { title: finding.title, description: finding.description } } : {}),
        }, instruction), run.role === 'assistant' ? input.messages ?? [] : [])
      : (() => {
          const legacy = buildRolePrompt(run.role as RoleId, ctx)
          const base: ModelMessage[] = [{ role: 'system', content: legacy.system }, { role: 'user', content: legacy.user }]
          return withAssistantHistory(base, run.role === 'assistant' ? input.messages ?? [] : [])
        })()
    const messages: ModelMessage[] = input.sentMessages ?? generatedMessages
    if (!input.sentMessages) input.sentMessages = messages
    if (instruction) {
      const { text: _contextText, ...provenance } = instruction
      input.contextProvenance = provenance
    }
    if (run.role === 'executor' && instruction?.mode !== 'none' && instruction) {
      input.skillText = instruction.text
      input.skillContextMode = instruction.mode === 'full' ? 'full' : 'relevant'
      input.skillVerification = skillContextVerification(version, input.skillText, input.skillContextMode, messages)
      input.programChecks = [
        ...(input.programChecks ?? []).filter((check) => check.name !== 'Проверка контекста скилла'),
        {
          name: 'Проверка контекста скилла',
          passed: input.skillVerification.status === 'matches',
          status: input.skillVerification.status === 'matches' ? 'passed' : input.skillVerification.status === 'mismatch' ? 'failed' : 'unverified',
          detail: input.skillVerification.detail,
        },
      ]
    }
    const contextRecord = instruction ?? (input.contextProvenance ? { ...input.contextProvenance, text: '' } : null) ?? {
      mode: 'unknown' as const, versionId: null, versionLabel: null, fullVersionSha256: null,
      fullVersionChars: null, selectedFragmentIds: [], includedFragmentIds: [],
      sentContextSha256: null, sentContextChars: 0, text: '',
    }
    const campaignAction = run.campaignActionId ? await db.researchCampaignAction.findUnique({
      where: { id: run.campaignActionId },
      include: { campaign: { select: { id: true } }, campaignPosition: { select: { id: true, positionId: true } }, check: { include: { sources: { select: { fragmentId: true } } } }, sources: { select: { fragmentId: true } } },
    }) : null
    const campaignRelatedEntities = [
      ...(campaignAction ? [`research-campaign:${campaignAction.campaignId}`, `research-campaign-position:${campaignAction.campaignPositionId}`, `semantic-position:${campaignAction.campaignPosition.positionId}`, `research-campaign-action:${campaignAction.id}`] : []),
      ...(campaignAction?.checkId ? [`research-campaign-check:${campaignAction.checkId}`] : []),
      ...(campaignAction?.check?.sources.map((source) => `fragment:${source.fragmentId}`) ?? []),
      ...(campaignAction?.sources.map((source) => `fragment:${source.fragmentId}`) ?? []),
      ...(scenario ? [`scenario:${scenario.id}`] : []),
    ]
    const callRecord = await startModelCallRecord({
      projectId: run.projectId, runId: run.id, role: run.role as RoleId,
      action: input.action ?? 'unknown', versionId: contextRecord.versionId,
      context: contextRecord, messages, backend: run.backend,
      connectionId: run.connectionId, connectionName: run.connectionName, requestedModel: run.model,
    })
    modelCallId = callRecord.id
    input.modelCallId = callRecord.id
    await db.run.update({ where: { id: run.id }, data: { input: JSON.stringify(input) } })

    // ---- call the backend ----
    let result: { content: string; tokensIn: number | null; tokensOut: number | null; durationMs: number; actualProvider?: string | null; actualModel?: string | null; finishReason?: string | null; outputTruncated?: boolean | null }

    if (run.backend === 'demo') {
      // Only demo-origin rows reach this branch (routes reject backend='demo').
      const demoOutput =
        typeof input.demoOutput === 'string' ? input.demoOutput : 'DEMO: пустой синтетический вывод'
      result = {
        content: demoOutput,
        tokensIn: null,
        tokensOut: null,
        durationMs: 400 + Math.floor(Math.random() * 501),
      }
    } else if (run.backend === 'session-cloud') {
      throw new RunValidationError('Этот запуск сохранён с недоступным session-cloud. Создайте новый запуск, выбрав текущее назначение роли или подключение Ollama/FreeLLMAPI.')
    } else {
      const conn = run.connectionId
        ? await db.connection.findUnique({ where: { id: run.connectionId } })
        : null
      if (!conn) {
        throw new OllamaError('Подключение Ollama не найдено (возможно, было удалено)', 'unknown')
      }
      if (!run.model) {
        throw new OllamaError('Не указана модель Ollama для запуска', 'unknown')
      }
      const runModel = run.model
      if ((run.backend === 'freellmapi') !== (conn.kind === 'freellmapi')) {
        throw new OllamaError('Провайдер запуска не совпадает с выбранным подключением', 'unknown')
      }
      const r = await callSelectedTextBackend(run.backend as 'ollama' | 'freellmapi', {
        freellmapi: () => chatFreeLLM(conn.baseUrl, {
            model: runModel,
            messages,
            temperature: settings.temperature,
            numPredict: settings.numPredict,
            timeoutMs,
            signal: controller.signal,
          }),
        ollama: () => ollamaChat(normalizeBaseUrl(conn.baseUrl), {
            model: runModel,
            messages,
            temperature: settings.temperature,
            numPredict: settings.numPredict,
            timeoutMs,
            signal: controller.signal,
          }),
      })
      await finishModelCallRecord(callRecord.id, {
        actualProvider: conn.kind === 'freellmapi' ? ('actualProvider' in r && typeof r.actualProvider === 'string' ? r.actualProvider : null) : 'Ollama',
        actualModel: r.actualModel,
        responseMetadata: {
          finishReason: 'finishReason' in r && typeof r.finishReason === 'string' ? r.finishReason : null,
          outputTruncated: 'outputTruncated' in r && typeof r.outputTruncated === 'boolean' ? r.outputTruncated : null,
        },
        relatedEntities: [`run:${run.id}`, ...campaignRelatedEntities],
      })
      result = {
        content: r.content,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        durationMs: r.durationMs,
        actualProvider: conn.kind === 'freellmapi'
          ? ('actualProvider' in r && typeof r.actualProvider === 'string' ? r.actualProvider : null)
          : 'Ollama',
        actualModel: r.actualModel,
        finishReason: 'finishReason' in r && typeof r.finishReason === 'string' ? r.finishReason : null,
        outputTruncated: 'outputTruncated' in r && typeof r.outputTruncated === 'boolean' ? r.outputTruncated : null,
      }
    }

    // A cancel may have landed while the request was in flight — never overwrite it.
    const fresh = await db.run.findUnique({ where: { id: runId }, select: { status: true } })
    if (fresh?.status === 'cancelled') {
      return db.run.findUnique({ where: { id: runId } })
    }

    // ---- evaluator verdict ----
    const verdictData: VerdictFields =
      run.role === 'evaluator' ? parseEvaluatorVerdict(result.content) : NO_VERDICT

    // ---- local program checks after executor runs ----
    let programChecks = input.programChecks ?? []
    if (run.role === 'executor' && (settings.programChecks ?? true)) {
      programChecks = [...runProgramChecks(result.content), ...programChecks.filter((check) => check.name === 'Проверка контекста скилла')]
    }

    const newInput: StoredRunInput = {
      ...input,
      programChecks,
      responseMetadata: {
        actualProvider: result.actualProvider ?? null,
        actualModel: result.actualModel ?? null,
        finishReason: result.finishReason ?? null,
        outputTruncated: result.outputTruncated ?? null,
        modelCallId,
        contextMode: contextRecord.mode,
        contextVersionId: contextRecord.versionId,
        contextFragmentIds: contextRecord.includedFragmentIds,
        contextSha256: contextRecord.sentContextSha256,
        contextChars: contextRecord.sentContextChars,
      },
    }

    const saved = await db.run.updateMany({
      where: { id: runId, status: 'running' },
      data: {
        status: 'completed',
        output: result.content,
        error: null,
        durationMs: result.durationMs,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        input: JSON.stringify(newInput),
        finishedAt: new Date(),
        verdict: verdictData.verdict,
        verdictBy: verdictData.verdictBy,
        modelVerdict: verdictData.modelVerdict,
        modelVerdictBy: verdictData.modelVerdictBy,
      },
    })
    if (!saved.count) return db.run.findUnique({ where: { id: runId } })
    const updated = await db.run.findUniqueOrThrow({ where: { id: runId } })

    // Honest scenario promotion: unexplored → explored after a completed run.
    // 'run-verified' is NEVER set automatically (requires evaluation judgement).
    if (run.scenarioId) {
      await db.scenario.updateMany({
        where: { id: run.scenarioId, status: 'unexplored' },
        data: { status: 'explored' },
      })
    }

    return updated
  } catch (err) {
    if (modelCallId) await finishModelCallRecord(modelCallId, { status: 'failed', relatedEntities: [`run:${runId}`] }).catch(() => undefined)
    const aborted =
      (err instanceof OllamaError && err.kind === 'aborted') ||
      (err instanceof SessionCloudError && err.kind === 'aborted')
    if (aborted) {
      // Only flip running → cancelled (the cancel route may have done it already).
      await db.run.updateMany({
        where: { id: runId, status: 'running' },
        data: { status: 'cancelled', error: null, finishedAt: new Date() },
      })
    } else {
      const message = err instanceof Error ? err.message : String(err)
      await db.run.updateMany({
        where: { id: runId, status: { in: ['running', 'queued'] } },
        data: { status: 'failed', error: message, finishedAt: new Date() },
      })
    }
    return db.run.findUnique({ where: { id: runId } })
  } finally {
    unregisterRun(runId)
  }
}

/** Create a queued run and execute it synchronously. */
export async function createAndRunRun(opts: CreateRunOptions): Promise<Run> {
  const created = await createRun(opts)
  const finished = await executeRun(created.id)
  if (!finished) {
    throw new RunValidationError('Запуск не найден после создания', 500)
  }
  return finished
}

// ---------------- one-shot model call (for suggest / analyze-model / chat) ----------------

export interface CallModelParams {
  backend: 'ollama' | 'freellmapi' | 'session-cloud'
  connectionId?: string | null
  model?: string | null
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  temperature?: number
  numPredict?: number
  timeoutMs?: number
  signal?: AbortSignal
  provenance?: {
    projectId: string
    role: RoleId
    action: string
    versionId: string | null
    context: Awaited<ReturnType<typeof resolveInstructionContext>>
    relatedEntities?: string[]
  }
}

export interface CallModelResult {
  content: string
  durationMs: number
  tokensIn: number | null
  tokensOut: number | null
  actualProvider: string | null
  actualModel: string | null
  finishReason: string | null
  outputTruncated: boolean | null
  connectionName: string | null
  modelCallId?: string
}

/**
 * A single model call outside the run pipeline.
 * Throws RunValidationError (400) for bad params; model/network failures
 * propagate as OllamaError / SessionCloudError with honest RU messages.
 */
export async function callModel(params: CallModelParams): Promise<CallModelResult> {
  if (params.backend === 'session-cloud') {
    throw new RunValidationError('session-cloud недоступен для локального запуска. Выберите Ollama или FreeLLMAPI в назначении роли либо для этого действия.', 400)
  }
  const connectionId = params.connectionId
  const model = params.model
  if (!connectionId || !model) {
    throw new RunValidationError(`Для ${params.backend === 'freellmapi' ? 'FreeLLMAPI' : 'Ollama'} укажите подключение и модель`)
  }
  const conn = await db.connection.findUnique({ where: { id: connectionId } })
  if (!conn) throw new RunValidationError('Указанное подключение не найдено', 400)
  if ((params.backend === 'freellmapi') !== (conn.kind === 'freellmapi')) {
    throw new RunValidationError('Провайдер запуска не совпадает с выбранным подключением', 400)
  }
  const callRecord = params.provenance ? await startModelCallRecord({
    ...params.provenance,
    context: params.provenance.context,
    messages: params.messages,
    backend: params.backend,
    connectionId,
    connectionName: conn.name,
    requestedModel: model,
  }) : null
  const controller = new AbortController()
  const externalSignal = params.signal
  const abortFromExternal = () => controller.abort()
  if (externalSignal?.aborted) controller.abort()
  else externalSignal?.addEventListener('abort', abortFromExternal, { once: true })
  if (callRecord) registerModelOperation(callRecord.id, controller)
  try {
  const r = await callSelectedTextBackend(params.backend, {
    freellmapi: () => chatFreeLLM(conn.baseUrl, {
        model,
        messages: params.messages,
        temperature: params.temperature,
        numPredict: params.numPredict,
        timeoutMs: params.timeoutMs ?? 120000,
        signal: controller.signal,
      }),
    ollama: () => ollamaChat(normalizeBaseUrl(conn.baseUrl), {
        model,
        messages: params.messages,
        temperature: params.temperature,
        numPredict: params.numPredict,
        timeoutMs: params.timeoutMs ?? 120000,
        signal: controller.signal,
      }),
  })
  if (controller.signal.aborted) throw new Error('Вызов модели отменён локально; результат ответа не сохранён.')
  const finishReason = 'finishReason' in r && typeof r.finishReason === 'string' ? r.finishReason : null
  const outputTruncated = 'outputTruncated' in r && typeof r.outputTruncated === 'boolean' ? r.outputTruncated : null
  if (callRecord) await finishModelCallRecord(callRecord.id, { actualProvider: conn.kind === 'freellmapi' ? ('actualProvider' in r && typeof r.actualProvider === 'string' ? r.actualProvider : null) : 'Ollama', actualModel: r.actualModel, responseMetadata: { finishReason, outputTruncated }, relatedEntities: params.provenance?.relatedEntities })
  return {
    content: r.content,
    durationMs: r.durationMs,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    actualProvider: conn.kind === 'freellmapi'
      ? ('actualProvider' in r && typeof r.actualProvider === 'string' ? r.actualProvider : null)
      : 'Ollama',
    actualModel: r.actualModel,
    finishReason,
    outputTruncated,
    connectionName: conn.name,
    modelCallId: callRecord?.id,
  }
  } catch (error) {
    if (callRecord) await finishModelCallRecord(callRecord.id, { status: controller.signal.aborted ? 'cancelled' : 'failed' })
    throw error
  } finally {
    externalSignal?.removeEventListener('abort', abortFromExternal)
    if (callRecord) unregisterModelOperation(callRecord.id)
  }
}
