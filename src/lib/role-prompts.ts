// ============================================================
// MMSS Skill Observatory — role prompt builders.
// Owned by agent 1-b.
// System prompts are English (document language); user tasks may be RU.
// Roles: executor / explorer / evaluator / challenger / editor /
// interpreter / assistant.
// ============================================================

import type { RoleId } from '@/lib/types'

export interface RolePromptContext {
  /** Full skill text (or truncated context) for executor. */
  skillText?: string
  /** Section of the skill relevant to the task. */
  sectionText?: string
  /** The user task / problem statement. */
  task?: string
  /** Instruction fragment under study. */
  fragmentText?: string
  /** Acceptance criterion (evaluator). */
  criterion?: string
  /** Executor output to evaluate (evaluator). */
  outputToEvaluate?: string
  /** Finding to refute (challenger). */
  finding?: { title: string; description: string }
  /** Scenario context (explorer). */
  scenario?: { title: string; description?: string | null }
  /** Requested number of mechanisms (explorer). */
  mechanismsCount?: number
  /** Conversation history (assistant). */
  history?: { role: 'user' | 'assistant'; content: string }[]
  /** Extra research focus (interpreter). */
  focus?: string
}

export interface BuiltPrompt {
  system: string
  user: string
}

export function buildRolePrompt(role: RoleId, ctx: RolePromptContext): BuiltPrompt {
  switch (role) {
    case 'executor': {
      const skill = ctx.skillText ?? ctx.sectionText ?? ''
      const system = [
        "You are an AI agent following the skill instruction below. Perform the user's task.",
        'Return ONE valid JSON object (no markdown fences, no prose) following the skill\'s default envelope (SYNTHESIZED_MMSS_SYSTEM with meta/task/artifact/assumptions/limitations/validation/state).',
        'Preserve unknowns as null; never fabricate measurements or sources.',
        '',
        '=== SKILL ===',
        skill,
      ].join('\n')
      return { system, user: ctx.task ?? '' }
    }

    case 'explorer': {
      const n = ctx.mechanismsCount ?? 3
      const system = [
        'You are an explorer of an AI skill instruction.',
        'Propose genuinely DIFFERENT failure mechanisms — different causes, not variations of one theme with different names.',
        `Return JSON: {"mechanisms":[{"title":"...","description":"..."}]} with exactly ${n} items.`,
        'Descriptions: condition of occurrence, violated property, minimal example.',
      ].join(' ')
      const parts: string[] = []
      if (ctx.scenario) {
        parts.push(
          `=== SCENARIO ===\nTitle: ${ctx.scenario.title}${
            ctx.scenario.description ? `\nDescription: ${ctx.scenario.description}` : ''
          }`
        )
      }
      if (ctx.fragmentText) parts.push(`=== SCENARIO SOURCE FRAGMENT (task material) ===\n${ctx.fragmentText}`)
      const legacyExtra = ctx.sectionText ?? ctx.skillText
      if (legacyExtra) parts.push(`=== LEGACY EXPLORER CONTEXT ===\n${legacyExtra}`)
      parts.push(
        `Propose ${n} genuinely different failure mechanisms for this scenario as child branches. Return JSON only.`
      )
      return { system, user: parts.join('\n\n') }
    }

    case 'evaluator': {
      const system = [
        "You are an evaluator. Compare the executor's output against the acceptance criterion.",
        'Be strict about fabrication, missing evidence, and epistemic confusion (do not mix observation and inference).',
        'Return JSON: {"verdict":"pass"|"fail"|"inconclusive","reasons":["..."]}.',
        'If the output cannot be evaluated (e.g., malformed), verdict is "inconclusive" with reason.',
      ].join(' ')
      const user = [
        ...(ctx.task ? [`=== USER TASK ===\n${ctx.task}`] : []),
        `=== ACCEPTANCE CRITERION ===\n${ctx.criterion ?? '(критерий не указан)'}`,
        `=== EXECUTOR OUTPUT ===\n${ctx.outputToEvaluate ?? '(вывод не передан)'}`,
        'Evaluate the executor output strictly against the criterion. Return JSON only.',
      ].join('\n\n')
      return { system, user }
    }

    case 'challenger': {
      const system = [
        'You are a challenger.',
        'Try to REFUTE the given finding/verdict: find conditions under which it does not hold, or evidence it misreads.',
        'Return JSON: {"refuted":true|false,"arguments":["..."]}.',
      ].join(' ')
      const parts: string[] = []
      if (ctx.finding) {
        parts.push(
          `=== FINDING ===\nTitle: ${ctx.finding.title}\nDescription: ${ctx.finding.description}`
        )
      }
      if (ctx.task) parts.push(ctx.task)
      parts.push('Try to refute it. Return JSON only.')
      return { system, user: parts.join('\n\n') }
    }

    case 'editor': {
      const system = [
        'You are an editor of an AI skill instruction.',
        'Propose the MINIMAL text edit that addresses the stated problem without changing anything else.',
        'Return plain text: 1) the exact original fragment, 2) the proposed replacement, 3) one-sentence rationale. No JSON.',
      ].join(' ')
      const parts: string[] = []
      if (ctx.fragmentText) parts.push(`=== FRAGMENT TO EDIT ===\n${ctx.fragmentText}`)
      if (ctx.task) parts.push(`=== PROBLEM ===\n${ctx.task}`)
      return { system, user: parts.join('\n\n') }
    }

    case 'interpreter': {
      const system = [
        'You are an interpreter of instruction text.',
        'For the given fragment, return JSON: {"interpretation":"...","alternatives":["..."],"scope":"assumed scope of application","limitations":"what this interpretation does not cover"}.',
        'Ground every claim in the fragment text; mark speculation explicitly. Do not invent numeric confidence.',
        'Write the values of "interpretation", "alternatives", "scope" and "limitations" in Russian (the interface language); keep JSON keys in English.',
      ].join(' ')
      const parts: string[] = []
      if (ctx.fragmentText) parts.push(`=== FRAGMENT ===\n${ctx.fragmentText}`)
      if (ctx.focus) parts.push(`=== FOCUS ===\n${ctx.focus}`)
      parts.push('Interpret the fragment. Return JSON only.')
      return { system, user: parts.join('\n\n') }
    }

    case 'assistant': {
      const system = [
        'Ты — исследовательский помощник в лаборатории анализа инструкций AI-агентов.',
        'Отвечай по-русски, кратко и точно.',
        'Опирайся только на данный контекст; если чего-то нет в контексте — скажи об этом прямо.',
        'Не выдумывай факты и не приписывай тексту того, чего в нём нет.',
      ].join(' ')
      const parts: string[] = []
      if (ctx.fragmentText) {
        parts.push(`=== КОНТЕКСТ ФРАГМЕНТА ИНСТРУКЦИИ ===\n${ctx.fragmentText}`)
      }
      if (ctx.task) parts.push(ctx.task)
      return { system, user: parts.join('\n\n') }
    }
  }
}
