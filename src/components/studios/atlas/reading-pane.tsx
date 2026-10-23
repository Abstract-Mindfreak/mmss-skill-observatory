// The reading pane: toolbar (zoom switcher, search, copy-section), layer filter
// chips with counts, and the document body rendered per zoom level —
// «Документ» (headings + preview), «Разделы» (blocks + sentence counts),
// «Абзацы» (full block text, sentences marked inline), «Предложения»/«Слова»
// (every sentence as a row — the main analysis view; in «Слова» words are
// clickable). Lazy rendering: sections render as an accordion, only expanded
// sections render their body.

'use client'

import * as React from 'react'
import {
  ChevronRight,
  Copy as CopyIcon,
  FileDown,
  Info,
  Layers,
  ListTree,
  RefreshCw,
  Search,
  Target,
  X,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CopyButton } from '@/components/shared/copy'
import { FragmentRef } from '@/components/shared/misc'
import { EmptyState, ErrorState, InlineSpinner } from '@/components/shared/states'
import { StatusBadge } from '@/components/shared/status-badges'
import { LAYER_VISUALS } from '@/components/shared/layers'
import { LAYER_TITLES, type FragmentDTO, type LayerId } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useAtlas, type AtlasZoom } from './context'
import { formatDateRu, pluralRu } from './format'
import {
  LAYER_HINTS,
  LAYER_IDS,
  fragmentLayerInfos,
  strongestLayer,
  type LayerLoadStatus,
} from './layer-index'
import type { Block, SectionNode } from './doc-structure'
import { FragmentText } from './text-render'
import { computeWordInfo, WordInspector } from './word-inspector'

const ZOOM_LEVELS: { id: AtlasZoom; label: string; hint: string }[] = [
  { id: 'document', label: 'Документ', hint: 'Все разделы: заголовки и первый абзац' },
  { id: 'sections', label: 'Разделы', hint: 'Абзацы выбранного раздела со счётчиком предложений' },
  { id: 'paragraphs', label: 'Абзацы', hint: 'Полный текст абзацев, предложения встроены' },
  { id: 'sentences', label: 'Предложения', hint: 'Каждое предложение отдельной строкой — основной вид анализа' },
  { id: 'words', label: 'Слова', hint: 'Предложения с кликабельными словами — инспектор слова' },
]

export function ReadingPane({
  layerStatus,
  layerError,
  analysisBusy,
  onRunAnalysis,
  onDownloadVersion,
  onOpenOutline,
}: {
  layerStatus: LayerLoadStatus
  layerError?: string
  analysisBusy: boolean
  onRunAnalysis: () => void
  onDownloadVersion: () => void
  onOpenOutline: () => void
}) {
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card/60">
      <Toolbar
        layerStatus={layerStatus}
        layerError={layerError}
        analysisBusy={analysisBusy}
        onRunAnalysis={onRunAnalysis}
        onDownloadVersion={onDownloadVersion}
        onOpenOutline={onOpenOutline}
      />
      <div className="scroll-observatory max-h-[75vh] overflow-y-auto lg:max-h-[calc(100vh-16rem)]">
        <PaneBody />
      </div>
      <WordInspector />
    </div>
  )
}

// ---------- toolbar ----------

