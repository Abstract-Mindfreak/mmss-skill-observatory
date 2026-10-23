// Отчёт о последствиях правки (ImpactResult): буквальные изменения, слои, термины,
// связанные фрагменты, сценарии для повтора, устаревающие результаты и стоимость
// пересчёта A/B/C/D с честным разделением «вычислено / оценка / план».
'use client'

import * as React from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  ChevronDown,
  FlaskConical,
  Info,
  ListChecks,
  Play,
  Search,
  Sigma,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { StatusBadge } from '@/components/shared/status-badges'
import { KV } from '@/components/shared/misc'
import { useStore } from '@/lib/store'
import { LAYER_TITLES, type ImpactResult } from '@/lib/types'
import { cn } from '@/lib/utils'
import { FragmentRefById } from './refs'

const STALE_KIND_META: Record<
  ImpactResult['staleResults'][number]['kind'],
  { icon: React.ComponentType<{ className?: string }>; label: string }
> = {
  analysis: { icon: FlaskConical, label: 'Анализ' },
  interpretation: { icon: Bot, label: 'Интерпретация' },
  run: { icon: Play, label: 'Запуск' },
  finding: { icon: Search, label: 'Находка' },
}

const COST_KIND_META: Record<
  'A' | 'B' | 'C' | 'D',
  { title: string; mode: string; modeClass: string }
