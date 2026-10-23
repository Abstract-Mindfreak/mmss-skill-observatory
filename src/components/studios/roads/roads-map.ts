// Failure Roads: analytical reconstruction of the task-execution road.
// Stages, forks and the section→stage map (used both for rendering and for
// overlaying real runs). Everything here is a documented editorial assumption —
// the map is labeled LOCAL honestly in the UI.

import type { FragmentDTO, ScenarioDTO } from '@/lib/types'

export interface StageDef {
  id: number
  title: string
  /** what the skill requires at this stage (RU, 1-2 sentences) */
  requirement: string
  /** exit conditions (RU) */
  exit: string
  /** sections referenced in the header (resolved to section fragments) */
  refs: { path: string; label: string }[]
}

export interface ForkBranch {
  kind: 'ok' | 'fail'
  label: string
  detail?: string
  /** pit id for 'fail' branches */
  pitId?: string
}

export interface ForkDef {
  id: string
  /** the fork sits between this stage and the next one */
  afterStage: number
  condition: string
  basis: string
  branches: ForkBranch[]
}

export const STAGES: StageDef[] = [
  {
    id: 1,
    title: 'Понять запрос',
    requirement:
      'Разобрать задачу до исполнения: доступность инструкции, операция, тип артефакта, основание, режим и контракт задачи (§4). Молчаливое усиление требований запрещено.',
    exit: 'Операция и тип артефакта определены; контракт задачи зафиксирован (§4.6); пробелы по материалам записаны.',
    refs: [
      { path: '4', label: '§4 Resolve the Task' },
    ],
  },
  {
    id: 2,
    title: 'Выбрать основание',
    requirement:
      'Определить основание (sources / requirements / existing_stack / mixed) и уровень доступа к каждому источнику. Недоступность не маскируется (§6.1-6.2).',
    exit: 'Основание определено; для каждого обязательного источника известен уровень доступа; замена только с разрешения.',
    refs: [
      { path: '4.4', label: '§4.4 Foundation' },
      { path: '6', label: '§6 Sources and Provenance' },
    ],
  },
  {
    id: 3,
    title: 'Определить масштаб',
    requirement:
      'Выбрать минимально достаточный путь; бюджеты — настраиваемые лимиты, а не квоты (§6.3). Обязательный корпус не урезается молча.',
    exit: 'Путь выбран и обоснован; бюджеты зафиксированы в контракте задачи.',
    refs: [
      { path: '5', label: '§5 Minimum Sufficient Path' },
      { path: '6.3', label: '§6.3 Autonomous Selection' },
    ],
  },
  {
    id: 4,
    title: 'Построить результат',
    requirement:
      'Синтез: механизмы, абстракция, инварианты, формулы, архитектура и контракты модулей (§7-§10). Выход следует применимому контракту (§16), ограничения не теряются при переносе.',
    exit: 'Артефакт построен; ограничения из prose выражены в контракте или явно задокументированы (§16.1).',
    refs: [
      { path: '7', label: '§7 Principles and Abstraction' },
      { path: '10', label: '§10 Architecture and Contracts' },
      { path: '16', label: '§16 Output Contract' },
    ],
  },
  {
    id: 5,
    title: 'Проверить',
    requirement:
      'Структурные, архитектурные, семантические и поведенческие проверки по мере применимости (§15). Плановая проверка остаётся плановой; пустой список проверок ≠ «все прошли».',
    exit: 'Проверки выполнены и записаны со статусами (§15.2); проверяется только заявленный объём.',
    refs: [
      { path: '15', label: '§15 Validation and Demonstrations' },
    ],
  },
  {
    id: 6,
    title: 'Исправить',
    requirement:
      'Ремонт в пределах бюджета: по умолчанию не более двух проходов после начального кандидата (§11.3). Чинятся только выявленные дефекты, не «заодно».',
    exit: 'Дефекты отслежены (проблема → изменение → перепроверка); бюджет не израсходован зря (§11.2-11.3).',
    refs: [
      { path: '11', label: '§11 Orchestration and Repair' },
    ],
  },
  {
    id: 7,
    title: 'Завершить',
    requirement:
      'Итог: completed / partial / blocked / failed — по запрошенной операции (§15.4). Обзор границ ключевых утверждений перед сдачей (§18); unknown ≠ absent.',
    exit: 'Статус честный; ограничения и неизвестности видимы; наименьший достаточный артефакт возвращён.',
    refs: [
      { path: '15.4', label: '§15.4 Task Outcome' },
      { path: '18', label: '§18 Completion Standard' },
    ],
  },
]

