// ============================================================
// MMSS Skill Observatory — DEMO data (origin='demo').
// Owned by agent 1-b.
//
// DEMO data demonstrates the interface ONLY: every row is marked
// origin='demo' and titled with a [DEMO] prefix. It never mixes into
// real metrics (excluded by origin filter) and is fully purgeable.
// The demo 'backend' never fabricates real runs: real run requests
// with backend='demo' are rejected by the API.
// ============================================================

import { db } from '@/lib/db'
import type { Fragment } from '@prisma/client'
import { createAndRunRun, resolveActiveVersion, type CreateRunOptions } from '@/lib/runner'

export interface DemoCounts {
  scenarios: number
  runs: number
  findings: number
  notes: number
}

const DEMO_ENVELOPE =
  '{"SYNTHESIZED_MMSS_SYSTEM":{"meta":{"demo":true},"task":{},"artifact":{},"assumptions":[],"limitations":["DEMO: синтетический вывод для демонстрации интерфейса"],"validation":{},"state":{}}}'

const DEMO_EVALUATOR_OUTPUT =
  '{"verdict":"inconclusive","reasons":["DEMO: синтетический ответ — реальная проверка не выполнялась"]}'

async function countDemo(projectId: string): Promise<DemoCounts> {
  const [scenarios, runs, findings, notes] = await Promise.all([
    db.scenario.count({ where: { projectId, origin: 'demo' } }),
    db.run.count({ where: { projectId, origin: 'demo' } }),
    db.finding.count({ where: { projectId, origin: 'demo' } }),
    db.note.count({ where: { projectId, origin: 'demo' } }),
  ])
  return { scenarios, runs, findings, notes }
}

async function demoFragment(projectId: string): Promise<Fragment | null> {
  const version = await resolveActiveVersion(projectId)
  if (!version) return null
  return db.fragment.findFirst({
    where: { versionId: version.id },
    orderBy: { order: 'asc' },
  })
}

/**
 * Seed the DEMO catalog for a project (idempotent: if a demo scenario
 * already exists, returns existing counts with existed=true).
 */
