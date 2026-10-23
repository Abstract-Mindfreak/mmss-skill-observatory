// Центр копирования: фрагмент, карточка фрагмента, раздел, выбранные результаты,
// весь отчёт. Всё копируемо (ТЗ п.14).
'use client'

import * as React from 'react'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CopyButton } from '@/components/shared/copy'
import { FragmentRef } from '@/components/shared/misc'
import { OriginBadge, RunStatusBadge } from '@/components/shared/status-badges'
import { useStore } from '@/lib/store'
import type { FindingDTO, RunDTO } from '@/lib/types'
import { fragmentCardMarkdown, fullReportMarkdown, selectedResultsMarkdown } from './markdown'

function CopyRow({
  title,
  hint,
  children,
  copyText,
  copyLabel = 'Копировать',
  disabled,
}: {
  title: string
  hint: React.ReactNode
  children?: React.ReactNode
  copyText: string | (() => string | Promise<string>)
  copyLabel?: string
  disabled?: boolean
}) {
  return (
    <div className="grid gap-3 border-b pb-4 last:border-b-0 last:pb-0 md:grid-cols-[minmax(190px,1fr)_minmax(0,2fr)_auto] md:items-start md:gap-4">
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-medium">{title}</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      <div className="min-w-0">{children}</div>
      <div className="md:pt-0.5">
        <CopyButton text={copyText} label={copyLabel} disabled={disabled} />
      </div>
    </div>
  )
}