function Toolbar({
  layerStatus,
  layerError,
  analysisBusy,
  onRunAnalysis,
  onDownloadVersion,
  onOpenOutline,
}: {
  layerStatus: LayerLoadStatus
  layerError?: string
  analysisBusy: boolean
  onRunAnalysis: () => void
  onDownloadVersion: () => void
  onOpenOutline: () => void
}) {
  const { zoom, setZoom, query, setQuery } = useAtlas()
  return (
    <div className="flex flex-col gap-2.5 border-b p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 lg:hidden"
          onClick={onOpenOutline}
          aria-label="Открыть оглавление документа"
        >
          <ListTree className="size-3.5" aria-hidden />
          Оглавление
        </Button>
        <div
          role="tablist"
          aria-label="Масштаб просмотра"
          className="flex min-w-0 items-center overflow-x-auto rounded-lg border bg-muted/40 p-0.5 scroll-observatory"
        >
          {ZOOM_LEVELS.map((z) => (
            <button
              key={z.id}
              type="button"
              role="tab"
              aria-selected={zoom === z.id}
              title={z.hint}
              disabled={!!query.trim()}
              className={cn(
                'shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                zoom === z.id
                  ? 'bg-primary/15 text-primary glow-teal'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                query.trim() && 'opacity-50'
              )}
              onClick={() => setZoom(z.id)}
            >
              {z.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto min-w-0 flex-1 sm:max-w-64">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по предложениям…"
            aria-label="Поиск по тексту документа"
            className="h-8 pl-8 pr-8 text-xs"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Очистить поиск"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
        <CopySectionButton />
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={onDownloadVersion}
          title="Скачать полный текст активной версии (Markdown)"
        >
          <FileDown className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">Скачать текст версии</span>
        </Button>
      </div>
      <LayersBar layerStatus={layerStatus} layerError={layerError} analysisBusy={analysisBusy} onRunAnalysis={onRunAnalysis} />
    </div>
  )
}

function CopySectionButton() {
  const { structure, selectedSectionPath } = useAtlas()
  const section = selectedSectionPath ? structure.sectionsByPath.get(selectedSectionPath) : null
  const text = section ? section.section.text : ''
  return (
    <span
      title={
        section
          ? `Скопировать полный текст раздела ${selectedSectionPath} (включая подразделы)`
          : 'Сначала выберите раздел — в оглавлении или заголовке в тексте'
      }
    >
      <CopyButton
        text={text}
        label="Копировать раздел"
        size="sm"
        disabled={!section}
      />
    </span>
  )
}

// ---------- layer toggles ----------

function LayersBar({
  layerStatus,
  layerError,
  analysisBusy,
  onRunAnalysis,
}: {
  layerStatus: LayerLoadStatus
  layerError?: string
  analysisBusy: boolean
  onRunAnalysis: () => void
}) {
  const { layerIndex, activeLayers, toggleLayer, setLayersPreset, coverageSet } = useAtlas()
  const counts = React.useMemo(() => {
    const c: Partial<Record<LayerId, number>> = {}
    if (layerIndex) {
      for (const l of LAYER_IDS) c[l] = layerIndex.layerCounts[l] ?? 0
    }
    c.coverage = coverageSet.size
    return c
  }, [layerIndex, coverageSet])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Layers className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0 text-xs font-medium text-muted-foreground">Слои:</span>
        {LAYER_IDS.map((l) => {
          const v = LAYER_VISUALS[l]
          const Icon = v.icon
          const active = activeLayers.has(l)
          const count = layerStatus === 'ok' ? (counts[l] ?? 0) : null
          return (
            <TooltipProvider key={l}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-pressed={active}
                    disabled={layerStatus !== 'ok'}
                    onClick={() => toggleLayer(l)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-all',
                      active ? 'hover:opacity-90' : 'opacity-55 hover:opacity-100'
                    )}
                    style={{
                      borderColor: `${v.color}55`,
                      backgroundColor: active ? `${v.color}26` : 'transparent',
                      color: v.color,
                    }}
                  >
                    <Icon className="size-3" aria-hidden />
                    {LAYER_TITLES[l]}
                    {count !== null && (
                      <span className="font-mono text-[9px] opacity-80">{count}</span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-72 text-xs">
                  <p className="font-medium">{LAYER_TITLES[l]}</p>
                  <p className="mt-1 text-muted-foreground">{LAYER_HINTS[l]}</p>
                  {count !== null && (
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {count} {pluralRu(count, 'фрагмент', 'фрагмента', 'фрагментов')} в этой версии
                      {l === 'coverage' ? ' (живой подсчёт по текущим сценариям)' : ''}
                    </p>
                  )}
                  <p className="mt-1 text-[10px] text-muted-foreground">Нажмите, чтобы включить/выключить слой</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )
        })}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          disabled={layerStatus !== 'ok'}
          onClick={() => setLayersPreset('all')}
          title="Включить все слои"
        >
          Все
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          disabled={layerStatus !== 'ok'}
          onClick={() => setLayersPreset('default')}
          title="Вернуть настройки по умолчанию: обязательства и запреты"
        >
          Сбросить
        </Button>
      </div>
      <AnalysisNote
        layerStatus={layerStatus}
        layerError={layerError}
        analysisBusy={analysisBusy}
        onRunAnalysis={onRunAnalysis}
      />
    </div>
  )
}

function AnalysisNote({
  layerStatus,
  layerError,
  analysisBusy,
  onRunAnalysis,
}: {
  layerStatus: LayerLoadStatus
  layerError?: string
  analysisBusy: boolean
  onRunAnalysis: () => void
}) {
  const { layerIndex } = useAtlas()
  if (layerStatus === 'loading') {
    return <InlineSpinner label="Локальный структурный анализ…" />
  }
  if (layerStatus === 'no-analysis') {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <StatusBadge status="PLACEHOLDER" withHint={false} />
        <span>Локальный анализ не выполнялся — слои и маркеры недоступны, текст читается без подсветки.</span>
        <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-[11px]" onClick={onRunAnalysis} disabled={analysisBusy}>
          <RefreshCw className="size-3" aria-hidden />
          Выполнить локальный анализ
        </Button>
      </div>
    )
  }
  if (layerStatus === 'error') {
    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <ErrorState
          error={layerError ?? 'Неизвестная ошибка'}
          title="Локальный анализ не выполнен"
          className="flex-1"
        />
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onRunAnalysis} disabled={analysisBusy}>
            <RefreshCw className="size-3.5" aria-hidden />
            Повторить
          </Button>
          <span className="text-[10px] text-muted-foreground">атлас остаётся читаемым без слоёв</span>
        </div>
      </div>
    )
  }
  if (layerStatus === 'ok' && layerIndex) {
    return (
      <p className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
        <StatusBadge status="LOCAL" withHint={false} />
        <span>
          сохранённый результат локального анализа · {layerIndex.durationMs} мс ·{' '}
          {layerIndex.fragmentCount} фрагментов · {formatDateRu(layerIndex.createdAt)}
        </span>
        <span className="opacity-70">— эвристика по маркерам, не смысловое понимание</span>
      </p>
    )
  }
  return null
}

// ---------- body ----------

function PaneBody() {
  const { query, zoom } = useAtlas()
  if (query.trim()) return <SearchView />
  if (zoom === 'document') return <DocumentView />
  return <AccordionView />
}

// ---------- «Документ» zoom ----------

function DocumentView() {
  const { structure, selectedSectionPath, selectSection, linkedSections } = useAtlas()
  return (
    <div className="divide-y divide-border/60">
      {structure.orderedSections.map((node) => {
        const path = node.section.path
        const content = structure.contentByPath.get(path)
        const preview =
          content?.blocks[0]?.fragment.text.replace(/\s+/g, ' ').trim() ??
          content?.subsections[0]?.section.title ??
          ''
        const linked = linkedSections.get(path) ?? 0
        const selected = selectedSectionPath === path
        return (
          <button
            key={node.section.id}
            id={`sec-${path}`}
            type="button"
            onClick={() => selectSection(path)}
            className={cn(
              'block w-full scroll-mt-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/60',
              selected && 'bg-primary/10'
            )}
          >
            <div className="flex items-baseline gap-2" style={{ paddingLeft: node.depth * 12 }}>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{path}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {node.section.title ?? '—'}
              </span>
              {linked > 0 && (
                <span
                  className="inline-flex shrink-0 items-center gap-0.5 text-emerald-500"
                  title={`Раздел связан со сценариями (${linked})`}
                >
                  <Target className="size-3" aria-hidden />
                  {linked > 1 && <span className="font-mono text-[9px]">{linked}</span>}
                </span>
              )}
              <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                стр. {node.section.startLine}–{node.section.endLine}
              </span>
            </div>
            {preview && (
              <p className="mt-0.5 line-clamp-1 pl-10 text-xs text-muted-foreground">{preview}</p>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ---------- accordion («Разделы» / «Абзацы» / «Предложения» / «Слова») ----------

function AccordionView() {
  const { structure } = useAtlas()
  return (
    <div>
      {structure.orderedSections.map((node) => (
        <SectionItem key={node.section.id} node={node} />
      ))}
    </div>
  )
}

function SectionItem({ node }: { node: SectionNode }) {
  const { expandedSections, selectedSectionPath, toggleSection, selectSection, linkedSections, zoom } =
    useAtlas()
  const path = node.section.path
  const expanded = expandedSections.has(path)
  const selected = selectedSectionPath === path
  const linked = linkedSections.get(path) ?? 0
  return (
    <section
      id={`sec-${path}`}
      className={cn('scroll-mt-2 border-b border-border/60 last:border-b-0', selected && 'bg-primary/5')}
    >
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => (expanded ? toggleSection(path) : selectSection(path))}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
        >
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              expanded && 'rotate-90'
            )}
            aria-hidden
          />
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{path}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {node.section.title ?? node.section.text.split('\n')[0].slice(0, 60)}
          </span>
          {linked > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex shrink-0 items-center gap-0.5 text-emerald-500"
                    aria-label="Раздел связан со сценариями"
                  >
                    <Target className="size-3.5" aria-hidden />
                    {linked > 1 && <span className="font-mono text-[9px]">{linked}</span>}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-64 text-xs">
                  К разделу привязаны сценарии: {linked}{' '}
                  {pluralRu(linked, 'сценарий', 'сценария', 'сценариев')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
            стр. {node.section.startLine}–{node.section.endLine}
          </span>
        </button>
      </div>
      {expanded && <SectionBody node={node} zoom={zoom} />}
    </section>
  )
}

function SectionBody({ node, zoom }: { node: SectionNode; zoom: AtlasZoom }) {
  const { structure } = useAtlas()
  const content = structure.contentByPath.get(node.section.path)
  if (!content) return null
  return (
    <div className="space-y-1 px-3 pb-4 pt-1">
      {content.blocks.length === 0 && content.subsections.length > 0 && (
        <div className="rounded-md border border-dashed p-2.5 text-xs text-muted-foreground">
          Собственного текста нет — раздел содержит подразделы:{' '}
          <span className="font-mono">{content.subsections.map((s) => s.section.path).join(', ')}</span>
        </div>
      )}
      {content.blocks.map((block) => {
        if (zoom === 'sections') return <BlockSummaryRow key={block.fragment.id} block={block} />
        if (zoom === 'paragraphs') return <BlockFullRow key={block.fragment.id} block={block} />
        if (block.sentences.length > 0) {
          return (
            <div key={block.fragment.id} className="space-y-0.5">
              {block.sentences.map((s) => (
                <SentenceRow key={s.id} fragment={s} />
              ))}
            </div>
          )
        }
        return <SentenceRow key={block.fragment.id} fragment={block.fragment} />
      })}
    </div>
  )
}

// ---------- «Разделы» zoom: block + sentence count ----------

function BlockSummaryRow({ block }: { block: Block }) {
  const { selectFragment, selectedFragmentId, layerIndex, coverageSet, activeLayers } = useAtlas()
  const fid = block.fragment.id
  const selected = selectedFragmentId === fid
  const layers = fragmentLayerInfos(layerIndex, fid, coverageSet)
  const visible = layers.filter((l) => activeLayers.has(l.layer)).map((l) => l.layer)
  const strongest = strongestLayer(visible)
  const v = strongest ? LAYER_VISUALS[strongest] : null
  return (
    <button
      type="button"
      id={`frag-${fid}`}
      onClick={() => selectFragment(fid)}
      className={cn(
        'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60',
        selected && 'bg-primary/10 ring-1 ring-primary/40'
      )}
    >
      <span className="mt-0.5 w-16 shrink-0 truncate font-mono text-[10px] text-muted-foreground/80">
        {block.fragment.path}
      </span>
      <span
        className="min-w-0 flex-1 line-clamp-2 text-sm leading-relaxed"
        style={v ? { textDecorationLine: 'underline', textDecorationColor: v.color, textDecorationStyle: v.style, textUnderlineOffset: '3px' } : undefined}
      >
        {block.fragment.text}
      </span>
      <Badge variant="outline" className="mt-0.5 shrink-0 text-[9px] text-muted-foreground">
        {block.sentences.length > 0
          ? `${block.sentences.length} ${pluralRu(block.sentences.length, 'предложение', 'предложения', 'предложений')}`
          : 'без разбиения'}
      </Badge>
    </button>
  )
}

// ---------- «Абзацы» zoom: full block text with inline sentence marks ----------

function BlockFullRow({ block }: { block: Block }) {
  const { selectFragment, selectedFragmentId, layerIndex, coverageSet, activeLayers } = useAtlas()
  const fid = block.fragment.id
  const selected = selectedFragmentId === fid

  const spans = React.useMemo(() => markSentenceSpans(block.fragment.text, block.sentences), [block])
  const markedAny = spans.some((s) => s.sentence)

  return (
    <div
      id={`frag-${fid}`}
      role="button"
      tabIndex={0}
      onClick={() => selectFragment(fid)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          selectFragment(fid)
        }
      }}
      className={cn(
        'flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60',
        selected && 'bg-primary/10 ring-1 ring-primary/40'
      )}
    >
      <span className="mt-0.5 w-16 shrink-0 truncate font-mono text-[10px] text-muted-foreground/80">
        {block.fragment.path}
      </span>
      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-relaxed">
        {markedAny ? (
          spans.map((s, i) =>
            s.sentence ? (
              <InlineSentenceMark key={i} fragment={s.sentence} />
            ) : (
              <React.Fragment key={i}>{s.text}</React.Fragment>
            )
          )
        ) : (
          // fallback: no sentence span matched — mark the whole block by its own layers
          <FragmentText
            text={block.fragment.text}
            layer={strongestLayer(
              fragmentLayerInfos(layerIndex, fid, coverageSet)
                .filter((l) => activeLayers.has(l.layer))
                .map((l) => l.layer)
            ) ?? undefined}
            active={selected}
            onClick={() => selectFragment(fid)}
          />
        )}
      </p>
    </div>
  )
}

function InlineSentenceMark({ fragment }: { fragment: FragmentDTO }) {
  const { selectFragment, layerIndex, coverageSet, activeLayers } = useAtlas()
  const layers = fragmentLayerInfos(layerIndex, fragment.id, coverageSet)
  const visible = layers.filter((l) => activeLayers.has(l.layer)).map((l) => l.layer)
  const strongest = strongestLayer(visible)
  return (
    <FragmentText
      text={fragment.text}
      layer={strongest ?? undefined}
      onClick={() => selectFragment(fragment.id)}
    />
  )
}

function markSentenceSpans(
  text: string,
  sentences: FragmentDTO[]
): { text: string; sentence: FragmentDTO | null }[] {
  const out: { text: string; sentence: FragmentDTO | null }[] = []
  let cursor = 0
  for (const s of sentences) {
    if (!s.text) continue
    const idx = text.indexOf(s.text, cursor)
    if (idx === -1) continue
    if (idx > cursor) out.push({ text: text.slice(cursor, idx), sentence: null })
    out.push({ text: s.text, sentence: s })
    cursor = idx + s.text.length
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), sentence: null })
  return out
}

// ---------- sentence row («Предложения» / «Слова» / поиск) ----------

export function SentenceRow({ fragment }: { fragment: FragmentDTO }) {
  const a = useAtlas()
  const layers = fragmentLayerInfos(a.layerIndex, fragment.id, a.coverageSet)
  const visible = layers.filter((l) => a.activeLayers.has(l.layer)).map((l) => l.layer)
  const strongest = strongestLayer(visible)
  const annotation = a.layerIndex?.annotations.get(fragment.id) ?? null
  const selected = a.selectedFragmentId === fragment.id
  const repGroups = a.layerIndex?.repetitions.get(fragment.id)
  const conflictCandidates = a.layerIndex?.conflicts.get(fragment.id)
  const covered = a.activeLayers.has('coverage') && a.coverageSet.has(fragment.id)
  const wordMode = a.zoom === 'words'

  return (
    <div
      id={`frag-${fragment.id}`}
      role="button"
      tabIndex={0}
      onClick={() => a.selectFragment(fragment.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          a.selectFragment(fragment.id)
        }
      }}
      className={cn(
        'flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60',
        selected && 'bg-primary/10 ring-1 ring-primary/40'
      )}
    >
      <span
        className="mt-0.5 w-16 shrink-0 truncate font-mono text-[10px] text-muted-foreground/80"
        title={`Путь ${fragment.path} · строки ${fragment.startLine}–${fragment.endLine}`}
      >
        {fragment.path}
      </span>
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          <FragmentText
            text={fragment.text}
            markers={annotation?.markers}
            query={a.query}
            layer={strongest ?? undefined}
            active={selected}
            onClick={() => a.selectFragment(fragment.id)}
            wordMode={wordMode}
            onWordClick={(word, el) => {
              const rect = el.getBoundingClientRect()
              const info = computeWordInfo(a.structure, word)
              a.setWordInspect({ word, ...info, x: rect.left, y: rect.bottom })
            }}
          />
        </p>
        {(repGroups || conflictCandidates || covered) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {a.activeLayers.has('repetition') && repGroups && repGroups.length > 0 && (
              <RepetitionBadge fragmentId={fragment.id} />
            )}
            {a.activeLayers.has('conflict') && conflictCandidates && conflictCandidates.length > 0 && (
              <ConflictBadge fragmentId={fragment.id} />
            )}
            {covered && <CoverageMark />}
          </div>
        )}
      </div>
    </div>
  )
}

function CoverageMark() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-flex items-center gap-1 text-[10px] text-emerald-500"
            aria-label="Раздел покрыт проверочными сценариями"
          >
            <Target className="size-3" aria-hidden />
            покрытие сценарием
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-72 text-xs">
          Раздел, содержащий фрагмент, покрыт проверочными сценариями. Покрытие относится к разделу, а не
          к отдельному предложению; наличие сценария не равно пройденной проверке.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function RepetitionBadge({ fragmentId }: { fragmentId: string }) {
  const { layerIndex, structure } = useAtlas()
  const groups = layerIndex?.repetitions.get(fragmentId) ?? []
  if (groups.length === 0) return null
  const others = [...new Set(groups.flatMap((g) => g.fragmentIds))].filter((id) => id !== fragmentId)
  const maxSim = Math.max(...groups.map((g) => g.similarity))
  const v = LAYER_VISUALS.repetition
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium hover:opacity-80"
          style={{ borderColor: `${v.color}55`, backgroundColor: `${v.color}14`, color: v.color }}
          title="Повторяющийся фрагмент — нажмите для группы повтора"
        >
          <CopyIcon className="size-2.5" aria-hidden />
          повторяет {others.length} {pluralRu(others.length, 'фрагмент', 'фрагмента', 'фрагментов')} (сходство{' '}
          {maxSim.toFixed(2)})
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-xs">
        <p className="text-sm font-semibold">Группа повтора</p>
        <p className="mt-1 text-muted-foreground">
          {groups[0].method}
        </p>
        <div className="scroll-observatory mt-2 max-h-48 space-y-1 overflow-y-auto pr-1">
          {others.map((id) => (
            <FragmentRef key={id} fragment={structure.byId.get(id) ?? null} />
          ))}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Сходство лексическое (в этом представлении) — это не доказательство смысловой эквивалентности.
        </p>
      </PopoverContent>
    </Popover>
  )
}

function ConflictBadge({ fragmentId }: { fragmentId: string }) {
  const { layerIndex, structure } = useAtlas()
  const cands = layerIndex?.conflicts.get(fragmentId) ?? []
  if (cands.length === 0) return null
  const v = LAYER_VISUALS.conflict
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium hover:opacity-80"
          style={{ borderColor: `${v.color}55`, backgroundColor: `${v.color}14`, color: v.color }}
          title="Кандидат на конфликт — нажмите для условий столкновения"
        >
          <Zap className="size-2.5" aria-hidden />
          возможный конфликт ({cands.length})
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 text-xs">
        <p className="text-sm font-semibold">Кандидат на конфликт требований</p>
        {cands.map((c, i) => {
          const otherId = c.aFragmentId === fragmentId ? c.bFragmentId : c.aFragmentId
          return (
            <div key={i} className="mt-2 space-y-1.5 rounded-md border p-2">
              <p className="flex items-start gap-1.5">
                <Info className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
                {c.clashConditions}
              </p>
              <p className="text-muted-foreground">
                <span className="font-medium">Подозрение снимается, если:</span> {c.acquittalCondition}
              </p>
              <p className="text-[10px] text-muted-foreground">Основание: {c.basis}</p>
              <div>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Другая сторона
                </p>
                <FragmentRef fragment={structure.byId.get(otherId) ?? null} />
              </div>
            </div>
          )
        })}
        <p className="mt-2 text-[10px] text-muted-foreground">
          Гипотеза по эвристике «противоположная модальность + общий термин» — подтверждение требует
          проверочного сценария.
        </p>
      </PopoverContent>
    </Popover>
  )
}

