// Idempotent seed: creates the research project for the mmss-principle-synthesis
// skill (SKILL.md v0.1.4 attachment) plus the starter scenario catalog.

import { readFileSync } from 'fs'
import { db } from '@/lib/db'
import { createDocumentWithVersion } from '@/lib/import-doc'
import { runLocalAnalysis } from '@/lib/analysis'
import { extractKnownVersion } from '@/lib/parser'

const SEED_PATHS = [
  `${process.cwd()}/src/seed/mmss-principle-synthesis.SKILL.md`,
  `${process.cwd()}/../src/seed/mmss-principle-synthesis.SKILL.md`,
]

const REMOTE_URL =
  'https://github.com/Abstract-Mindfreak/mmss-principle-synthesis/blob/main/skills/mmss-principle-synthesis/SKILL.md'

interface StarterScenario {
  title: string
  /** Preferred section paths for the anchor fragment, in order. */
  sections: string[]
  children: string[]
}

const STARTER_SCENARIOS: StarterScenario[] = [
  {
    title: 'Недоступный источник',
    sections: ['6.2'],
    children: [
      'Обязательный источник недоступен — что вернёт скилл',
      'Замена источника без разрешения',
    ],
  },
  {
    title: 'Повтор результата',
    sections: ['6.5'],
    children: ['Повторяющееся значение с неизвестной основой'],
  },
  {
    title: 'Конфликт требований',
    sections: ['16.2'],
    children: ['Схема требует числовой score, измерений нет'],
  },
  {
    title: 'Неизвестный исход',
    sections: ['15.4', '15'],
    children: ['Unknown ≠ absent в отчёте о состоянии'],
  },
  {
    title: 'Потеря ограничения при переносе в JSON',
    sections: ['16.1', '16'],
    children: [
      'Закрытая схема запрещает поле language',
      'Ограничение из prose не попало в контракт',
    ],
  },
]

async function firstLeafOfSection(
  versionId: string,
  sectionPath: string
): Promise<string | null> {
  const fragment = await db.fragment.findFirst({
    where: {
      versionId,
      kind: { in: ['sentence', 'list_item'] },
      OR: [{ path: sectionPath }, { path: { startsWith: `${sectionPath}.` } }],
    },
    orderBy: { order: 'asc' },
    select: { id: true },
  })
  return fragment?.id ?? null
}

export async function ensureSeed(): Promise<string> {
  const existing = await db.project.findFirst({ orderBy: { createdAt: 'asc' } })
  if (existing) return existing.id

  let content: string | null = null
  for (const path of SEED_PATHS) {
    try {
      content = readFileSync(path, 'utf8')
      break
    } catch {
      // try next path
    }
  }
  if (content === null) {
    throw new Error(
      `Не удалось прочитать сид-файл (${SEED_PATHS.join(' или ')}). Bootstrap невозможен без вложения SKILL.md.`
    )
  }

  const project = await db.project.create({
    data: {
      name: 'mmss-principle-synthesis — исследование скилла',
      description:
        'Исследование инструкции скилла mmss-principle-synthesis: структура, требования, интерпретации, сценарии и проверка поведения.',
      origin: 'seed',
    },
  })

  const { version } = await createDocumentWithVersion({
    projectId: project.id,
    title: 'SKILL.md — mmss-principle-synthesis',
    content,
    source: 'attachment',
    sourceUrl: REMOTE_URL,
    knownVersion: extractKnownVersion(content),
    completeness: 'full',
    label: 'origin',
    kind: 'original',
    isActive: true,
  })

  let order = 0
  for (const starter of STARTER_SCENARIOS) {
    let fragmentId: string | null = null
    for (const sectionPath of starter.sections) {
      fragmentId = await firstLeafOfSection(version.id, sectionPath)
      if (fragmentId) break
    }
    const root = await db.scenario.create({
      data: {
        projectId: project.id,
        parentId: null,
        title: starter.title,
        description: null,
        status: 'explored',
        origin: 'seed',
        fragmentId,
        order: order++,
      },
    })
    for (const childTitle of starter.children) {
      await db.scenario.create({
        data: {
          projectId: project.id,
          parentId: root.id,
          title: childTitle,
          description: null,
          status: 'unexplored',
          origin: 'seed',
          fragmentId: null,
          order: order++,
        },
      })
    }
  }

  await db.setting.upsert({
    where: { key: 'seeded' },
    update: {},
    create: { key: 'seeded', value: 'true' },
  })

  // re-run the local analysis so coverage counts include the starter scenarios
  await runLocalAnalysis(version.id)

  return project.id
}
