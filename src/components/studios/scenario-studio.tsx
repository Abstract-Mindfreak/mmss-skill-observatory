// Scenario Tree — многомасштабное дерево ситуаций (ТЗ п.7).
// Фильтры/поиск/закреплённые, детали с PATCH, рост через Explorer,
// бюджет запусков (информационно) и честные пустые состояния.
'use client'

import * as React from 'react'
import { Info, ListTree, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState, ErrorState } from '@/components/shared/states'
import { SectionHeader } from '@/components/shared/misc'
import { useStore } from '@/lib/store'
import type { ScenarioDTO, ScenarioStatus } from '@/lib/types'
import {
  clampInt,
  DEFAULT_RESEARCH_PARAMS,
  PARAMS_STORAGE_KEY,
  type ResearchParams,
} from './scenario/export'
import { ResearchParamsPanel } from './scenario/params'
import { TreeControls, type OriginFilter } from './scenario/controls'
import { buildForest, collectIds, ScenarioTree, type ScenarioNode } from './scenario/tree'
import { ScenarioDetails } from './scenario/details'
import { ScenarioCreateForm } from './scenario/create-form'
import { SuggestDialog } from './scenario/suggest'

// ---------- tiny media hook (details panel vs dialog) ----------

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = React.useState(false)
  React.useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)')
    const onChange = () => setIsDesktop(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return isDesktop
}

// ---------- tree pruning helpers are inlined in the component memo ----------