export function CopyCenter() {
  const appState = useStore((s) => s.appState)
  const selectedFragmentId = useStore((s) => s.selectedFragmentId)
  const loadFragmentCard = useStore((s) => s.loadFragmentCard)
  const loadVersionContent = useStore((s) => s.loadVersionContent)
  const setStudio = useStore((s) => s.setStudio)

  const fragments = appState?.fragments ?? []
  const sections = React.useMemo(
    () => fragments.filter((f) => f.kind === 'section').sort((a, b) => a.order - b.order),
    [fragments]
  )
  const [sectionId, setSectionId] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (sectionId && !sections.some((s) => s.id === sectionId)) setSectionId(null)
  }, [sections, sectionId])
  const activeVersion = appState?.activeVersion ?? null

  const selectedFragment = selectedFragmentId ? fragments.find((f) => f.id === selectedFragmentId) ?? null : null

  const [selectedRunIds, setSelectedRunIds] = React.useState<Set<string>>(new Set())
  const [selectedFindingIds, setSelectedFindingIds] = React.useState<Set<string>>(new Set())
  const runs = React.useMemo(() => (appState?.runs ?? []).slice(0, 20), [appState])
  const findings = appState?.findings ?? []
  const chosenRuns = runs.filter((r) => selectedRunIds.has(r.id))
  const chosenFindings = findings.filter((f) => selectedFindingIds.has(f.id))

  const fragmentText = async (): Promise<string> => {
    if (!selectedFragmentId) return 'Фрагмент не выбран. Откройте атлас и выберите фрагмент.'
    const card = await loadFragmentCard(selectedFragmentId)
    if (!card) return 'Не удалось загрузить фрагмент — попробуйте ещё раз.'
    return card.fragment.text
  }

  const cardMarkdown = async (): Promise<string> => {
    if (!selectedFragmentId) return 'Фрагмент не выбран. Откройте атлас и выберите фрагмент.'
    const card = await loadFragmentCard(selectedFragmentId)
    if (!card) return 'Не удалось загрузить карточку фрагмента — попробуйте ещё раз.'
    return fragmentCardMarkdown(card)
  }

  const sectionText = async (): Promise<string> => {
    const section = sections.find((s) => s.id === sectionId)
    if (!section || !activeVersion) return 'Раздел не выбран.'
    const content = await loadVersionContent(activeVersion.id)
    if (content == null) return 'Не удалось загрузить текст версии документа.'
    const lines = content.split('\n')
    const slice = lines.slice(Math.max(0, section.startLine - 1), section.endLine).join('\n')
    return `## Раздел ${section.path}${section.title ? `. ${section.title}` : ''}\n\n${slice}`
  }

  const toggle = (set: Set<string>, id: string, apply: (next: Set<string>) => void) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    apply(next)
  }

  return (
    <Card>
      <CardHeader className="gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Copy className="size-4 text-primary" aria-hidden />
          Копирование
        </CardTitle>
        <CardDescription>
          Текст попадает в буфер обмена (при блокировке Clipboard API откроется диалог с ручным копированием).
          Формат — markdown.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <CopyRow
          title="Фрагмент"
          hint="Текст фрагмента, выбранного в атласе."
          copyText={fragmentText}
          disabled={!selectedFragmentId}
        >
          {selectedFragment ? (
            <FragmentRef fragment={selectedFragment} />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">не выбран</span>
              <Button size="sm" variant="ghost" onClick={() => setStudio('atlas')}>
                Выбрать в атласе
              </Button>
            </div>
          )}
        </CopyRow>

        <CopyRow
          title="Карточка фрагмента"
          hint="Markdown: текст, слои с основаниями, интерпретации моделей, заметки, связи графа, сценарии, находки."
          copyText={cardMarkdown}
          disabled={!selectedFragmentId}
        >
          {selectedFragment ? (
            <p className="text-xs text-muted-foreground">
              карточка фрагмента <span className="font-mono">{selectedFragment.path}</span> — {selectedFragment.text.slice(0, 60)}
              {selectedFragment.text.length > 60 ? '…' : ''}
            </p>
          ) : (
            <span className="text-xs text-muted-foreground">выберите фрагмент в атласе</span>
          )}
        </CopyRow>

        <CopyRow
          title="Раздел"
          hint="Полный текст раздела активной версии (срез по строкам документа)."
          copyText={sectionText}
          disabled={!sectionId}
        >
          {sections.length === 0 ? (
            <span className="text-xs text-muted-foreground">в активной версии нет разделов</span>
          ) : (
            <Select value={sectionId ?? undefined} onValueChange={setSectionId}>
              <SelectTrigger size="sm" className="w-full max-w-md" aria-label="Выбор раздела">
                <SelectValue placeholder="Выберите раздел…" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {sections.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="font-mono text-xs">{s.path}</span>
                    {s.title ? ` · ${s.title.slice(0, 48)}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CopyRow>

        <CopyRow
          title="Выбранные результаты"
          hint="Отметьте запуски и находки — они собираются в markdown-выжимку."
          copyText={() => selectedResultsMarkdown(chosenRuns, chosenFindings)}
          disabled={chosenRuns.length === 0 && chosenFindings.length === 0}
        >
          <div className="scroll-observatory max-h-64 space-y-3 overflow-y-auto rounded-md border p-2.5">
            <div className="space-y-1.5">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Запуски (последние {runs.length})</p>
              {runs.length === 0 && <p className="text-xs text-muted-foreground">запусков нет</p>}
              {runs.map((r) => (
                <RunCheckRow
                  key={r.id}
                  run={r}
                  checked={selectedRunIds.has(r.id)}
                  onToggle={() => toggle(selectedRunIds, r.id, setSelectedRunIds)}
                />
              ))}
            </div>
            <div className="space-y-1.5">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Находки</p>
              {findings.length === 0 && <p className="text-xs text-muted-foreground">находок нет</p>}
              {findings.map((f) => (
                <FindingCheckRow
                  key={f.id}
                  finding={f}
                  checked={selectedFindingIds.has(f.id)}
                  onToggle={() => toggle(selectedFindingIds, f.id, setSelectedFindingIds)}
                />
              ))}
            </div>
          </div>
        </CopyRow>

        <CopyRow
          title="Весь отчёт"
          hint={`Сокращённый markdown по состоянию проекта: документы и версии, дерево сценариев, последние 30 запусков, находки, заметки. Полный отчёт — кнопкой «Отчёт Markdown».`}
          copyText={() => (appState ? fullReportMarkdown(appState) : 'Нет данных проекта.')}
        >
          <p className="text-xs text-muted-foreground">
            {appState
              ? `документов: ${appState.documents.length} · сценариев: ${appState.scenarios.length} · запусков (реальных): ${appState.runs.filter((r) => r.origin === 'real').length} · находок: ${appState.findings.length}`
              : 'данных нет'}
          </p>
        </CopyRow>
      </CardContent>
    </Card>
  )
}

function RunCheckRow({ run, checked, onToggle }: { run: RunDTO; checked: boolean; onToggle: () => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-muted/50">
      <Checkbox checked={checked} onCheckedChange={onToggle} className="mt-0.5" aria-label={`Выбрать запуск ${run.id}`} />
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px]">{run.role}</span>
          <RunStatusBadge status={run.status} compact />
          <OriginBadge origin={run.origin} />
          <span className="font-mono text-[10px] text-muted-foreground">
            {run.backend === 'ollama' ? `ollama · ${run.model ?? '?'}` : run.backend}
          </span>
        </span>
        <span className="block truncate text-[11px] text-muted-foreground" title={run.input?.prompt ?? ''}>
          {run.input?.prompt ? run.input.prompt.slice(0, 80) : run.error ? `ошибка: ${run.error.slice(0, 60)}` : run.id}
        </span>
      </span>
    </label>
  )
}

function FindingCheckRow({ finding, checked, onToggle }: { finding: FindingDTO; checked: boolean; onToggle: () => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-muted/50">
      <Checkbox checked={checked} onCheckedChange={onToggle} className="mt-0.5" aria-label={`Выбрать находку ${finding.title}`} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium">{finding.title}</span>
          <span className="font-mono text-[10px] text-muted-foreground">{finding.severity}/{finding.status}</span>
          <OriginBadge origin={finding.origin} />
        </span>
      </span>
    </label>
  )
}
