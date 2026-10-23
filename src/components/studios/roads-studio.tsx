// «Failure Roads» — карта дороги выполнения задачи с развилками и ямами.
// Статическая часть — аналитическая реконструкция по разделам скилла (LOCAL);
// наложения — только реальные запуски (origin='real'). Внутренний маршрут
// модели не наблюдается — это честно написано у каждого наложения.
'use client'

import * as React from 'react'
import { Download, Eye, Route as RouteIcon, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SectionHeader, FragmentRef } from '@/components/shared/misc'
import { StatusBadge, OriginBadge } from '@/components/shared/status-badges'
import { EmptyState } from '@/components/shared/states'
import { CopyButton } from '@/components/shared/copy'
import { useStore } from '@/lib/store'
import type { FragmentDTO, RunDTO } from '@/lib/types'
import { ROLE_TITLES } from '@/lib/types'
import {
  FORKS,
  STAGES,
  UNMAPPED_SECTIONS,
  collectObservations,
  sectionFragmentOf,
  type ForkDef,
} from './roads/roads-map'
import { PITS, type Pit } from './roads/roads-pits'
import { ForkCard, PitCard, RoadConnector, StageCard, roadsToMarkdown } from './roads/roads-stage-card'
import { cn } from '@/lib/utils'

const LEGEND = [
  { label: 'стадия', className: 'border-primary/50 bg-primary/10 text-primary' },
  { label: 'развилка', className: 'border-fuchsia-500/50 bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300' },
  { label: 'яма', className: 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-300' },
  { label: 'наблюдение', className: 'border-teal-500/50 bg-teal-500/10 text-teal-700 dark:text-teal-300' },
]

export default function RoadsStudio() {
  const appState = useStore((s) => s.appState)
  const setStudio = useStore((s) => s.setStudio)
  const goToFragment = useStore((s) => s.goToFragment)

  const [openPitId, setOpenPitId] = React.useState<string | null>(null)
  const pitRefs = React.useRef(new Map<string, HTMLDivElement>())

  // ---- resolution helpers ----
  const fragments = React.useMemo(() => appState?.fragments ?? [], [appState])
  const sectionFragments = React.useMemo(
    () => fragments.filter((f) => f.kind === 'section'),
    [fragments]
  )
  const sectionsByPath = React.useMemo(() => {
    const m = new Map<string, FragmentDTO>()
    for (const s of sectionFragments) if (!m.has(s.path)) m.set(s.path, s)
    return m
  }, [sectionFragments])
  const resolveSection = React.useCallback(
    (path: string) => sectionsByPath.get(path) ?? null,
    [sectionsByPath]
  )

  // section of a scenario's anchor fragment (used for overlays and pit-related runs)
  const scenarioSection = React.useMemo(() => {
    const fragmentById = new Map(fragments.map((f) => [f.id, f]))
    const m = new Map<string, string>() // scenarioId → section path
    for (const sc of appState?.scenarios ?? []) {
      if (!sc.fragmentId) continue
      const section = sectionFragmentOf(fragmentById.get(sc.fragmentId), sectionFragments)
      if (section) m.set(sc.id, section.path)
    }
    return m
  }, [fragments, sectionFragments, appState])

  const runs = React.useMemo(() => appState?.runs ?? [], [appState])
  const runById = React.useMemo(() => new Map(runs.map((r) => [r.id, r])), [runs])
  const realRunsWithScenario = React.useMemo(
    () => runs.filter((r) => r.origin === 'real' && r.scenarioId),
    [runs]
  )
  const demoRunCount = React.useMemo(
    () => runs.filter((r) => r.origin === 'demo').length,
    [runs]
  )

  // observations per stage (for the stage markers)
  const observations = React.useMemo(
    () => collectObservations(runs, appState?.scenarios ?? [], fragments),
    [runs, appState, fragments]
  )
  const observedRunsByStage = React.useMemo(() => {
    const m = new Map<number, RunDTO[]>()
    for (const list of observations.byStage.values()) {
      const stage = list[0]?.stage
      if (stage == null) continue
      const runList = list.map((o) => runById.get(o.runId)).filter((r): r is RunDTO => !!r)
      m.set(stage, runList)
    }
    return m
  }, [observations, runById])

  // runs related to each pit (by section of the pit's refs)
  const pitSections = React.useCallback(
    (pit: Pit) => [pit.ruleRef, ...(pit.extraRefs ?? [])].map((r) => r.sectionPath),
    []
  )
  const relatedRunsByPit = React.useMemo(() => {
    const m = new Map<string, RunDTO[]>()
    for (const pit of PITS) {
      const wanted = new Set(pitSections(pit))
      const related = realRunsWithScenario.filter((r) => {
        if (!r.scenarioId) return false
        const section = scenarioSection.get(r.scenarioId)
        return section !== undefined && wanted.has(section)
      })
      m.set(pit.id, related)
    }
    return m
  }, [pitSections, realRunsWithScenario, scenarioSection])

  // ---- interactions ----
  const followPit = React.useCallback((pitId: string) => {
    setOpenPitId(pitId)
    window.setTimeout(() => {
      pitRefs.current.get(pitId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 60)
  }, [])

  const downloadMd = React.useCallback(() => {
    const blob = new Blob([roadsToMarkdown(STAGES, FORKS, PITS)], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'failure-roads.md'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }, [])

  const forkByAfterStage = React.useMemo(() => {
    const m = new Map<number, ForkDef>()
    for (const f of FORKS) m.set(f.afterStage, f)
    return m
  }, [])
  const pitsByStage = React.useMemo(() => {
    const m = new Map<number, Pit[]>()
    for (const p of PITS) {
      const list = m.get(p.stage)
      if (list) list.push(p)
      else m.set(p.stage, [p])
    }
    return m
  }, [])

  if (!appState?.project || !appState?.activeVersion) {
    return (
      <div className="py-8">
        <EmptyState
          title="Нет активного проекта"
          hint="Дорога решений строится по разделам скилла — откройте проект с документом."
        />
      </div>
    )
  }

  const totalObserved = observations.byStage.size > 0
    ? [...observations.byStage.values()].reduce((a, l) => a + l.length, 0)
    : 0
  const unmappedObserved = observations.unmapped.length

  return (
    <div className="space-y-4 py-2">
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            <RouteIcon className="size-5 text-primary" aria-hidden />
            Failure Roads
          </span>
        }
        description={
          <>
            Дорога выполнения задачи по разделам скилла: 7 стадий, развилки, каталог «ям».
            Аналитическая реконструкция по разделам скилла; наблюдаемые наложения — из реальных запусков.
          </>
        }
        badges={
          <>
            <StatusBadge status="LOCAL" />
            {appState.activeVersion.label && (
              <Badge variant="outline" className="text-[10px]">
                версия «{appState.activeVersion.label}»
              </Badge>
            )}
          </>
        }
        actions={
          <div className="flex flex-wrap gap-1.5">
            <CopyButton text={() => roadsToMarkdown(STAGES, FORKS, PITS)} label="Экспорт карты (копировать)" size="sm" />
            <Button size="sm" variant="outline" className="gap-1.5" onClick={downloadMd}>
              <Download className="size-3.5" aria-hidden />
              Скачать .md
            </Button>
          </div>
        }
      />

      {/* legend + honesty strip */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Легенда:</span>
        {LEGEND.map((l) => (
          <span key={l.label} className={cn('rounded-full border px-2 py-0.5 text-[11px]', l.className)}>
            {l.label}
          </span>
        ))}
        <span className="ml-auto flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <Eye className="size-3.5" aria-hidden />
          {totalObserved + unmappedObserved === 0 ? (
            <span>
              наблюдений нет — наложения появятся после реальных запусков (Behavior Lab)
            </span>
          ) : (
            <span>
              наблюдаемых запусков (real):{' '}
              <span className="font-mono text-foreground/80">{totalObserved}</span> на стадиях
              {unmappedObserved > 0 && (
                <>
                  {' · '}
                  <span className="font-mono text-foreground/80">{unmappedObserved}</span> вне стадий
                </>
              )}
            </span>
          )}
          {demoRunCount > 0 && (
            <span className="inline-flex items-center gap-1">
              +{demoRunCount} <OriginBadge origin="demo" /> не показаны
            </span>
          )}
        </span>
      </div>

      {/* the road */}
      <div className="scroll-observatory flex flex-col gap-3 overflow-x-auto pb-2 pt-1 md:flex-row md:items-stretch md:gap-0">
        {STAGES.map((stage, i) => {
          const fork = forkByAfterStage.get(stage.id)
          const stagePits = pitsByStage.get(stage.id) ?? []
          const obsRuns = observedRunsByStage.get(stage.id) ?? []
          return (
            <React.Fragment key={stage.id}>
              <StageCard
                stage={stage}
                refs={stage.refs.map((r) => (
                  <FragmentRef key={r.path} fragment={resolveSection(r.path)} showText={false} />
                ))}
                observationCount={obsRuns.length}
                observedRuns={obsRuns}
                pitCount={stagePits.length}
              >
                {stagePits.length > 0 && (
                  <div className="mt-1 space-y-2 border-l-2 border-amber-500/40 pl-3.5">
                    {stagePits.map((pit) => (
                      <PitCard
                        key={pit.id}
                        pit={pit}
                        open={openPitId === pit.id}
                        onToggle={() => setOpenPitId(openPitId === pit.id ? null : pit.id)}
                        resolveSection={resolveSection}
                        relatedRuns={relatedRunsByPit.get(pit.id) ?? []}
                        onVerify={() => setStudio('scenario')}
                        onOpenFragment={(fragmentId) => goToFragment(fragmentId, 'atlas')}
                        pitRef={(el) => {
                          if (el) pitRefs.current.set(pit.id, el)
                          else pitRefs.current.delete(pit.id)
                        }}
                      />
                    ))}
                  </div>
                )}
              </StageCard>

              {i < STAGES.length - 1 &&
                (fork ? (
                  <>
                    <RoadConnector withFork />
                    <ForkCard fork={fork} onFollowPit={followPit} />
                  </>
                ) : (
                  <RoadConnector />
                ))}
            </React.Fragment>
          )
        })}
      </div>

      {/* observations without stage binding */}
      {observations.unmapped.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="size-4 text-primary" aria-hidden />
              Наблюдения вне привязки к стадиям
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Эти запуски привязаны к разделам, которые моя реконструкция дороги не относит ни к одной стадии
              (разделы: {UNMAPPED_SECTIONS.map((s) => `§${s}`).join(', ')}). Показываю их честно без стадии.
            </p>
            <ul className="space-y-0.5 text-xs">
              {observations.unmapped.map((o) => (
                <li key={o.runId} className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground">§{o.sectionPath}</span>
                  <span className="text-foreground/85">{o.scenarioTitle}</span>
                  <span className="text-muted-foreground">
                    — {ROLE_TITLES[o.runRole as keyof typeof ROLE_TITLES] ?? o.runRole} · {o.runStatus}
                    {o.runVerdict ? ` · ${o.runVerdict}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* method & limitations */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Метод и ограничения</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            Каталог ям составлен вручную по тексту скилла (происхождение — редакторское решение), привязки к
            разделам — автоматические. Это не исчерпывающий перечень.
          </p>
          <p>
            Привязка раздела к стадии — редакторское допущение; развилки — реконструкция по §6.2 и §11.3.
            Предполагаемый маршрут ≠ фактический: наблюдаемое наложение привязано к разделу сценария, внутренний
            маршрут модели не наблюдается.
          </p>
          <p>
            Все ямы — «потенциальные отказы (гипотезы)», пока нет связанных запусков; наличие запусков не
            доказывает внутренний путь модели. DEMO-запуски на дорогу не выводятся.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