export default function ScenarioStudio() {
  const appState = useStore((s) => s.appState)
  const loading = useStore((s) => s.loading)
  const loadError = useStore((s) => s.loadError)
  const refresh = useStore((s) => s.refresh)
  const setStudio = useStore((s) => s.setStudio)
  const selectedScenarioId = useStore((s) => s.selectedScenarioId)
  const selectScenario = useStore((s) => s.selectScenario)

  const [search, setSearch] = React.useState('')
  const [originFilter, setOriginFilter] = React.useState<OriginFilter>('all')
  const [statusFilter, setStatusFilter] = React.useState<Set<ScenarioStatus>>(
    () => new Set<ScenarioStatus>(['unexplored', 'explored', 'run-verified', 'synthetic', 'disputed', 'stopped'])
  )
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set())
  const [suggestOpen, setSuggestOpen] = React.useState(false)
  const [createRootOpen, setCreateRootOpen] = React.useState(false)
  const isDesktop = useIsDesktop()

  // ---------- research params (localStorage) ----------
  const [params, setParams] = React.useState<ResearchParams>(DEFAULT_RESEARCH_PARAMS)
  const paramsLoaded = React.useRef(false)
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PARAMS_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ResearchParams>
        setParams({
          scope: typeof parsed.scope === 'string' ? parsed.scope : DEFAULT_RESEARCH_PARAMS.scope,
          depth: clampInt(Number(parsed.depth), 1, 10, DEFAULT_RESEARCH_PARAMS.depth),
          maxNewBranches: clampInt(Number(parsed.maxNewBranches), 1, 5, DEFAULT_RESEARCH_PARAMS.maxNewBranches),
          runBudget: clampInt(Number(parsed.runBudget), 0, 100000, DEFAULT_RESEARCH_PARAMS.runBudget),
          stopCondition: typeof parsed.stopCondition === 'string' ? parsed.stopCondition : DEFAULT_RESEARCH_PARAMS.stopCondition,
        })
      }
    } catch {
      /* ignore broken storage */
    }
    paramsLoaded.current = true
  }, [])
  React.useEffect(() => {
    if (!paramsLoaded.current) return
    try {
      window.localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(params))
    } catch {
      /* ignore quota errors */
    }
  }, [params])

  const scenarios = appState?.scenarios ?? []
  const projectId = appState?.project?.id ?? null

  // default expansion: roots with children, once per project
  const lastProjectRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!projectId || lastProjectRef.current === projectId) return
    lastProjectRef.current = projectId
    const forest = buildForest(scenarios)
    setExpanded(new Set(forest.filter((n) => n.children.length > 0).map((n) => n.scenario.id)))
    setSearch('')
    setCreateRootOpen(false)
  }, [projectId, scenarios.length])

  // ---------- data / filtering ----------

  const statusCounts = React.useMemo(() => {
    const counts: Record<ScenarioStatus, number> = {
      unexplored: 0,
      explored: 0,
      synthetic: 0,
      'run-verified': 0,
      disputed: 0,
      stopped: 0,
    }
    for (const s of scenarios) {
      if (originFilter === 'demo' && s.origin !== 'demo') continue
      if (originFilter === 'real' && s.origin === 'demo') continue
      counts[s.status]++
    }
    return counts
  }, [scenarios, originFilter])

  const pruned = React.useMemo(() => {
    const forest = buildForest(scenarios)
    const q = search.trim().toLowerCase()
    const originOk = (s: ScenarioDTO) =>
      originFilter === 'all' ? true : originFilter === 'demo' ? s.origin === 'demo' : s.origin !== 'demo'
    const statusOk = (s: ScenarioDTO) => statusFilter.size > 0 && statusFilter.has(s.status)
    const match = (s: ScenarioDTO) => originOk(s) && statusOk(s) && (!q || s.title.toLowerCase().includes(q))

    const memo = new Map<string, boolean>()
    const visible = (n: ScenarioNode): boolean => {
      const hit = memo.get(n.scenario.id)
      if (hit !== undefined) return hit
      memo.set(n.scenario.id, false)
      const res = match(n.scenario) || n.children.some((c) => visible(c))
      memo.set(n.scenario.id, res)
      return res
    }
    const prune = (nodes: ScenarioNode[]): ScenarioNode[] => {
      const out: ScenarioNode[] = []
      for (const n of nodes) {
        const kids = prune(n.children)
        if (visible(n)) out.push({ scenario: n.scenario, children: kids })
      }
      return out
    }
    const prunedForest = prune(forest)

    // pull pinned nodes (with their visible subtrees) out of the main tree
    const pullPinned = (nodes: ScenarioNode[]): { pinned: ScenarioNode[]; rest: ScenarioNode[] } => {
      const pinned: ScenarioNode[] = []
      const rest: ScenarioNode[] = []
      for (const n of nodes) {
        const inner = pullPinned(n.children)
        n.children = inner.rest
        if (n.scenario.pinned) pinned.push(n)
        else rest.push(n)
      }
      return { pinned, rest }
    }
    const { pinned, rest } = pullPinned(prunedForest)
    return { pinnedForest: pinned, mainForest: rest, fullForest: forest }
  }, [scenarios, search, originFilter, statusFilter])

  const shownCount =
    pruned.pinnedForest.reduce((acc, n) => acc + countTree(n), 0) +
    pruned.mainForest.reduce((acc, n) => acc + countTree(n), 0)

  const searchActive = search.trim().length > 0
  const effectiveExpanded = React.useMemo(() => {
    if (!searchActive) return expanded
    return new Set(collectIds(pruned.mainForest).concat(collectIds(pruned.pinnedForest)))
  }, [searchActive, expanded, pruned])

  const totalRealRuns = appState?.runs.filter((r) => r.origin === 'real').length ?? 0
  const budgetExhausted = params.runBudget > 0 && totalRealRuns >= params.runBudget

  const selected = scenarios.find((s) => s.id === selectedScenarioId) ?? null

  // ---------- callbacks ----------

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleStatus = (st: ScenarioStatus) =>
    setStatusFilter((prev) => {
      const next = new Set(prev)
      if (next.has(st)) next.delete(st)
      else next.add(st)
      return next
    })

  const expandAll = () => setExpanded(new Set(collectIds(pruned.fullForest)))
  const collapseAll = () => setExpanded(new Set())

  // ---------- render ----------

  if (loadError && !appState) {
    return <ErrorState error={loadError} title="Не удалось загрузить данные проекта" onRetry={() => void refresh()} />
  }
  if (!appState?.project) {
    return (
      <EmptyState
        title="Нет активного проекта"
        hint="Создайте проект или импортируйте архив — дерево появится вместе с проектом."
      />
    )
  }

  const groups: { label: string; forest: ScenarioNode[]; note?: string }[] = []
  if (pruned.pinnedForest.length > 0) {
    groups.push({
      label: 'Закреплённые',
      forest: pruned.pinnedForest,
      note: 'Закреплённые ветви всегда сверху; их поддеревья показываются здесь.',
    })
  }
  groups.push({ label: searchActive ? 'Результаты поиска' : 'Дерево', forest: pruned.mainForest })

  const detailsPanel = selected ? (
    <ScenarioDetails
      scenario={selected}
      params={params}
      totalRealRuns={totalRealRuns}
      onLaunch={(s) => {
        selectScenario(s.id)
        setStudio('lab')
      }}
      onSuggest={() => setSuggestOpen(true)}
      onDeleted={() => selectScenario(null)}
      onClose={isDesktop ? undefined : () => selectScenario(null)}
    />
  ) : (
    <EmptyState
      title="Ветвь не выбрана"
      hint="Нажмите на строку в дереве, чтобы увидеть описание, статус, привязку к тексту и запуски."
    />
  )

  return (
    <div className="space-y-4 py-2">
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            <ListTree className="size-5 text-primary" aria-hidden />
            Scenario Tree
          </span>
        }
        description="Многомасштабное дерево ситуаций: темы → механизмы → проверки. Ветви создаются вами и Explorer; каждая помечена происхождением и статусом исследования."
        badges={
          <>
            <Badge variant="secondary" className="text-[10px]">
              {scenarios.filter((s) => s.origin !== 'demo').length} ветвей (реальные)
            </Badge>
            {scenarios.some((s) => s.origin === 'demo') && (
              <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-300">
                + DEMO
              </Badge>
            )}
          </>
        }
      />

      {/* honest banner */}
      <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed">
        <Info className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
        <p>
          Дерево <strong>не перебирает все возможные ситуации</strong> — оно растёт от ваших решений и предложений
          Explorer. Синтетические и проверенные ветви различаются: статус «проверена запуском» ставится только
          вручную после оценки.
        </p>
      </div>

      {budgetExhausted && (
        <div
          role="status"
          className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
          <p>
            <strong>Бюджет запусков исчерпан: выполнено {totalRealRuns} из {params.runBudget}.</strong>{' '}
            Учтены реальные запуски из списка последних 200. Предупреждение информационное — работа не
            блокируется; скорректируйте бюджет в «Параметрах исследования», если это не планировалось.
          </p>
        </div>
      )}

      <ResearchParamsPanel params={params} onChange={setParams} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
        <div className="min-w-0 space-y-3">
          <TreeControls
            search={search}
            onSearch={setSearch}
            statusFilter={statusFilter}
            onToggleStatus={toggleStatus}
            statusCounts={statusCounts}
            originFilter={originFilter}
            onOriginFilter={setOriginFilter}
            onExpandAll={expandAll}
            onCollapseAll={collapseAll}
            onNewRoot={() => setCreateRootOpen((v) => !v)}
            shownCount={shownCount}
            totalCount={scenarios.length}
          />

          {createRootOpen && (
            <ScenarioCreateForm parentId={null} onCancel={() => setCreateRootOpen(false)} onCreated={() => setCreateRootOpen(false)} autoFocus />
          )}

          <Card className="border-border/70">
            <CardContent className="p-3">
              {loading && scenarios.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Загрузка дерева…</p>
              ) : scenarios.length === 0 ? (
                <EmptyState
                  title="Дерево пусто"
                  hint="Создайте первую корневую ветвь — тему ситуации из инструкции. Дети ветви добавляются кнопкой «Добавить ветвь» в деталях."
                  action={
                    <Button size="sm" onClick={() => setCreateRootOpen(true)}>
                      Создать корневую ветвь
                    </Button>
                  }
                />
              ) : shownCount === 0 ? (
                <EmptyState
                  title="Ничего не найдено"
                  hint="Измените фильтры статусов, происхождение или поисковый запрос."
                  action={
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSearch('')
                        setOriginFilter('all')
                        setStatusFilter(
                          new Set<ScenarioStatus>(['unexplored', 'explored', 'run-verified', 'synthetic', 'disputed', 'stopped'])
                        )
                      }}
                    >
                      Сбросить фильтры
                    </Button>
                  }
                />
              ) : (
                <div className="max-h-[70vh] overflow-y-auto scroll-observatory pr-1">
                  <ScenarioTree
                    groups={groups}
                    expandedSet={effectiveExpanded}
                    onToggle={toggleExpand}
                    selectedId={selectedScenarioId}
                    onSelect={(id) => selectScenario(id)}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {isDesktop && <div className="min-w-0">{detailsPanel}</div>}
      </div>

      {/* mobile dialog */}
      {!isDesktop && selected && (
        <Dialog open onOpenChange={(o) => !o && selectScenario(null)}>
          <DialogContent className="max-h-[88vh] overflow-y-auto scroll-observatory sm:max-w-lg">
            <DialogHeader className="sr-only">
              <DialogTitle>Детали ветви</DialogTitle>
            </DialogHeader>
            {detailsPanel}
          </DialogContent>
        </Dialog>
      )}

      {selected && (
        <SuggestDialog
          open={suggestOpen}
          onOpenChange={setSuggestOpen}
          scenario={selected}
          params={params}
          onCreated={(parentId) =>
            setExpanded((prev) => new Set([...prev, parentId]))
          }
        />
      )}
    </div>
  )
}

function countTree(n: ScenarioNode): number {
  return 1 + n.children.reduce((acc, c) => acc + countTree(c), 0)
}
