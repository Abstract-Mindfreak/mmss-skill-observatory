// ============================================================
// Scenario Studio — pure helpers: origin labels + markdown
// builders for «Копировать карточку» and «Экспортировать ветвь».
// No React here. Owned by agent 3-c.
// ============================================================

import type { FragmentDTO, RunDTO, RunStatus, ScenarioDTO, ScenarioStatus, Verdict } from '@/lib/types'
import { ROLE_TITLES, SCENARIO_STATUS_TITLES } from '@/lib/types'

// ---------- research params (Параметры исследования) ----------

export interface ResearchParams {
  /** Область исследования (текст). */
  scope: string
  /** Целевая глубина дерева. */
  depth: number
  /** Максимум новых ветвей за один шаг Explorer (1..5). */
  maxNewBranches: number
  /** Бюджет запусков (0 = без ограничения). */
  runBudget: number
  /** Условие остановки исследования (текст). */
  stopCondition: string
}

export const DEFAULT_RESEARCH_PARAMS: ResearchParams = {
  scope: '',
  depth: 2,
  maxNewBranches: 3,
  runBudget: 20,
  stopCondition: '',
}

export const PARAMS_STORAGE_KEY = 'mmss-scenario-params-v1'

export function clampInt(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, Math.round(v)))
}

// ---------- labels ----------

const ORIGIN_SHORT: Record<ScenarioDTO['origin'], string> = {
  seed: 'стартовый',
  model: 'модель',
  user: 'вами',
  demo: 'DEMO',
}

const ORIGIN_LONG: Record<ScenarioDTO['origin'], string> = {
  seed: 'стартовый (из сида)',
  model: 'предложено моделью',
  user: 'добавлено пользователем',
  demo: 'DEMO (синтетические данные)',
}

export function originShort(origin: ScenarioDTO['origin']): string {
  return ORIGIN_SHORT[origin]
}

export function originLong(origin: ScenarioDTO['origin']): string {
  return ORIGIN_LONG[origin]
}

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  planned: 'Запланирован',
  queued: 'В очереди',
  running: 'Выполняется',
  completed: 'Завершён',
  cancelled: 'Отменён',
  failed: 'Ошибка',
}

const VERDICT_LABELS: Record<Verdict, string> = {
  pass: 'пройдено',
  fail: 'не пройдено',
  inconclusive: 'неоднозначно',
}

export function verdictText(run: Pick<RunDTO, 'verdict' | 'verdictBy'>): string {
  if (!run.verdict) return '—'
  const by = run.verdictBy === 'user' ? ' (пользователь)' : run.verdictBy === 'program' ? ' (программа)' : ' (модель)'
  return VERDICT_LABELS[run.verdict] + by
}