> = {
  A: { title: 'A · Локальный пересчёт', mode: 'LOCAL — вычислено', modeClass: 'border-teal-500/50 bg-teal-500/10 text-teal-600 dark:text-teal-300' },
  B: { title: 'B · Анализ моделью', mode: 'Оценка — запрос к модели', modeClass: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300' },
  C: { title: 'C · Повторные запуски', mode: 'План — запуски', modeClass: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300' },
  D: { title: 'D · Сравнение результатов', mode: 'План — локальная операция', modeClass: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300' },
}

export function ImpactReport({
  impact,
  baseLabel,
  savedAs,
  actions,
}: {
  impact: ImpactResult
  baseLabel: string
  /** Метка ветки, если предпросмотр уже сохранён. */
  savedAs?: string | null
  /** Кнопки редактирования/сохранения черновика (рендерятся в шапке отчёта). */
  actions?: React.ReactNode
}) {
  const setStudio = useStore((s) => s.setStudio)
  const selectScenario = useStore((s) => s.selectScenario)
  const goToFragment = useStore((s) => s.goToFragment)
  const fragments = useStore((s) => s.appState?.fragments ?? [])

  const realChanged = impact.literalChanges.changedFragmentIds.filter((id) => !id.startsWith('new:'))
  const syntheticChanged = impact.literalChanges.changedFragmentIds.filter((id) => id.startsWith('new:'))
  const unsaved = impact.newVersionId === 'unsaved'

  const costByKind = React.useMemo(() => {
    const map = new Map(impact.costEstimate.map((c) => [c.kind, c]))
    return map
  }, [impact.costEstimate])

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <Sigma className="size-4 text-primary" aria-hidden />
          Анализ последствий правки
          <StatusBadge status="LOCAL" />
          {unsaved ? (
            <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-300">
              предпросмотр — правка не сохранена
            </Badge>
          ) : savedAs ? (
            <Badge variant="outline" className="border-emerald-500/50 bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400">
              сохранена в ветку «{savedAs}»
            </Badge>
          ) : null}
          <span className="font-mono text-[11px] font-normal text-muted-foreground">база: {baseLabel}</span>
          <span className="ml-auto flex items-center gap-1.5">{actions}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* --- Буквальное изменение --- */}
        <section className="space-y-2" aria-label="Буквальное изменение">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Буквальное изменение
          </h3>
          <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
            <span className="font-mono text-sm">
              <span className="text-emerald-600 dark:text-emerald-400">+{impact.literalChanges.addedLines}</span>{' '}
              <span className="text-rose-600 dark:text-rose-400">−{impact.literalChanges.removedLines}</span>{' '}
              <span className="text-xs text-muted-foreground">строк</span>
            </span>
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">изменённые разделы:</span>
              {impact.literalChanges.changedSections.length === 0 ? (
                <span className="text-xs">—</span>
              ) : (
                impact.literalChanges.changedSections.map((p) => {
                  const section = fragments.find((f) => f.kind === 'section' && f.path === p)
                  return section ? (
                    <FragmentRefById key={p} fragmentId={section.id} text={`раздел ${p}`} />
                  ) : (
                    <Badge key={p} variant="outline" className="font-mono text-[10px]">
                      §{p}
                    </Badge>
                  )
                })
              )}
            </span>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              Изменённые фрагменты:{' '}
              {realChanged.length === 0 && syntheticChanged.length === 0 ? '—' : `${realChanged.length + syntheticChanged.length}`}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {realChanged.map((id) => (
                <FragmentRefById key={id} fragmentId={id} />
              ))}
              {syntheticChanged.map((id) => (
                <Badge key={id} variant="outline" className="border-dashed font-mono text-[10px] text-muted-foreground">
                  {id}
                </Badge>
              ))}
            </div>
            {syntheticChanged.length > 0 && (
              <p className="text-[11px] leading-snug text-muted-foreground">
                Идентификаторы вида <span className="font-mono">new:N</span> — синтетические: фрагменты существуют
                только в предпросмотре и ещё не сохранены. После сохранения ветки они получат постоянные id.
              </p>
            )}
          </div>
        </section>

        {/* --- Изменения по слоям --- */}
        <section className="space-y-2" aria-label="Изменения по слоям">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Изменившиеся постановки (слои)
          </h3>
          {impact.layerChanges.length === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              Изменений по слоям нет — число обязательств, запретов и других постановок не меняется.
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">Слой</th>
                    <th className="px-3 py-1.5 text-right font-medium">Было → станет</th>
                    <th className="px-3 py-1.5 text-right font-medium">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {impact.layerChanges.map((lc) => (
                    <tr key={lc.layer} className="border-t">
                      <td className="px-3 py-1.5">{LAYER_TITLES[lc.layer] ?? lc.layer}</td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {lc.baseCount} → <span className="font-semibold">{lc.newCount}</span>
                      </td>
                      <td
                        className={cn(
                          'px-3 py-1.5 text-right font-mono font-semibold',
                          lc.delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                        )}
                      >
                        {lc.delta > 0 ? `+${lc.delta}` : lc.delta}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Показаны только слои с ненулевой дельтой — слои без изменений в таблицу не входят.
          </p>
        </section>

        {/* --- Затронутые термины --- */}
        <section className="space-y-1.5" aria-label="Затронутые термины">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Затронутые термины</h3>
          {impact.affectedTerms.length === 0 ? (
            <p className="text-xs text-muted-foreground">Определения и термины в изменённых фрагментах не затронуты.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {impact.affectedTerms.map((t) => (
                <Badge key={t} variant="secondary" className="font-mono text-[10px]">
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </section>

        {/* --- Связанные фрагменты --- */}
        <section className="space-y-1.5" aria-label="Связанные фрагменты">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Связанные фрагменты</h3>
          {impact.relatedFragments.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Соседние по графу фрагменты не затронуты (правка не задевает связанные маршруты).
            </p>
          ) : (
            <ul className="space-y-1">
              {impact.relatedFragments.map((r) => (
                <li key={r.fragmentId} className="flex flex-wrap items-center gap-2">
                  <FragmentRefById fragmentId={r.fragmentId} />
                  <span className="text-[11px] text-muted-foreground">{r.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* --- Сценарии для повтора --- */}
        <section className="space-y-1.5" aria-label="Сценарии для повтора">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Сценарии для повтора
          </h3>
          {impact.scenariosToRerun.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Сценариев, привязанных к изменённым или соседним фрагментам, нет — повторные запуски не требуются.
            </p>
          ) : (
            <ul className="space-y-1">
              {impact.scenariosToRerun.map((s) => (
                <li key={s.scenarioId} className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 px-2 text-[11px]"
                    onClick={() => {
                      selectScenario(s.scenarioId)
                      setStudio('scenario')
                    }}
                    title={s.reason}
                  >
                    <ListChecks className="size-3.5" aria-hidden />
                    {s.title}
                    <ArrowRight className="size-3" aria-hidden />
                  </Button>
                  <span className="text-[11px] text-muted-foreground">{s.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* --- Устаревающие результаты --- */}
        <section className="space-y-1.5" aria-label="Результаты, которые станут устаревшими">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Результаты, которые станут устаревшими
          </h3>
          {impact.staleResults.length === 0 ? (
            <p className="text-xs text-muted-foreground">К этой версии не привязано результатов — устаревать нечему.</p>
          ) : (
            <ul className="space-y-1.5">
              {impact.staleResults.map((r) => {
                const meta = STALE_KIND_META[r.kind]
                const Icon = meta.icon
                return (
                  <li
                    key={`${r.kind}-${r.id}`}
                    className="flex flex-wrap items-start gap-2 rounded-md border border-orange-500/25 bg-orange-500/5 px-3 py-2"
                  >
                    <Icon className="mt-0.5 size-3.5 shrink-0 text-orange-500" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-xs font-medium">
                        {meta.label}: {r.label}
                        <StatusBadge status="STALE" />
                      </p>
                      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{r.reason}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => {
                        if (r.kind === 'run') {
                          useStore.getState().selectRun(r.id)
                          setStudio('lab')
                        } else if (r.kind === 'finding') {
                          setStudio('lab')
                        } else {
                          // анализ/интерпретация — ближайшая точка: атлас с фрагментами
                          const first = realChanged[0]
                          if (first) goToFragment(first)
                        }
                      }}
                    >
                      Открыть
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground">
            Устаревание фиксируется при сохранении ветки; привязка запусков к версии сохраняется.
          </p>
        </section>

        {/* --- Стоимость A/B/C/D --- */}
        <section className="space-y-2" aria-label="Стоимость пересчёта">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Стоимость пересчёта после правки
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['A', 'B', 'C', 'D'] as const).map((kind) => {
              const cost = costByKind.get(kind)
              if (!cost) return null
              const meta = COST_KIND_META[kind]
              return (
                <div key={kind} className="space-y-1.5 rounded-md border p-3">
                  <p className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                    {meta.title}
                    <Badge variant="outline" className={cn('text-[9px]', meta.modeClass)}>
                      {meta.mode}
                    </Badge>
                  </p>
                  <p className="text-[11px] leading-snug text-muted-foreground">{cost.description}</p>
                  <div className="space-y-0.5">
                    <KV k="Запросов к модели" v={<span className="font-mono">{cost.estimatedRequests}</span>} />
                    <KV
                      k="Время"
                      v={
                        cost.estimatedSeconds === null ? (
                          <span className="text-muted-foreground">зависит от модели</span>
                        ) : (
                          <span className="font-mono">~{cost.estimatedSeconds} с</span>
                        )
                      }
                    />
                    <KV
                      k="Доступность"
                      v={
                        cost.available ? (
                          <span className="text-emerald-600 dark:text-emerald-400">доступно</span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-300">
                            недоступно — назначьте модель в разделе «Подключения»
                          </span>
                        )
                      }
                    />
                  </div>
                  {kind === 'B' && (
                    <Button size="sm" variant="outline" className="h-7 w-full gap-1 text-[11px]" onClick={() => setStudio('atlas')}>
                      Перейти к атласу для интерпретации
                      <ArrowRight className="size-3" aria-hidden />
                    </Button>
                  )}
                  {kind === 'C' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-full gap-1 text-[11px]"
                      onClick={() => setStudio('lab')}
                      disabled={impact.scenariosToRerun.length === 0}
                      title={
                        impact.scenariosToRerun.length === 0
                          ? 'Повторные запуски не требуются — сценариев для повтора нет'
                          : undefined
                      }
                    >
                      Перейти к Behavior Lab для повторных запусков
                      <ArrowRight className="size-3" aria-hidden />
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
          <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] leading-relaxed">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden />
            Прогноз влияния правки на поведение — <strong>предположение, а не измеренный эффект</strong>: измеренные
            данные появятся только после реальных повторных запусков (C) и сравнения результатов (D).
          </p>
        </section>

        {/* --- Ограничения --- */}
        <Collapsible>
          <CollapsibleTrigger className="group flex w-full items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground">
            <Info className="size-3.5" aria-hidden />
            Ограничения анализа ({impact.limitations.length})
            <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-1.5 space-y-1 rounded-md border p-3">
              {impact.limitations.map((l, i) => (
                <li key={i} className="flex items-start gap-2 text-[11px] leading-snug">
                  <span className="mt-1 size-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
                  {l}
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  )
}
