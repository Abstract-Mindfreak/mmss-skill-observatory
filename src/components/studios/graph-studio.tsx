// «Карта правил» — интерактивный граф взаимодействий правил скилла.
// Данные: GET /api/versions/{id}/graph (кэшируется в store). Отрисовка —
// собственный SVG с полосами-разделами (без внешних библиотек).
'use client'

import * as React from 'react'
import { Download, FileJson, FileText, Network, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SectionHeader } from '@/components/shared/misc'
import { StatusBadge } from '@/components/shared/status-badges'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { CopyButton } from '@/components/shared/copy'
import { useToast } from '@/hooks/use-toast'
import { useStore, activeVersion } from '@/lib/store'
import { api, graphExportUrl, downloadFile, ApiError } from '@/lib/api-client'
import type {
  FragmentDTO,
  GraphData,
  GraphEdge,
  GraphEdgeKind,
  GraphNode,
  GraphNodeKind,
} from '@/lib/types'
import { GRAPH_EDGE_KIND_TITLES, GRAPH_NODE_KIND_TITLES } from '@/lib/types'
import { computeLayout } from './graph/graph-layout'
import { GraphCanvas } from './graph/graph-canvas'
import { GraphFilters, type FilterCounts, type GraphFilterState } from './graph/graph-filters'
import { GraphStats } from './graph/graph-stats'
import { GraphNodePanel, type PanelSelection } from './graph/graph-node-panel'

const ALL_NODE_KINDS: GraphNodeKind[] = [
  'definition', 'requirement', 'constraint', 'condition', 'exception',
  'operation', 'contract', 'validation', 'completion',
]
const ALL_EDGE_KINDS: GraphEdgeKind[] = [
  'defines', 'uses', 'restricts', 'refines', 'excepts', 'depends-on',
  'repeats', 'conflicts', 'scenario-supported', 'disputed', 'missing-link',
]