export async function seedDemoData(
  projectId: string
): Promise<{ counts: DemoCounts; existed: boolean }> {
  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project) {
    throw new Error('Проект не найден')
  }

  const existing = await db.scenario.findFirst({ where: { projectId, origin: 'demo' } })
  if (existing) {
    return { counts: await countDemo(projectId), existed: true }
  }

  const version = await resolveActiveVersion(projectId)
  const fragment = await demoFragment(projectId)

  // ---- 1 demo scenario root + 2 children ----
  const root = await db.scenario.create({
    data: {
      projectId,
      title: '[DEMO] Демонстрация интерфейса',
      description:
        'DEMO: синтетический сценарий для демонстрации интерфейса. Не является реальным результатом исследования.',
      status: 'synthetic',
      origin: 'demo',
      pinned: false,
      order: 1000,
    },
  })
  const child1 = await db.scenario.create({
    data: {
      projectId,
      parentId: root.id,
      title: '[DEMO] Дочерняя ветвь 1 — синтетический пример',
      description:
        'DEMO: синтетическая дочерняя ветвь с завершённым executor-запуском и проверкой evaluator.',
      status: 'unexplored',
      origin: 'demo',
      order: 1001,
    },
  })
  const child2 = await db.scenario.create({
    data: {
      projectId,
      parentId: root.id,
      title: '[DEMO] Дочерняя ветвь 2 — синтетический пример',
      description: 'DEMO: синтетическая дочерняя ветвь с примером ошибки выполнения.',
      status: 'unexplored',
      origin: 'demo',
      order: 1002,
    },
  })

  // ---- 3 demo runs ----
  const executorOpts: CreateRunOptions = {
    projectId,
    role: 'executor',
    backend: 'demo',
    scenarioId: child1.id,
    origin: 'demo',
    prompt: 'DEMO: синтетическая задача для демонстрации интерфейса',
    settings: { timeoutMs: 120000, programChecks: true },
    demoOutput: DEMO_ENVELOPE,
  }
  const executorRun = await createAndRunRun(executorOpts)

  const evaluatorRun = await createAndRunRun({
    projectId,
    role: 'evaluator',
    backend: 'demo',
    scenarioId: child1.id,
    origin: 'demo',
    prompt: 'DEMO: синтетическая проверка вывода executor',
    settings: { timeoutMs: 120000, programChecks: true },
    taskContext: {
      scenarioId: child1.id,
      criterion: 'DEMO: синтетический критерий — вывод должен быть корректным JSON-конвертом',
      outputToEvaluate: DEMO_ENVELOPE,
    },
    parentRunId: executorRun.id,
    demoOutput: DEMO_EVALUATOR_OUTPUT,
  })

  // The failed demo run is created directly: executeRun's demo path only
  // produces completed runs, and an honest simulated failure must not be
  // laundered through the normal pipeline.
  await db.run.create({
    data: {
      projectId,
      scenarioId: child2.id,
      versionId: version?.id ?? null,
      role: 'executor',
      backend: 'demo',
      status: 'failed',
      input: JSON.stringify({
        prompt: 'DEMO: синтетическая задача с имитацией ошибки выполнения',
        settings: { timeoutMs: 120000, programChecks: true },
        taskContext: { scenarioId: child2.id },
        programChecks: [],
      }),
      error: 'DEMO: модель недоступна — имитация ошибки выполнения',
      origin: 'demo',
      startedAt: new Date(),
      finishedAt: new Date(),
      durationMs: 640,
    },
  })

  // ---- 2 demo findings ----
  const fragmentStep = {
    kind: 'fragment' as const,
    refId: fragment?.id ?? null,
    label: 'Фрагмент инструкции',
    detail: fragment
      ? fragment.text.slice(0, 200)
      : 'Фрагмент не привязан: в проекте нет версий документа с фрагментами',
    status: (fragment ? 'present' : 'missing') as 'present' | 'missing',
  }

  await db.finding.create({
    data: {
      projectId,
      versionId: version?.id ?? null,
      fragmentId: fragment?.id ?? null,
      scenarioId: child1.id,
      runId: executorRun.id,
      title: '[DEMO] Пример находки с полной цепочкой доказательств',
      description:
        'DEMO: синтетическая находка с полностью заполненной цепочкой доказательств — демонстрирует, как выглядит обоснованный вывод в интерфейсе. Не является реальным результатом исследования.',
      severity: 'warning',
      status: 'supported',
      provenance: 'local-heuristic',
      origin: 'demo',
      evidence: JSON.stringify({
        steps: [
          fragmentStep,
          {
            kind: 'criterion',
            refId: null,
            label: 'Критерий',
            detail: 'DEMO: синтетический критерий проверки',
            status: 'present',
          },
          {
            kind: 'scenario',
            refId: child1.id,
            label: 'Сценарий',
            detail: child1.title,
            status: 'present',
          },
          {
            kind: 'run-input',
            refId: executorRun.id,
            label: 'Вход запуска',
            detail: 'DEMO: синтетическая задача для демонстрации интерфейса',
            status: 'present',
          },
          {
            kind: 'executor-output',
            refId: executorRun.id,
            label: 'Вывод исполнителя',
            detail: 'Синтетический JSON-конверт SYNTHESIZED_MMSS_SYSTEM (origin=demo)',
            status: 'present',
          },
          {
            kind: 'evaluator-conclusion',
            refId: evaluatorRun.id,
            label: 'Заключение проверяющего',
            detail: 'inconclusive — DEMO: синтетический ответ, реальная проверка не выполнялась',
            status: 'present',
          },
        ],
        gaps: ['нет возражений — цепочка не оспаривалась'],
        distinction: 'executed-check',
      }),
    },
  })

  await db.finding.create({
    data: {
      projectId,
      versionId: version?.id ?? null,
      fragmentId: fragment?.id ?? null,
      scenarioId: child2.id,
      runId: null,
      title: '[DEMO] Пример гипотезы без проверки',
      description:
        'DEMO: синтетическая гипотеза без проверок — демонстрирует отличие непроверенной гипотезы от находки с цепочкой доказательств.',
      severity: 'info',
      status: 'hypothesis',
      provenance: 'local-heuristic',
      origin: 'demo',
      evidence: JSON.stringify({
        steps: [
          fragmentStep,
          {
            kind: 'assumption',
            refId: null,
            label: 'Допущение',
            detail: 'DEMO: предположение, сформулированное без опоры на выполненные проверки',
            status: 'partial',
          },
        ],
        gaps: [
          'нет executor-запуска по этой гипотезе',
          'нет заключения evaluator',
          'не выполнялась проверка challenger (оспаривание)',
        ],
        distinction: 'unverified-hypothesis',
      }),
    },
  })

  return { counts: await countDemo(projectId), existed: false }
}

/** Delete ALL demo-origin rows of a project. Returns deletion counts. */
export async function purgeDemoData(projectId: string): Promise<DemoCounts> {
  const findings = await db.finding.deleteMany({ where: { projectId, origin: 'demo' } })
  const runs = await db.run.deleteMany({ where: { projectId, origin: 'demo' } })
  const scenarios = await db.scenario.deleteMany({ where: { projectId, origin: 'demo' } })
  const notes = await db.note.deleteMany({ where: { projectId, origin: 'demo' } })
  return {
    scenarios: scenarios.count,
    runs: runs.count,
    findings: findings.count,
    notes: notes.count,
  }
}
