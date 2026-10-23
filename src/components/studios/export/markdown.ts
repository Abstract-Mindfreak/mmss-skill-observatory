// Клиентские сборщики markdown для копирования (ТЗ п.14): карточка фрагмента,
// разделы, выбранные результаты, сокращённый отчёт по всему проекту.
// Полные экспорт-файлы формирует сервер — здесь только текст для буфера обмена.

import {
  GRAPH_EDGE_KIND_TITLES,
  LAYER_TITLES,
  SCENARIO_STATUS_TITLES,
  type AppStateDTO,
  type FindingDTO,
  type FragmentCardDTO,
  type RunDTO,
} from '@/lib/types'

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('ru-RU')
  } catch {
    return iso
  }
}

export function fragmentCardMarkdown(card: FragmentCardDTO): string {
  const f = card.fragment
  const out: string[] = []
  out.push(`# Карточка фрагмента ${f.path}`)
  if (f.title) out.push(`**${f.title}**`)
  out.push('')
  out.push('## Текст')
  out.push(f.text)
  out.push('')
  if (card.layers.length > 0) {
    out.push('## Слои (локальный анализ)')
    for (const l of card.layers) {
      out.push(`- **${LAYER_TITLES[l.layer]}** — ${l.reason}`)
      if (l.matched.length > 0) out.push(`  - маркеры: ${l.matched.join(', ')}`)
      if (l.limitations) out.push(`  - ограничения: ${l.limitations}`)
    }
    out.push('')
  }
  if (card.interpretations.length > 0) {
    out.push('## Интерпретации моделей')
    for (const i of card.interpretations) {
      const src = i.model ? `${i.backend} · ${i.model}` : i.backend
      out.push(`- [${src}, ${fmtDate(i.createdAt)}] ${i.interpretation}`)
      if (i.alternatives.length > 0) out.push(`  - альтернативы: ${i.alternatives.join('; ')}`)
      if (i.scopeNote) out.push(`  - область действия: ${i.scopeNote}`)
      if (i.limitations) out.push(`  - ограничения: ${i.limitations}`)
    }
    out.push('')
  }
  if (card.notes.length > 0) {
    out.push('## Заметки')
    for (const n of card.notes) {
      out.push(`- [${n.kind}${n.origin === 'demo' ? ' · DEMO' : ''}, ${fmtDate(n.createdAt)}] ${n.body}`)
    }
    out.push('')
  }
  if (card.graphEdges.length > 0) {
    out.push('## Связи графа')
    for (const e of card.graphEdges) {
      out.push(`- ${e.source} → ${e.target} (${GRAPH_EDGE_KIND_TITLES[e.kind]}): ${e.basis.detail}`)
    }
    out.push('')
  }
  if (card.scenarios.length > 0) {
    out.push('## Сценарии')
    for (const s of card.scenarios) {
      out.push(`- [${SCENARIO_STATUS_TITLES[s.status]}${s.origin === 'demo' ? ' · DEMO' : ''}] ${s.title} (запусков: ${s.runCount})`)
    }
    out.push('')
  }
  if (card.findings.length > 0) {
    out.push('## Находки')
    for (const fd of card.findings) {
      out.push(`- [${fd.severity}/${fd.status}${fd.origin === 'demo' ? ' · DEMO' : ''}] ${fd.title} — ${fd.description}`)
    }
    out.push('')
  }
  out.push(`_Источник: обсерватория MMSS, карточка фрагмента ${f.id}; анализ: ${card.analysisProvenance}._`)
  return out.join('\n')
}

export function runsMarkdown(runs: RunDTO[], heading = 'Запуски'): string {
  if (runs.length === 0) return `${heading}: нет данных.`
  const out = [`${heading} (${runs.length})`, '']
  for (const r of runs) {
    const name = r.connectionName ?? r.connectionId ?? '?'
    const actual = r.input?.responseMetadata
    const src = `${r.backend} · ${name} · запрос: ${r.model ?? '?'} · факт: ${actual?.actualProvider ?? '?'} / ${actual?.actualModel ?? '?'}`
    const verdict = r.verdict ? `, вердикт: ${r.verdict} (${r.verdictBy ?? '?'})` : ''
    out.push(
      `- [${r.role}] ${src} — ${r.status}${r.durationMs != null ? `, ${r.durationMs} мс` : ''}${verdict}${r.origin === 'demo' ? ' · DEMO' : ''} · ${fmtDate(r.createdAt)}`
    )
    if (r.error) out.push(`  - ошибка: ${r.error}`)
  }
  return out.join('\n')
}