export default function GraphStudio() {
  const appState = useStore((s) => s.appState)
  const version = useStore(activeVersion)
  const selectFragment = useStore((s) => s.selectFragment)
  const loadFragmentCard = useStore((s) => s.loadFragmentCard)
  const loadGraph = useStore((s) => s.loadGraph)
  const invalidateGraph = useStore((s) => s.invalidateGraph)
  const refresh = useStore((s) => s.refresh)
  const setStudio = useStore((s) => s.setStudio)
  const goToFragment = useStore((s) => s.goToFragment)
  const { toast } = useToast()

  const [phase, setPhase] = React.useState<'loading' | 'ready' | 'error' | 'no-analysis'>('loading')
  const [loadError, setLoadError] = React.useState('')
  const [graph, setGraph] = React.useState<GraphData | null>(null)
  const [analyzing, setAnalyzing] = React.useState(false)

  // filters
  const [nodeKinds, setNodeKinds] = React.useState<Set<GraphNodeKind>>(() => new Set(ALL_NODE_KINDS))
  const [edgeKinds, setEdgeKinds] = React.useState<Set<GraphEdgeKind>>(() => new Set(ALL_EDGE_KINDS))
  const [sections, setSections] = React.useState<Set<string>>(() => new Set())
  const [query, setQuery] = React.useState('')

  // selection
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = React.useState<string | null>(null)
  const [focus, setFocus] = React.useState<{ nodeId: string; nonce: number } | null>(null)

  // ---- data loading ----
  const versionId = version?.id ?? null
  React.useEffect(() => {
    if (!versionId) return
    let cancelled = false
    setPhase('loading')
    setLoadError('')
    setGraph(null)
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    ;(async () => {
      let data = await loadGraph(versionId)
      if (data === null) {
        // loadGraph swallows errors — ask directly once to tell 404 (нет анализа) from a network failure
        try {
          data = await api.versionGraph(versionId)
        } catch (e) {
          if (cancelled) return
          if (e instanceof ApiError && e.status === 404) {
            setPhase('no-analysis')
          } else {
            setLoadError(e instanceof Error ? e.message : 'Не удалось загрузить граф')
            setPhase('error')
          }
          return
        }
      }
      if (cancelled || !data) return
      setGraph(data)
      setSections(new Set(data.nodes.map((n) => n.sectionPath))) // unique sections
      setNodeKinds(new Set(ALL_NODE_KINDS))
      setEdgeKinds(new Set(ALL_EDGE_KINDS))
      setPhase('ready')
    })()
    return () => {
      cancelled = true
    }
  }, [versionId, loadGraph])

  const runAnalysis = React.useCallback(async () => {
    if (!versionId) return
    setAnalyzing(true)
    try {
      await api.analyzeVersion(versionId)
      invalidateGraph(versionId)
      await refresh()
      const data = await loadGraph(versionId, true)
      if (data) {
        setGraph(data)
        setSections(new Set(data.nodes.map((n) => n.sectionPath)))
        setPhase('ready')
        toast({ title: 'Локальный анализ выполнен', description: 'Граф перестроен из свежего анализа.' })
      } else {
        setPhase('error')
        setLoadError('Анализ выполнен, но граф не загрузился — повторите.')
      }
    } catch (e) {
      toast({
        title: 'Не удалось выполнить анализ',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setAnalyzing(false)
    }
  }, [versionId, invalidateGraph, loadGraph, refresh, toast])

  // ---- derived data ----
  const allNodes = React.useMemo(() => graph?.nodes ?? [], [graph])
  const allEdges = React.useMemo(() => graph?.edges ?? [], [graph])
  const nodeById = React.useMemo(() => new Map(allNodes.map((n) => [n.id, n])), [allNodes])
  /** edges whose endpoints are actual nodes — the backend also emits edges pointing at
   *  fragments without layers (not rendered as nodes); those are not drawable and we
   *  say so honestly instead of silently mixing counts. */
  const renderableEdges = React.useMemo(
    () => allEdges.filter((e) => nodeById.has(e.source) && nodeById.has(e.target)),
    [allEdges, nodeById]
  )
  const danglingCount = allEdges.length - renderableEdges.length
  const edgeById = React.useMemo(() => new Map(allEdges.map((e) => [e.id, e])), [allEdges])

  /** fragments of the active version, or synthesized from graph nodes when viewing another version */
  const fragments = React.useMemo(() => {
    const map = new Map<string, FragmentDTO>()
    for (const f of appState?.fragments ?? []) map.set(f.id, f)
    for (const n of allNodes) {
      if (!map.has(n.fragmentId)) {
        map.set(n.fragmentId, {
          id: n.fragmentId,
          versionId: graph?.versionId ?? '',
          kind: 'sentence',
          path: n.path,
          order: 0,
          title: null,
          text: n.label,
          startLine: 0,
          endLine: 0,
          meta: {},
        })
      }
    }
    return map
  }, [appState, allNodes, graph?.versionId])

  const layout = React.useMemo(() => computeLayout(allNodes), [allNodes])

  const visibleNodes = React.useMemo(
    () => allNodes.filter((n) => nodeKinds.has(n.kind) && sections.has(n.sectionPath)),
    [allNodes, nodeKinds, sections]
  )
  const visibleNodeIds = React.useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes])
  const visibleEdges = React.useMemo(
    () =>
      renderableEdges.filter(
        (e) => edgeKinds.has(e.kind) && visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)
      ),
    [renderableEdges, edgeKinds, visibleNodeIds]
  )
  const matchIds = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === '') return null
    const ids = new Set<string>()
    for (const n of visibleNodes) {
      const frag = fragments.get(n.fragmentId)
      const text = (frag ? frag.text : n.label).toLowerCase()
      if (
        text.includes(q) ||
        n.path.toLowerCase().includes(q) ||
        (n.sectionTitle ?? '').toLowerCase().includes(q)
      ) {
        ids.add(n.id)
      }
    }
    return ids
  }, [query, visibleNodes, fragments])
  const matches = React.useMemo(
    () => (matchIds ? visibleNodes.filter((n) => matchIds.has(n.id)) : []),
    [matchIds, visibleNodes]
  )

  const counts: FilterCounts = React.useMemo(() => {
    const nodeKind: Record<string, number> = {}
    for (const n of allNodes) nodeKind[n.kind] = (nodeKind[n.kind] ?? 0) + 1
    const edgeKind: Record<string, number> = {}
    for (const e of renderableEdges) edgeKind[e.kind] = (edgeKind[e.kind] ?? 0) + 1
    const sectionList = new Map<string, number>()
    const sectionTitle = new Map<string, string | null>()
    for (const n of allNodes) {
      sectionList.set(n.sectionPath, (sectionList.get(n.sectionPath) ?? 0) + 1)
      if (!sectionTitle.has(n.sectionPath)) sectionTitle.set(n.sectionPath, n.sectionTitle)
    }
    const order = new Set(layout.lanes.map((l) => l.sectionPath))
    const ordered = [
      ...order,
      ...[...sectionList.keys()].filter((p) => !order.has(p)),
    ]
    return {
      nodeKind,
      edgeKind,
      sections: ordered.map((path) => ({ path, title: sectionTitle.get(path) ?? null, count: sectionList.get(path) ?? 0 })),
    }
  }, [allNodes, renderableEdges, layout])

  // ---- selection handling ----
  const selectNode = React.useCallback(
    (id: string, opts?: { focus?: boolean }) => {
      const node = nodeById.get(id)
      if (!node) return
      setSelectedNodeId(id)
      setSelectedEdgeId(null)
      selectFragment(node.fragmentId)
      void loadFragmentCard(node.fragmentId)
      if (opts?.focus) setFocus({ nodeId: id, nonce: Date.now() })
    },
    [nodeById, selectFragment, loadFragmentCard]
  )
  const selectEdge = React.useCallback(
    (id: string) => {
      if (!edgeById.has(id)) return
      setSelectedEdgeId(id)
      setSelectedNodeId(null)
    },
    [edgeById]
  )

  const panelSelection: PanelSelection | null = React.useMemo(() => {
    if (selectedNodeId) {
      const node = nodeById.get(selectedNodeId)
      if (!node) return null
      const own = renderableEdges.filter((e) => e.source === node.id || e.target === node.id)
      return { type: 'node', node, edges: own }
    }
    if (selectedEdgeId) {
      const edge = edgeById.get(selectedEdgeId)
      const sourceNode = edge ? nodeById.get(edge.source) : undefined
      const targetNode = edge ? nodeById.get(edge.target) : undefined
      if (edge && sourceNode && targetNode) return { type: 'edge', edge, sourceNode, targetNode }
    }
    return null
  }, [selectedNodeId, selectedEdgeId, nodeById, edgeById, renderableEdges])

  // ---- export actions ----
  const projectId = appState?.project?.id
  const doExport = React.useCallback(
    async (format: 'json' | 'md' | 'txt') => {
      if (!projectId || !versionId) return
      try {
        await downloadFile(
          graphExportUrl(projectId, versionId, format),
          `skill-graph-${format}.${format}`
        )
        toast({ title: 'Экспорт графа скачан' })
      } catch (e) {
        toast({
          title: 'Экспорт недоступен',
          description: e instanceof Error ? e.message : '',
          variant: 'destructive',
        })
      }
    },
    [projectId, versionId, toast]
  )

  const listText = React.useCallback(() => {
    const lines: string[] = []
    lines.push(`# Карта правил — текущий вид (${visibleNodes.length} узлов, ${visibleEdges.length} связей)`)
    lines.push('')
    lines.push('## Узлы')
    for (const n of visibleNodes) {
      const frag = fragments.get(n.fragmentId)
      lines.push(`- [${n.path}] ${GRAPH_NODE_KIND_TITLES[n.kind]}: ${frag ? frag.text : n.label}`)
    }
    lines.push('')
    lines.push('## Связи')
    for (const e of visibleEdges) {
      const s = nodeById.get(e.source)
      const t = nodeById.get(e.target)
      const sim = e.basis.similarity !== undefined ? ` (сходство ${e.basis.similarity.toFixed(2)})` : ''
      lines.push(
        `- ${GRAPH_EDGE_KIND_TITLES[e.kind]}: ${s?.path ?? '?'} → ${t?.path ?? '?'} — ${e.basis.type}: ${e.basis.detail}${sim}`
      )
    }
    lines.push('')
    lines.push('_Терминологические связи — не логические зависимости; сходство — в конкретном представлении._')
    return lines.join('\n')
  }, [visibleNodes, visibleEdges, fragments, nodeById])

  // ---- render ----
  if (!appState?.project || !version) {
    return (
      <div className="py-8">
        <EmptyState
          title="Нет активного проекта"
          hint="Карта правил строится из локального анализа версии документа — создайте или откройте проект."
        />
      </div>
    )
  }

  return (
    <div className="space-y-4 py-2">
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            <Network className="size-5 text-primary" aria-hidden />
            Карта правил
          </span>
        }
        description={
          <>
            Граф взаимодействий правил версии «{version.label}» —{' '}
            <span className="font-mono text-xs">{allNodes.length}</span> узлов ·{' '}
            <span className="font-mono text-xs">{renderableEdges.length}</span> связей между узлами ·{' '}
            <span className="font-mono text-xs">{layout.lanes.length}</span> разделов-полос
            {danglingCount > 0 && (
              <> (ещё {danglingCount} связей в данных указывают на фрагменты без слоёв — на карте не отображаются)</>
            )}
            . Полосы — разделы документа в порядке чтения. Терминологические связи — не логические
            зависимости; сходство — в конкретном представлении.
          </>
        }
        badges={<StatusBadge status={graph?.provenance ?? 'LOCAL'} />}
        actions={
          phase === 'ready' && projectId ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <CopyButton text={listText} label="Список узлов/связей" size="sm" />
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                title="Упрощённое представление из сохранённого анализа; полный граф — здесь, на карте"
                onClick={() => void doExport('json')}
              >
                <FileJson className="size-3.5" aria-hidden />
                Экспорт JSON
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                title="Упрощённое представление из сохранённого анализа; полный граф — здесь, на карте"
                onClick={() => void doExport('md')}
              >
                <Download className="size-3.5" aria-hidden />
                Экспорт MD
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                title="Упрощённое представление из сохранённого анализа; полный граф — здесь, на карте"
                onClick={() => void doExport('txt')}
              >
                <FileText className="size-3.5" aria-hidden />
                Текстовое представление
              </Button>
            </div>
          ) : undefined
        }
      />

      {phase === 'loading' && (
        <Card>
          <CardContent className="p-2">
            <LoadingState label="Строим граф из локального анализа…" />
          </CardContent>
        </Card>
      )}

      {phase === 'error' && (
        <ErrorState
          error={loadError || 'Не удалось загрузить граф'}
          title="Граф не загрузился"
          onRetry={() => {
            if (versionId) invalidateGraph(versionId)
            setPhase('loading')
            // retrigger the load effect through a remount-free path
            setLoadError('')
            void loadGraph(versionId ?? '', true).then((d) => {
              if (d) {
                setGraph(d)
                setSections(new Set(d.nodes.map((n) => n.sectionPath)))
                setPhase('ready')
              } else {
                setPhase('error')
              }
            })
          }}
        />
      )}

      {phase === 'no-analysis' && (
        <EmptyState
          icon={Sparkles}
          title="Локальный анализ ещё не выполнялся"
          hint="Граф строится из локального структурного анализа версии. Выполните его — это локальное вычисление без моделей (секунды)."
          action={
            <Button size="sm" onClick={() => void runAnalysis()} disabled={analyzing}>
              {analyzing ? 'Анализ выполняется…' : 'Выполнить локальный анализ'}
            </Button>
          }
        />
      )}

      {phase === 'ready' && graph && (
        <>
          <div className="grid gap-4 xl:grid-cols-[290px_minmax(0,1fr)_330px]">
            <Card className="order-3 p-4 xl:order-1">
              <GraphFilters
                counts={counts}
                state={{ nodeKinds, edgeKinds, sections, query }}
                onReset={() => {
                  setNodeKinds(new Set(ALL_NODE_KINDS))
                  setEdgeKinds(new Set(ALL_EDGE_KINDS))
                  setSections(new Set(allNodes.map((n) => n.sectionPath)))
                  setQuery('')
                }}
                onToggleNodeKind={(k) =>
                  setNodeKinds((prev) => {
                    const next = new Set(prev)
                    if (next.has(k)) next.delete(k)
                    else next.add(k)
                    return next
                  })
                }
                onToggleEdgeKind={(k) =>
                  setEdgeKinds((prev) => {
                    const next = new Set(prev)
                    if (next.has(k)) next.delete(k)
                    else next.add(k)
                    return next
                  })
                }
                onToggleSection={(s) =>
                  setSections((prev) => {
                    const next = new Set(prev)
                    if (next.has(s)) next.delete(s)
                    else next.add(s)
                    return next
                  })
                }
                onSetAllSections={(all) =>
                  setSections(all ? new Set(counts.sections.map((s) => s.path)) : new Set())
                }
                onQuery={setQuery}
                matches={matches}
                fragments={fragments}
                onMatchClick={(id) => selectNode(id, { focus: true })}
                visibleNodeCount={visibleNodes.length}
                visibleEdgeCount={visibleEdges.length}
              />
            </Card>

            <Card className="order-1 overflow-hidden p-0 xl:order-2">
              <GraphCanvas
                layout={layout}
                nodes={visibleNodes}
                edges={visibleEdges}
                matchIds={matchIds}
                selectedNodeId={selectedNodeId}
                selectedEdgeId={selectedEdgeId}
                onSelectNode={(n) => selectNode(n.id)}
                onSelectEdge={(e) => selectEdge(e.id)}
                focus={focus}
                fragmentById={(id) => fragments.get(id) ?? null}
              />
            </Card>

            <Card className="order-2 overflow-hidden p-0 xl:order-3">
              <GraphNodePanel
                selection={panelSelection}
                nodes={nodeById}
                edges={edgeById}
                fragments={fragments}
                onSelectNode={(id) => selectNode(id, { focus: true })}
                onSelectEdge={selectEdge}
                onOpenInAtlas={(fragmentId) => goToFragment(fragmentId, 'atlas')}
                className="h-[480px] xl:h-[620px]"
              />
            </Card>
          </div>

          <GraphStats
            stats={graph.stats}
            nodes={nodeById}
            edges={edgeById}
            fragments={fragments}
            onSelectNode={(id) => selectNode(id, { focus: true })}
            onSelectEdge={selectEdge}
            onCreateScenario={() => setStudio('scenario')}
          />

          <p className="text-xs leading-relaxed text-muted-foreground">
            Экспорт JSON/MD/TXT берётся из упрощённой реконструкции сохранённого анализа (без kinds
            restricts/refines/excepts/depends-on) — полный граф с фильтрами доступен здесь, на карте.
            Копирование «Список узлов/связей» копирует текущий отфильтрованный вид.
          </p>
        </>
      )}
    </div>
  )
}