export function fmtDuration(ms: number | null): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)} мс`
  return `${(ms / 1000).toFixed(1)} с`
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ru-RU')
  } catch {
    return iso
  }
}

/** Escape a value for a markdown table cell. */
function cell(v: string): string {
  return v.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function fragmentRefText(fragmentId: string | null, fragments: FragmentDTO[]): string | null {
  if (!fragmentId) return null
  const f = fragments.find((x) => x.id === fragmentId)
  if (!f) return `${fragmentId} (фрагмент не в списке активной версии)`
  const title = f.title ? ` «${f.title}»` : ''
  return `${f.path}${title}`
}

// ---------- scenario block ----------

function scenarioHeaderLines(s: ScenarioDTO, fragments: FragmentDTO[]): string[] {
  const lines: string[] = []
  lines.push(`- Статус: ${SCENARIO_STATUS_TITLES[s.status]}`)
  if (s.status === 'stopped' && s.stopReason) lines.push(`- Причина остановки: ${s.stopReason}`)
  lines.push(`- Происхождение: ${originLong(s.origin)}`)
  lines.push(`- Закреплена: ${s.pinned ? 'да' : 'нет'}`)
  const frag = fragmentRefText(s.fragmentId, fragments)
  if (frag) lines.push(`- Фрагмент инструкции: ${frag}`)
  const last = s.lastRunStatus ? RUN_STATUS_LABELS[s.lastRunStatus] : '—'
  lines.push(`- Запусков: ${s.runCount} · последний: ${last}`)
  if (s.description) lines.push(`- Описание: ${s.description}`)
  return lines
}

function runsTable(runs: RunDTO[]): string {
  if (!runs.length) return '_Запусков нет._'
  const header = '| # | Роль | Бэкенд | Модель | Статус | Вердикт | Длительность | Время |'
  const sep = '|---|---|---|---|---|---|---|---|'
  const rows = runs.map((r, i) => {
    const backend =
      r.backend === 'session-cloud'
        ? 'session-cloud'
        : r.backend === 'demo'
          ? 'DEMO'
          : `${r.backend} · подключение «${r.connectionName ?? '—'}» · запрошенная модель ${r.model ?? 'не указана'}`
    return [
      `| ${i + 1}`,
      cell(ROLE_TITLES[r.role]),
      cell(backend),
      cell(r.model ?? '—'),
      cell(RUN_STATUS_LABELS[r.status]),
      cell(verdictText(r)),
      cell(fmtDuration(r.durationMs)),
      `${cell(fmtDate(r.createdAt))} |`,
    ].join(' | ')
  })
  return [header, sep, ...rows].join('\n')
}

/**
 * Markdown of a scenario card: the scenario itself, direct children
 * (with their own counts) and its runs. Used by «Копировать карточку».
 */
export function scenarioCardMarkdown(
  scenario: ScenarioDTO,
  children: ScenarioDTO[],
  runs: RunDTO[],
  fragments: FragmentDTO[]
): string {
  const out: string[] = []
  out.push(`## ${scenario.title}`)
  out.push(...scenarioHeaderLines(scenario, fragments))
  out.push('')
  out.push(children.length ? `### Дочерние ветви (${children.length})` : '### Дочерние ветви')
  if (!children.length) {
    out.push('_Дочерних ветвей нет._')
  } else {
    for (const c of children) {
      out.push(
        `- «${c.title}» — ${SCENARIO_STATUS_TITLES[c.status]} · ${originLong(c.origin)} · запусков: ${c.runCount}`
      )
      if (c.description) out.push(`  - Описание: ${c.description}`)
    }
  }
  out.push('')
  out.push(`### Запуски сценария (${runs.length}${runs.length >= 200 ? ', список ограничен 200' : ''})`)
  out.push(runsTable(runs))
  return out.join('\n')
}

/**
 * Markdown of the whole subtree with research params and the run-budget
 * line. Used by «Экспортировать ветвь». `depth` renders indentation.
 */
export function subtreeMarkdown(
  root: ScenarioDTO,
  all: ScenarioDTO[],
  runsByScenario: (scenarioId: string) => RunDTO[],
  fragments: FragmentDTO[],
  params: ResearchParams,
  budget: { performed: number; budget: number }
): string {
  const childrenOf = (id: string) =>
    all
      .filter((s) => s.parentId === id)
      .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))

  const out: string[] = []
  out.push(`# Экспорт ветви: «${root.title}»`)
  out.push(`_Сформировано: ${fmtDate(new Date().toISOString())}_`)
  out.push('')

  out.push('## Параметры исследования')
  out.push(`- Область: ${params.scope || 'не указана'}`)
  out.push(`- Целевая глубина: ${params.depth}`)
  out.push(`- Максимум новых ветвей за шаг: ${params.maxNewBranches}`)
  out.push(
    params.runBudget > 0
      ? `- Бюджет запусков: ${params.runBudget} · выполнено: ${budget.performed} (${budget.performed >= params.runBudget ? 'исчерпан' : 'в рамках'})`
      : `- Бюджет запусков: без ограничения · выполнено: ${budget.performed}`
  )
  out.push(`- Условие остановки: ${params.stopCondition || 'не указано'}`)
  out.push('- Предупреждение о бюджете информационное — работа не блокируется.')
  out.push('')
  out.push('_Запуски в списке: последние 200 по проекту (реальные и DEMO разделяются)._')
  out.push('')

  const renderNode = (s: ScenarioDTO, depth: number) => {
    const pad = '#'.repeat(Math.min(6, 2 + depth))
    out.push(`${pad} ${'· '.repeat(depth)}${s.title}`)
    out.push(...scenarioHeaderLines(s, fragments))
    const runs = runsByScenario(s.id)
    if (runs.length) {
      out.push('')
      out.push(`${pad}# Запуски (${runs.length})`)
      out.push(runsTable(runs))
    }
    out.push('')
    for (const c of childrenOf(s.id)) renderNode(c, depth + 1)
  }

  renderNode(root, 0)
  return out.join('\n')
}

// Re-export the status type so callers can type filters without extra imports.
export type { ScenarioStatus }