export const FORKS: ForkDef[] = [
  {
    id: 'fork-source-unavailable',
    afterStage: 2,
    condition: 'источник недоступен',
    basis:
      '§6.2: «Return partial or blocked when the required foundation remains unavailable»; замена обязательного источника — только с разрешения. Три законных продолжения и один отказ.',
    branches: [
      {
        kind: 'ok',
        label: 'Ограничить результат доступным материалом',
        detail: '«Use accessible excerpts only within their actual scope» (§6.2) — вернуть partial/blocked с диагнозом.',
      },
      {
        kind: 'ok',
        label: 'Запросить недостающий материал',
        detail: 'Уточнение, когда двусмысленность существенно влияет на смысл обязательного источника (§4).',
      },
      {
        kind: 'ok',
        label: 'Использовать разрешённую замену',
        detail: '«Replacing an explicitly required source requires permission unless substitution was already authorized» (§6.2).',
      },
      {
        kind: 'fail',
        label: 'Придумать содержание по названию → яма',
        pitId: 'invent-content',
      },
    ],
  },
  {
    id: 'fork-defects-found',
    afterStage: 5,
    condition: 'проверка нашла дефекты',
    basis:
      '§11.3: ремонт в бюджете; «On budget exhaustion, return a usable partial artifact only if one exists. Otherwise return diagnostics with exact defects.» Отказ — выдать плановое за выполненное.',
    branches: [
      {
        kind: 'ok',
        label: 'Исправить в рамках бюджета ремонта',
        detail: '«Repair only identified defects» (§11.3) — затем перепроверка; стадия 6.',
      },
      {
        kind: 'ok',
        label: 'Вернуть частичный результат с точными дефектами',
        detail: 'partial/blocked с диагностикой, если бюджета нет (§11.3, §15.4).',
      },
      {
        kind: 'fail',
        label: 'Выдать запланированную проверку за выполненную → яма',
        pitId: 'planned-as-executed',
      },
    ],
  },
]

/** Section → stage (used to attach real runs to stages). Ordered lookup:
 *  exact section path first; unmapped sections stay honestly unmapped. */
export const STAGE_SECTION_MAP: { stage: number; sections: string[] }[] = [
  { stage: 1, sections: ['4.1', '4.2', '4.3', '4.5', '4.6'] },
  { stage: 2, sections: ['4.4', '6.1', '6.2'] },
  { stage: 3, sections: ['5', '6.3'] },
  {
    stage: 4,
    sections: [
      '3.1', '3.2', '3.3', '6.5', '7.1', '7.2', '7.3', '8.1', '8.2',
      '9.1', '9.2', '9.3', '10.1', '10.2', '10.3', '10.4', '11.1',
      '16.1', '16.2', '16.3', '16.4', '16.5',
    ],
  },
  { stage: 5, sections: ['15.1', '15.2', '15.3'] },
  { stage: 6, sections: ['11.2', '11.3'] },
  { stage: 7, sections: ['15.4', '15.5', '18'] },
]

/** Sections of the document that this road does not map to any stage
 *  (honest: observations there are shown without a stage binding). */
export const UNMAPPED_SECTIONS: string[] = ['1', '2', '12', '13', '14', '17']

// ---------- section resolution (client-side, mirrors analysis.sectionPathOf) ----------

/** Is `a` a path-prefix of `b` segment-wise? ('6.2' is a prefix of '6.2.1.3'). */
export function isPathPrefix(a: string, b: string): boolean {
  const sa = a.split('.')
  const sb = b.split('.')
  if (sa.length > sb.length) return false
  return sa.every((seg, i) => seg === sb[i])
}

/** Deepest section fragment containing the fragment (by path prefix). */
export function sectionFragmentOf(
  fragment: FragmentDTO | undefined | null,
  sections: FragmentDTO[]
): FragmentDTO | null {
  if (!fragment) return null
  let best: FragmentDTO | null = null
  for (const s of sections) {
    if (isPathPrefix(s.path, fragment.path)) {
      if (!best || s.path.length > best.path.length) best = s
    }
  }
  return best
}

export function stageOfSection(sectionPath: string): number | null {
  for (const m of STAGE_SECTION_MAP) {
    if (m.sections.includes(sectionPath)) return m.stage
  }
  return null
}

// ---------- observed overlays from real runs ----------

export interface Observation {
  stage: number | null
  sectionPath: string
  scenarioId: string
  scenarioTitle: string
  runId: string
  runRole: string
  runStatus: string
  runVerdict: string | null
  runBackend: string
}

/** Attach real runs (origin='real', with a scenario) to stages via their
 *  scenario's fragment section. A run does not observe the model's internal path. */
export function collectObservations(
  runs: { id: string; scenarioId: string | null; role: string; status: string; verdict: string | null; backend: string; origin: string }[],
  scenarios: ScenarioDTO[],
  fragments: FragmentDTO[]
): { byStage: Map<number, Observation[]>; unmapped: Observation[] } {
  const sections = fragments.filter((f) => f.kind === 'section')
  const scenarioById = new Map(scenarios.map((s) => [s.id, s]))
  const fragmentById = new Map(fragments.map((f) => [f.id, f]))
  const byStage = new Map<number, Observation[]>()
  const unmapped: Observation[] = []
  for (const run of runs) {
    if (run.origin !== 'real' || !run.scenarioId) continue
    const scenario = scenarioById.get(run.scenarioId)
    if (!scenario?.fragmentId) continue
    const section = sectionFragmentOf(fragmentById.get(scenario.fragmentId), sections)
    if (!section) continue
    const stage = stageOfSection(section.path)
    const obs: Observation = {
      stage,
      sectionPath: section.path,
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      runId: run.id,
      runRole: run.role,
      runStatus: run.status,
      runVerdict: run.verdict,
      runBackend: run.backend,
    }
    if (stage === null) {
      unmapped.push(obs)
    } else {
      const list = byStage.get(stage)
      if (list) list.push(obs)
      else byStage.set(stage, [obs])
    }
  }
  return { byStage, unmapped }
}
