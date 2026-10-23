// Instruction Atlas — центральный экран: полный текст документа с
// масштабированием (документ → раздел → абзац → предложение → слово),
// переключаемыми визуальными слоями локального анализа, поиском и карточками
// фрагментов. Слой-данные получаются одним вызовом POST /api/versions/{id}/analyze
// за сессию (идемпотентное локальное вычисление ~150–600 мс) и кэшируются
// на уровне модуля по versionId.

'use client'

import * as React from 'react'
import { BookOpen, FileDown, FileText, ListTree, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { SectionHeader } from '@/components/shared/misc'
import { EmptyState, InlineSpinner } from '@/components/shared/states'
import { StatusBadge } from '@/components/shared/status-badges'
import { isViewingActiveVersion, useStore } from '@/lib/store'
import { api } from '@/lib/api-client'
import type { LayerId, LocalAnalysisResult } from '@/lib/types'
import { useToast } from '@/hooks/use-toast'
import {
  AtlasContext,
  type AtlasContextValue,
  type AtlasZoom,
  type WordInspectState,
} from './atlas/context'
import {
  buildDocStructure,
  computeCoverageSet,
  computeLinkedSections,
} from './atlas/doc-structure'
import {
  DEFAULT_ACTIVE_LAYERS,
  LAYER_IDS,
  buildLayerIndex,
  cacheLayerIndex,
  getCachedLayerIndex,
  type LayerLoadState,
} from './atlas/layer-index'
import { OutlinePanel } from './atlas/outline'
import { ReadingPane } from './atlas/reading-pane'
import { AtlasFragmentCard } from './atlas/fragment-card'
import { SemanticCodemap } from './atlas/semantic-codemap'
import { useMediaQuery } from './atlas/use-media-query'

export default function AtlasStudio() {
  const { toast } = useToast()
  const appState = useStore((s) => s.appState)
  const refresh = useStore((s) => s.refresh)
  const selectFragmentStore = useStore((s) => s.selectFragment)
  const selectVersion = useStore((s) => s.selectVersion)
  const selectedFragmentId = useStore((s) => s.selectedFragmentId)
  const selectedVersionId = useStore((s) => s.selectedVersionId)
  const setStudio = useStore((s) => s.setStudio)
  const loadVersionContent = useStore((s) => s.loadVersionContent)
  const viewingActive = useStore(isViewingActiveVersion)

  // The atlas always shows the ACTIVE version's fragments (that is what
  // /api/state provides); a mismatch with the version selector gets an honest
  // STALE banner below.
  const displayVersion = appState?.activeVersion ?? null
  const fragments = appState?.fragments ?? []

  const structure = React.useMemo(() => buildDocStructure(fragments), [fragments])
  const coverageSet = React.useMemo(
    () => computeCoverageSet(structure, appState?.scenarios ?? []),
    [structure, appState?.scenarios]
  )
  const linkedSections = React.useMemo(
    () => computeLinkedSections(structure, appState?.scenarios ?? []),
    [structure, appState?.scenarios]
  )

  const [layerState, setLayerState] = React.useState<LayerLoadState>({ status: 'idle', index: null })
  const [analysisBusy, setAnalysisBusy] = React.useState(false)
  const [activeLayers, setActiveLayers] = React.useState<ReadonlySet<LayerId>>(
    () => new Set(DEFAULT_ACTIVE_LAYERS)
  )
  const [zoom, setZoom] = React.useState<AtlasZoom>('sentences')
  const [query, setQuery] = React.useState('')
  const [selectedSectionPath, setSelectedSectionPath] = React.useState<string | null>(null)
  const [expandedSections, setExpandedSections] = React.useState<ReadonlySet<string>>(() => new Set())
  const [outlineOpen, setOutlineOpen] = React.useState(false)
  const [cardDialogOpen, setCardDialogOpen] = React.useState(false)
  const [wordInspect, setWordInspect] = React.useState<WordInspectState | null>(null)
  const [makeActiveBusy, setMakeActiveBusy] = React.useState(false)
  const [codemapOpen, setCodemapOpen] = React.useState(false)
  const codemapTarget = useStore((state) => state.codemapTarget)
  const codemapReturnCampaignId = useStore((state) => state.codemapReturnCampaignId)
  React.useEffect(() => {
    if (!codemapTarget) return
    const frame = window.requestAnimationFrame(() => setCodemapOpen(true))
    return () => window.cancelAnimationFrame(frame)
  }, [codemapTarget])
  const isDesktop = useMediaQuery('(min-width: 1280px)')

  const versionRef = React.useRef(displayVersion)
  versionRef.current = displayVersion

  // ---- layer index: build only after explicit user action; opening Atlas stays read-only ----
  const ensureLayerIndex = React.useCallback(async (force: boolean) => {
    const version = versionRef.current
    if (!version) return
    if (!force) {
      const cached = getCachedLayerIndex(version.id)
      if (cached) {
        setLayerState({ status: 'ok', index: cached })
        return
      }
      setLayerState({ status: version.hasLocalAnalysis ? 'idle' : 'no-analysis', index: null })
      return
    }
    setAnalysisBusy(true)
    setLayerState((s) => ({ status: 'loading', index: s.index }))
    try {
      const res = await api.analyzeVersion(version.id)
      const result = res.result as LocalAnalysisResult
      const index = buildLayerIndex(version.id, result)
      cacheLayerIndex(index)
      setLayerState({ status: 'ok', index })
    } catch (e) {
      setLayerState({
        status: 'error',
        index: null,
        error: e instanceof Error ? e.message : 'Не удалось выполнить локальный анализ',
      })
    } finally {
      setAnalysisBusy(false)
    }
  }, [])

  // reset + (re)load when the displayed version changes
  React.useEffect(() => {
    setSelectedSectionPath(null)
    setExpandedSections(new Set())
    setWordInspect(null)
    void ensureLayerIndex(false)
  }, [displayVersion?.id, ensureLayerIndex])

  // ---- expand + scroll to the selected fragment (restores working context) ----
  React.useEffect(() => {
    if (!selectedFragmentId) return
    const sp = structure.sectionPathOf.get(selectedFragmentId)
    if (!sp) return
    setExpandedSections((prev) => (prev.has(sp) ? prev : new Set([...prev, sp])))
    const t = setTimeout(() => {
      const el =
        document.getElementById(`frag-${selectedFragmentId}`) ?? document.getElementById(`sec-${sp}`)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 140)
    return () => clearTimeout(t)
  }, [selectedFragmentId, structure])

  // open the card dialog on selection when there is no side panel (mobile/tablet)
  React.useEffect(() => {
    if (selectedFragmentId && !isDesktop) setCardDialogOpen(true)
  }, [selectedFragmentId, isDesktop])

  // ---- handlers ----
  const selectSection = React.useCallback((path: string) => {
    setSelectedSectionPath(path)
    setExpandedSections((prev) => (prev.has(path) ? prev : new Set([...prev, path])))
    requestAnimationFrame(() => {
      setTimeout(() => {
        document.getElementById(`sec-${path}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      }, 60)
    })
  }, [])

  const toggleSection = React.useCallback((path: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const toggleLayer = React.useCallback((layer: LayerId) => {
    setActiveLayers((prev) => {
      const next = new Set(prev)
      if (next.has(layer)) next.delete(layer)
      else next.add(layer)
      return next
    })
  }, [])

  const setLayersPreset = React.useCallback((mode: 'all' | 'default') => {
    setActiveLayers(mode === 'all' ? new Set(LAYER_IDS) : new Set(DEFAULT_ACTIVE_LAYERS))
  }, [])

  const selectFragment = React.useCallback(
    (id: string) => {
      selectFragmentStore(id)
      if (!isDesktop) setCardDialogOpen(true)
    },
    [selectFragmentStore, isDesktop]
  )

  const runAnalysis = React.useCallback(async () => {
    await ensureLayerIndex(true)
    await refresh()
  }, [ensureLayerIndex, refresh])

  const downloadVersion = React.useCallback(async () => {
    const version = versionRef.current
    if (!version) return
    try {
      const content = await loadVersionContent(version.id)
      if (content == null) throw new Error('Не удалось загрузить содержимое версии')
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${version.label || 'version'}.md`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({ title: 'Текст версии скачан', description: `${version.label}.md` })
    } catch (e) {
      toast({
        title: 'Скачивание не удалось',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      })
    }
  }, [loadVersionContent, toast])

  const makeActive = React.useCallback(async () => {
    if (!selectedVersionId) return
    setMakeActiveBusy(true)
    try {
      await api.updateVersion(selectedVersionId, { isActive: true })
      await refresh()
      toast({ title: 'Версия сделана активной' })
    } catch (e) {
      toast({
        title: 'Не удалось сменить активную версию',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      })
    } finally {
      setMakeActiveBusy(false)
    }
  }, [selectedVersionId, refresh, toast])

  // ---- guards ----
  if (!appState?.project || !displayVersion) {
    return (
      <div className="py-8">
        <EmptyState
          title="Нет активного проекта или версии"
          hint="Создайте проект на обзорном экране или импортируйте архив в разделе «Экспорт и передача»."
        />
      </div>
    )
  }

  const layersAvailable = layerState.status === 'ok' && layerState.index !== null

  const ctx: AtlasContextValue = {
    structure,
    layerIndex: layerState.index,
    layersAvailable,
    coverageSet,
    linkedSections,
    activeLayers,
    zoom,
    query,
    selectedFragmentId,
    selectedSectionPath,
    expandedSections,
    projectId: appState.project.id,
    selectFragment,
    toggleSection,
    selectSection,
    toggleLayer,
    setLayersPreset,
    setZoom,
    setQuery,
    wordInspect,
    setWordInspect,
  }

  return (
    <AtlasContext.Provider value={ctx}>
      <div className="flex flex-col gap-4 py-2">
        <SectionHeader
          title={
            <span className="flex items-center gap-2">
              <BookOpen className="size-5 text-primary" aria-hidden />
              Instruction Atlas
            </span>
          }
          description="Полный текст инструкции с масштабированием документ → раздел → абзац → предложение → слово, переключаемыми слоями локального анализа и карточками фрагментов. Клик по предложению открывает карточку."
          badges={
            <>
              <Badge variant="outline" className="text-[10px]">
                версия «{displayVersion.label}»
              </Badge>
              <Badge variant="outline" className="font-mono text-[10px]">
                {fragments.length} фрагментов
              </Badge>
              {layersAvailable && <StatusBadge status="LOCAL" withHint={false} />}
            </>
          }
          actions={
            <>
              {codemapReturnCampaignId && <Button size="sm" variant="outline" onClick={() => setStudio('research')}>Вернуться к кампании</Button>}
              <Button size="sm" variant={codemapOpen ? 'default' : 'outline'} className="gap-1.5" onClick={() => setCodemapOpen((open) => !open)}>
                <ListTree className="size-3.5" aria-hidden />
                {codemapOpen ? 'Instruction Atlas' : 'Смысловая карта'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => void runAnalysis()}
                disabled={analysisBusy}
                title={
                  viewingActive
                    ? 'Пересчитать локальный структурный анализ активной версии'
                    : 'Анализ выполняется для активной версии — её текст показан в атласе'
                }
              >
                {analysisBusy ? (
                  <InlineSpinner label="Анализ…" />
                ) : (
                  <>
                    <RefreshCw className="size-3.5" aria-hidden />
                    Локальный анализ
                    {layersAvailable && layerState.index ? (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        · {layerState.index.durationMs} мс
                      </span>
                    ) : null}
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => void downloadVersion()}
                title="Скачать полный текст активной версии как Markdown-файл"
              >
                <FileDown className="size-3.5" aria-hidden />
                Скачать текст версии
              </Button>
            </>
          }
        />

        {codemapOpen ? (
          <SemanticCodemap
            projectId={appState.project.id}
            versionId={displayVersion.id}
            fragments={fragments}
            runs={appState.runs}
            notes={appState.notes}
            initialFragmentId={selectedFragmentId}
          />
        ) : <>

        {!viewingActive && selectedVersionId && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-lg border border-orange-500/40 bg-orange-500/10 p-3"
          >
            <StatusBadge status="STALE" />
            <div className="min-w-0 flex-1 text-xs leading-relaxed">
              <p className="font-medium text-orange-600 dark:text-orange-300">
                Вы просматриваете экспериментальную версию — результаты запусков относятся к активной
                версии.
              </p>
              <p className="text-muted-foreground">
                Атлас показывает текст активной версии «{displayVersion.label}»: фрагменты и слои
                выбранной версии не загружаются в атлас.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="outline" onClick={() => selectVersion(null)}>
                Вернуться к активной
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={makeActiveBusy}
                onClick={() => void makeActive()}
                title="Сделать выбранную версию активной для всего проекта"
              >
                {makeActiveBusy ? <InlineSpinner label="…" /> : 'Сделать активной'}
              </Button>
            </div>
          </div>
        )}

        {fragments.length === 0 ? (
          <div className="rounded-lg border bg-card/60 p-6">
            <EmptyState
              icon={FileText}
              title="В версии нет фрагментов"
              hint="Например, документ импортирован без анализа. Локальный анализ разберёт текст на разделы, абзацы и предложения — после этого атлас станет доступен."
              action={
                <Button className="gap-1.5" onClick={() => void runAnalysis()} disabled={analysisBusy}>
                  {analysisBusy ? (
                    <InlineSpinner label="Анализ…" />
                  ) : (
                    <>
                      <RefreshCw className="size-4" aria-hidden />
                      Выполнить локальный анализ
                    </>
                  )}
                </Button>
              }
            />
          </div>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(210px,250px)_minmax(0,1fr)] xl:grid-cols-[minmax(210px,250px)_minmax(0,1fr)_minmax(320px,400px)]">
            {/* left: outline */}
            <aside className="hidden lg:block">
              <div className="flex max-h-[calc(100vh-16rem)] w-full flex-col overflow-hidden rounded-lg border bg-card/60">
                <div className="flex items-center gap-2 border-b px-3 py-2">
                  <ListTree className="size-3.5 text-muted-foreground" aria-hidden />
                  <span className="text-xs font-medium text-muted-foreground">Оглавление документа</span>
                </div>
                <div className="scroll-observatory flex-1 overflow-y-auto p-1.5">
                  <OutlinePanel />
                </div>
              </div>
            </aside>

            {/* center: reading pane */}
            <ReadingPane
              layerStatus={layerState.status}
              layerError={layerState.error}
              analysisBusy={analysisBusy}
              onRunAnalysis={() => void runAnalysis()}
              onDownloadVersion={() => void downloadVersion()}
              onOpenOutline={() => setOutlineOpen(true)}
            />

            {/* right: fragment card */}
            <aside className="hidden xl:block">
              <div className="flex max-h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-lg border bg-card/60">
                {selectedFragmentId ? (
                  <div className="scroll-observatory flex-1 overflow-y-auto">
                    <AtlasFragmentCard fragmentId={selectedFragmentId} />
                  </div>
                ) : (
                  <EmptyState
                    className="m-4"
                    icon={FileText}
                    title="Карточка фрагмента"
                    hint="Кликните по разделу, абзацу или предложению в тексте — здесь появятся его слои с основаниями, интерпретации, заметки, сценарии, запуски, находки и связи графа."
                  />
                )}
              </div>
            </aside>
          </div>
        )}

        {/* mobile outline */}
        <Sheet open={outlineOpen} onOpenChange={setOutlineOpen}>
          <SheetContent side="left" className="w-80 p-0">
            <SheetTitle className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
              Оглавление документа
            </SheetTitle>
            <div className="scroll-observatory h-[calc(100vh-3rem)] overflow-y-auto p-1.5">
              <OutlinePanel onNavigate={() => setOutlineOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>

        {/* mobile / tablet fragment card */}
        <Dialog
          open={cardDialogOpen && !isDesktop && !!selectedFragmentId}
          onOpenChange={(o) => setCardDialogOpen(o)}
        >
          <DialogContent className="max-h-[88vh] overflow-hidden p-0 sm:max-w-2xl">
            <DialogHeader className="sr-only">
              <DialogTitle>Карточка фрагмента</DialogTitle>
            </DialogHeader>
            <div className="scroll-observatory max-h-[88vh] overflow-y-auto">
              {selectedFragmentId && <AtlasFragmentCard fragmentId={selectedFragmentId} />}
            </div>
          </DialogContent>
        </Dialog>
        </>}
      </div>
    </AtlasContext.Provider>
  )
}