export function findingsMarkdown(findings: FindingDTO[], heading = 'Находки'): string {
  if (findings.length === 0) return `${heading}: нет данных.`
  const out = [`${heading} (${findings.length})`, '']
  for (const f of findings) {
    out.push(`### [${f.severity} · ${f.status}${f.origin === 'demo' ? ' · DEMO' : ''}] ${f.title}`)
    out.push(f.description)
    if (f.evidence) {
      const gaps = f.evidence.gaps.length > 0 ? `; пропуски цепочки: ${f.evidence.gaps.join('; ')}` : ''
      out.push(`_Обоснование: ${f.evidence.distinction}${gaps}_`)
    }
    out.push('')
  }
  return out.join('\n')
}

export function selectedResultsMarkdown(runs: RunDTO[], findings: FindingDTO[]): string {
  const out: string[] = []
  if (runs.length > 0) out.push(runsMarkdown(runs, 'Выбранные запуски'))
  if (findings.length > 0) out.push('', findingsMarkdown(findings, 'Выбранные находки'))
  if (out.length === 0) return 'Ничего не выбрано.'
  out.push('', `_Сформировано: ${new Date().toLocaleString('ru-RU')}._`)
  return out.join('\n')
}

const REPORT_MAX_RUNS = 30

/** Сокращённый клиентский отчёт по всему проекту (полный — серверные экспорт-кнопки). */
export function fullReportMarkdown(appState: AppStateDTO): string {
  const p = appState.project
  const out: string[] = []
  out.push(`# Отчёт проекта: ${p?.name ?? '—'}`)
  if (p?.description) out.push('', p.description)
  out.push('')
  out.push(`_Сформировано: ${new Date().toLocaleString('ru-RU')}. Сокращённая клиентская версия: запуски ограничены ${REPORT_MAX_RUNS} последними. Полный отчёт и Research Handoff Report — кнопки скачивания в разделе «Экспорт и передача»._`)
  out.push('')

  // Documents & versions table
  out.push('## Документы и версии')
  out.push('')
  out.push('| Документ | Версия | Тип | Активная | Известная версия | Фрагментов | Hash |')
  out.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const d of appState.documents) {
    for (const v of d.versions) {
      out.push(
        `| ${d.title} | ${v.label} | ${v.kind} | ${v.isActive ? 'да' : 'нет'} | ${v.knownVersion ?? '—'} | ${v.fragmentCount} | \`${v.contentHash.slice(0, 10)}\` |`
      )
    }
  }
  out.push('')

  // Scenarios tree (flat with indentation by parent chain)
  const scenarios = appState.scenarios
  out.push(`## Сценарии (${scenarios.length})`)
  out.push('')
  if (scenarios.length === 0) {
    out.push('Нет сценариев.')
  } else {
    const byParent = new Map<string | null, typeof scenarios>()
    for (const s of scenarios) {
      const key = s.parentId
      byParent.set(key, [...(byParent.get(key) ?? []), s])
    }
    const walk = (parent: string | null, depth: number) => {
      for (const s of byParent.get(parent) ?? []) {
        out.push(`${'  '.repeat(depth)}- [${SCENARIO_STATUS_TITLES[s.status]}${s.origin === 'demo' ? ' · DEMO' : ''}] ${s.title} (запусков: ${s.runCount})`)
        walk(s.id, depth + 1)
      }
    }
    walk(null, 0)
  }
  out.push('')

  const realRuns = appState.runs.filter((r) => r.origin === 'real')
  out.push(runsMarkdown(realRuns.slice(0, REPORT_MAX_RUNS), `## Запуски (реальные, показаны последние ${Math.min(REPORT_MAX_RUNS, realRuns.length)} из ${realRuns.length})`))
  out.push('')
  const realFindings = appState.findings.filter((f) => f.origin === 'real')
  out.push(findingsMarkdown(realFindings, `## Находки (реальные: ${realFindings.length})`))
  out.push('')
  const notes = appState.notes
  if (notes.length > 0) {
    out.push(`## Заметки (${notes.length})`)
    out.push('')
    for (const n of notes) {
      out.push(`- [${n.kind}${n.origin === 'demo' ? ' · DEMO' : ''}] ${n.body} (${fmtDate(n.createdAt)})`)
    }
  }
  return out.join('\n')
}

/** Текст отчёта по URL (экспорт/handoff) — для копирования содержимого серверных экспортов. */
export async function fetchAsText(url: string): Promise<string> {
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new Error('Сеть недоступна: не удалось получить отчёт с сервера')
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const j = (await res.json()) as { error?: string }
      if (j?.error) msg = j.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return res.text()
}