// ---------- search ----------

function SearchView() {
  const { structure, query, setQuery, selectSection } = useAtlas()
  const q = query.trim().toLowerCase()

  const { groups, total } = React.useMemo(() => {
    if (!q) return { groups: [] as [string, FragmentDTO[]][], total: 0 }
    const matched: FragmentDTO[] = []
    for (const c of structure.contentByPath.values()) {
      for (const b of c.blocks) {
        const rows = b.sentences.length > 0 ? b.sentences : [b.fragment]
        for (const r of rows) {
          if (r.text.toLowerCase().includes(q)) matched.push(r)
        }
      }
    }
    const bySec = new Map<string, FragmentDTO[]>()
    for (const r of matched) {
      const sp = structure.sectionPathOf.get(r.id) ?? '?'
      const arr = bySec.get(sp) ?? []
      arr.push(r)
      bySec.set(sp, arr)
    }
    const groups = [...bySec.entries()].sort((a, b) => {
      const oa = structure.sectionsByPath.get(a[0])?.section.order ?? 0
      const ob = structure.sectionsByPath.get(b[0])?.section.order ?? 0
      return oa - ob
    })
    return { groups, total: matched.length }
  }, [structure, q])

  if (!q) return null

  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {total > 0 ? (
            <>
              Найдено <span className="font-mono font-semibold text-foreground">{total}</span>{' '}
              {pluralRu(total, 'совпадение', 'совпадения', 'совпадений')} в{' '}
              <span className="font-mono font-semibold text-foreground">{groups.length}</span>{' '}
              {pluralRu(groups.length, 'разделе', 'разделах', 'разделах')}
            </>
          ) : (
            'Совпадений нет'
          )}
          <span className="ml-1 opacity-70">— поиск по предложениям и пунктам списка, без учёта регистра</span>
        </p>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[11px]" onClick={() => setQuery('')}>
          <X className="size-3" aria-hidden />
          Очистить поиск
        </Button>
      </div>
      {total === 0 ? (
        <EmptyState
          title="Ничего не найдено"
          hint="Поиск идёт по тексту предложений и пунктов списка активной версии. Попробуйте другое слово или короткую фразу."
        />
      ) : (
        groups.map(([sp, rows]) => {
          const node = structure.sectionsByPath.get(sp)
          return (
            <div key={sp} className="overflow-hidden rounded-md border">
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  selectSection(sp)
                }}
                className="flex w-full items-center gap-2 border-b bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted/60"
                title="Перейти к разделу в тексте"
              >
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{sp}</span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {node?.section.title ?? '—'}
                </span>
                <Badge variant="outline" className="shrink-0 text-[9px] text-muted-foreground">
                  {rows.length}
                </Badge>
              </button>
              <div className="p-1">
                {rows.map((r) => (
                  <SentenceRow key={r.id} fragment={r} />
                ))}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
