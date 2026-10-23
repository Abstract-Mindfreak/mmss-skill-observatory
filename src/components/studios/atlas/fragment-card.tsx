// Fragment card: everything known about one fragment — exact text, layers with
// honest basis, markers/terms, model interpretations, notes (add/delete),
// related scenarios, runs, findings with evidence passports, graph edges,
// ancestors breadcrumb and analysis limitations.

'use client'

import * as React from 'react'
import {
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Info,
  Loader2,
  Network,
  Plus,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CopyButton } from '@/components/shared/copy'
import { FragmentRef } from '@/components/shared/misc'
import { ErrorState, SkeletonPanel } from '@/components/shared/states'
import {
  OriginBadge,
  ProvenanceTag,
  RunStatusBadge,
  StatusBadge,
  VerdictBadge,
} from '@/components/shared/status-badges'
import { EvidencePassport } from '@/components/shared/evidence-passport'
import { LayerChip } from '@/components/shared/layers'
import {
  GRAPH_EDGE_KIND_TITLES,
  ROLE_TITLES,
  SCENARIO_STATUS_TITLES,
  type NoteKind,
  type ProvenanceStatus,
} from '@/lib/types'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { useAtlas } from './context'
import {
  FINDING_SEVERITY_CLASS,
  FINDING_SEVERITY_TITLES,
  FINDING_STATUS_TITLES,
  FRAGMENT_KIND_TITLES,
  NOTE_KIND_TITLES,
  SCENARIO_STATUS_CLASS,
  formatDateRu,
  pluralRu,
} from './format'
import { LAYER_PRIORITY, fragmentLayerInfos } from './layer-index'
import { InterpretDialog } from './interpret-dialog'

export function AtlasFragmentCard({ fragmentId }: { fragmentId: string }) {
  const { toast } = useToast()
  const card = useStore((s) => s.fragmentCards[fragmentId])
  const loading = useStore((s) => s.cardLoading.has(fragmentId))
  const loadFragmentCard = useStore((s) => s.loadFragmentCard)
  const refresh = useStore((s) => s.refresh)
  const appState = useStore((s) => s.appState)
  const setStudio = useStore((s) => s.setStudio)
  const selectScenario = useStore((s) => s.selectScenario)
  const selectRun = useStore((s) => s.selectRun)
  const a = useAtlas()

  const [interpretOpen, setInterpretOpen] = React.useState(false)
  const [noteBody, setNoteBody] = React.useState('')
  const [noteKind, setNoteKind] = React.useState<NoteKind>('note')
  const [noteBusy, setNoteBusy] = React.useState(false)
  const [deletingNote, setDeletingNote] = React.useState<string | null>(null)

  React.useEffect(() => {
    void loadFragmentCard(fragmentId)
  }, [fragmentId, loadFragmentCard])

  // The card GET can race with the atlas's analyze POST (the POST replaces the
  // analysis row delete-then-create, a tiny window without a row): the card then
  // arrives with analysisProvenance=PLACEHOLDER and no layers even though a fresh
  // local analysis exists. The atlas layer index IS that analysis — silently
  // refetch the card once when this is detected.
  const retriedFor = React.useRef<string | null>(null)
  // (card is undefined while the card is being fetched — guard both null and undefined)
  const hasCard = card !== null && card !== undefined
  const racedNoAnalysis =
    hasCard &&
    card.analysisProvenance === 'PLACEHOLDER' &&
    a.layerIndex !== null &&
    a.layerIndex.versionId === card.fragment.versionId
  React.useEffect(() => {
    if (!racedNoAnalysis || retriedFor.current === fragmentId) return
    retriedFor.current = fragmentId
    void loadFragmentCard(fragmentId, true)
  }, [racedNoAnalysis, fragmentId, loadFragmentCard])

  if (!card) {
    return loading ? (
      <SkeletonPanel rows={6} />
    ) : (
      <div className="p-4">
        <ErrorState
          error="Не удалось загрузить карточку фрагмента. Возможно, он был удалён вместе с версией."
          title="Карточка недоступна"
          onRetry={() => void loadFragmentCard(fragmentId, true)}
        />
      </div>
    )
  }

  const f = card.fragment
  const analysisProvenance: ProvenanceStatus = racedNoAnalysis
    ? 'LOCAL'
    : card.analysisProvenance
  const limitations =
    racedNoAnalysis && (a.layerIndex?.limitations.length ?? 0) > 0
      ? a.layerIndex!.limitations
      : card.limitations
  const annotation = card.annotation ?? a.layerIndex?.annotations.get(f.id) ?? null
  const specialLayers = fragmentLayerInfos(a.layerIndex, f.id, a.coverageSet).filter(
    (l) => !card.layers.some((cl) => cl.layer === l.layer)
  )
  const allLayers = [
    ...card.layers.map((b) => ({ layer: b.layer, basis: b })),
    ...specialLayers,
  ].sort((x, y) => LAYER_PRIORITY.indexOf(x.layer) - LAYER_PRIORITY.indexOf(y.layer))

  const addNote = async () => {
    if (!noteBody.trim() || !appState?.project) return
    setNoteBusy(true)
    try {
      await api.createNote({
        projectId: appState.project.id,
        fragmentId: f.id,
        versionId: f.versionId,
        kind: noteKind,
        body: noteBody.trim(),
      })
      setNoteBody('')
      await refresh()
      await loadFragmentCard(f.id, true)
      toast({ title: 'Заметка добавлена' })
    } catch (e) {
      toast({
        title: 'Не удалось добавить заметку',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      })
    } finally {
      setNoteBusy(false)
    }
  }

  const deleteNote = async (id: string) => {
    setDeletingNote(id)
    try {
      await api.deleteNote(id)
      await refresh()
      await loadFragmentCard(f.id, true)
      toast({ title: 'Заметка удалена' })
    } catch (e) {
      toast({
        title: 'Не удалось удалить заметку',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      })
    } finally {
      setDeletingNote(null)
    }
  }

  return (
    <div className="text-sm">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <Badge variant="secondary" className="text-[10px]">
          {FRAGMENT_KIND_TITLES[f.kind]}
        </Badge>
        <span className="font-mono text-xs text-muted-foreground" title="Путь фрагмента">
          {f.path}
        </span>
        <span className="text-[10px] text-muted-foreground">
          строки {f.startLine}–{f.endLine}
        </span>
        <StatusBadge status={analysisProvenance} />
        <span className="ml-auto">
          <CopyButton text={f.text} label="Текст" size="sm" variant="ghost" />
        </span>
      </div>

      <div className="space-y-4 p-3">
        {/* ancestors */}
        {card.ancestors.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {card.ancestors.map((anc, i) => (
              <React.Fragment key={anc.id}>
                {i > 0 && <ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
                <FragmentRef fragment={anc} text={anc.title ?? undefined} />
              </React.Fragment>
            ))}
          </div>
        )}

        {/* exact text */}
        <blockquote className="whitespace-pre-wrap break-words rounded-md border-l-2 border-primary/40 bg-muted/30 p-3 text-sm leading-relaxed">
          {f.text}
        </blockquote>

        {/* layers */}
        <CardSection title="Слои анализа">
          {allLayers.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {analysisProvenance === 'PLACEHOLDER'
                ? 'Локальный анализ не выполнялся — слои недоступны.'
                : 'Слои не обнаружены — фрагмент не содержит маркеров классификации.'}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {allLayers.map((l, i) => (
                <LayerChip key={`${l.layer}-${i}`} layer={l.layer} basis={l.basis} />
              ))}
            </div>
          )}
        </CardSection>

        {/* markers & terms */}
        {(annotation?.markers?.length || annotation?.terms?.length) && (
          <div className="space-y-2">
            {annotation.markers.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Маркеры:
                </span>
                {annotation.markers.map((m) => (
                  <code
                    key={m}
                    className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]"
                    title="Слово из списка маркеров модальности/неопределённости — само по себе не опасно, контекст решает (ТЗ п.4)"
                  >
                    {m}
                  </code>
                ))}
              </div>
            )}
            {annotation.terms.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Термины:
                </span>
                {annotation.terms.map((t) => (
                  <code key={t} className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px]">
                    {t}
                  </code>
                ))}
              </div>
            )}
          </div>
        )}

        {/* interpretations */}
        <CardSection
          title="Интерпретации моделей"
          action={
            card.interpretations.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-[11px]"
                onClick={() => setInterpretOpen(true)}
              >
                <Sparkles className="size-3" aria-hidden />
                Заново
              </Button>
            ) : undefined
          }
        >
          {card.interpretations.length === 0 ? (
            <div className="rounded-md border border-dashed p-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Модельных интерпретаций нет — выполните интерпретацию здесь или выберите фрагменты и
                запустите интерпретацию.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 gap-1.5"
                onClick={() => setInterpretOpen(true)}
              >
                <Sparkles className="size-3.5" aria-hidden />
                Интерпретировать фрагмент
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {card.interpretations.map((it, i) => (
                <div key={`${it.id}-${i}`} className="space-y-1.5 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                    <Badge variant="outline" className="font-mono text-[9px]">
                      {it.backend}
                      {it.model ? ` · ${it.model}` : ''}
                    </Badge>
                    <ProvenanceTag provenance="model-evaluated" />
                    <span>{formatDateRu(it.createdAt)}</span>
                  </div>
                  <p className="text-xs leading-relaxed">{it.interpretation}</p>
                  {it.alternatives.length > 0 && (
                    <div>
                      <p className="text-[10px] font-medium text-muted-foreground">Альтернативные прочтения:</p>
                      <ul className="ml-4 list-disc text-xs text-muted-foreground">
                        {it.alternatives.map((alt, j) => (
                          <li key={j}>{alt}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {it.scopeNote && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Область действия:</span> {it.scopeNote}
                    </p>
                  )}
                  {it.limitations && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Ограничения:</span> {it.limitations}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardSection>

        {/* notes */}
        <CardSection title="Заметки">
          <div className="space-y-2">
            {card.notes.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Заметок по фрагменту нет. Общие заметки (без привязки к фрагменту) в карточке не
                показываются.
              </p>
            )}
            {card.notes.map((n) => (
              <div key={n.id} className="rounded-md border p-2.5">
                <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                  <Badge variant="outline" className="text-[9px]">
                    {NOTE_KIND_TITLES[n.kind]}
                  </Badge>
                  <OriginBadge origin={n.origin} />
                  <span>{n.author}</span>
                  <span aria-hidden>·</span>
                  <span>{formatDateRu(n.createdAt)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto size-6 text-muted-foreground hover:text-rose-500"
                    aria-label="Удалить заметку"
                    disabled={deletingNote === n.id}
                    onClick={() => void deleteNote(n.id)}
                  >
                    {deletingNote === n.id ? (
                      <Loader2 className="size-3 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="size-3" aria-hidden />
                    )}
                  </Button>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed">{n.body}</p>
              </div>
            ))}
            <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
              <Textarea
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Заметка по этому фрагменту: наблюдение, возражение, вопрос…"
                aria-label="Текст заметки"
                className="min-h-[64px] text-xs"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Select value={noteKind} onValueChange={(v) => setNoteKind(v as NoteKind)}>
                  <SelectTrigger className="h-8 w-44 text-xs" aria-label="Тип заметки">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(NOTE_KIND_TITLES) as NoteKind[]).map((k) => (
                      <SelectItem key={k} value={k} className="text-xs">
                        {NOTE_KIND_TITLES[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="ml-auto gap-1.5"
                  disabled={!noteBody.trim() || noteBusy}
                  onClick={() => void addNote()}
                >
                  {noteBusy ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Plus className="size-3.5" aria-hidden />
                  )}
                  Добавить
                </Button>
              </div>
            </div>
          </div>
        </CardSection>

        {/* scenarios */}
        <CardSection title="Связанные сценарии">
          {card.scenarios.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Сценариев для раздела фрагмента нет — создайте их в Scenario Tree.
            </p>
          ) : (
            <div className="space-y-1.5">
              {card.scenarios.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    selectScenario(s.id)
                    setStudio('scenario')
                  }}
                  className="flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                  title="Открыть сценарий в Scenario Tree"
                >
                  <Badge variant="outline" className={cn('shrink-0 text-[9px]', SCENARIO_STATUS_CLASS[s.status])}>
                    {SCENARIO_STATUS_TITLES[s.status]}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-xs">{s.title}</span>
                  <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                    {s.runCount} {pluralRu(s.runCount, 'запуск', 'запуска', 'запусков')}
                  </span>
                  <OriginBadge origin={s.origin === 'demo' ? 'demo' : 'real'} />
                </button>
              ))}
            </div>
          )}
        </CardSection>

        {/* runs */}
        <CardSection title="Наблюдения из запусков">
          {card.runs.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Запусков по связанным сценариям нет — выполните их в Behavior Lab.
            </p>
          ) : (
            <div className="space-y-1.5">
              {card.runs.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    selectRun(r.id)
                    setStudio('lab')
                  }}
                  className="flex w-full flex-wrap items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                  title="Открыть запуск в Behavior Lab"
                >
                  <FlaskConical className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="text-xs font-medium">{ROLE_TITLES[r.role]}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {r.backend}
                    {r.model ? ` · ${r.model}` : ''}
                  </span>
                  <RunStatusBadge status={r.status} compact />
                  {(r.verdict || r.role === 'evaluator') && (
                    <VerdictBadge verdict={r.verdict} by={r.verdictBy} modelVerdict={r.modelVerdict} />
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground">{formatDateRu(r.createdAt)}</span>
                  <OriginBadge origin={r.origin} />
                </button>
              ))}
            </div>
          )}
        </CardSection>

        {/* findings */}
        <CardSection title="Находки">
          {card.findings.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Находок, привязанных к фрагменту, нет.
            </p>
          ) : (
            <div className="space-y-2">
              {card.findings.map((fx) => (
                <div key={fx.id} className="space-y-1.5 rounded-md border p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn('text-[9px]', FINDING_SEVERITY_CLASS[fx.severity])}
                    >
                      {FINDING_SEVERITY_TITLES[fx.severity]}
                    </Badge>
                    <Badge variant="outline" className="text-[9px]">
                      {FINDING_STATUS_TITLES[fx.status]}
                    </Badge>
                    <OriginBadge origin={fx.origin} />
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {formatDateRu(fx.createdAt)}
                    </span>
                  </div>
                  <p className="text-xs font-medium">{fx.title}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{fx.description}</p>
                  {fx.evidence && <EvidencePassport evidence={fx.evidence} />}
                </div>
              ))}
            </div>
          )}
        </CardSection>

        {/* graph edges */}
        <CardSection
          title="Связи графа"
          action={
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={() => setStudio('graph')}
              title="Открыть карту правил"
            >
              <Network className="size-3" aria-hidden />
              Показать в графе
            </Button>
          }
        >
          {card.graphEdges.length === 0 ? (
            <p className="text-xs text-muted-foreground">Рёбер графа для фрагмента нет.</p>
          ) : (
            <div className="space-y-1.5">
              {card.graphEdges.map((e) => {
                const otherId = e.source === f.id ? e.target : e.source
                const other = a.structure.byId.get(otherId) ?? null
                return (
                  <div
                    key={e.id}
                    className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5"
                  >
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[9px]',
                        (e.kind === 'conflicts' || e.kind === 'disputed') &&
                          'border-rose-500/40 text-rose-500'
                      )}
                    >
                      {GRAPH_EDGE_KIND_TITLES[e.kind]}
                    </Badge>
                    <TooltipWrapper
                      content={
                        <>
                          <p>{e.basis.detail}</p>
                          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                            основание: {e.basis.type}
                            {typeof e.basis.similarity === 'number'
                              ? ` · сходство ${e.basis.similarity.toFixed(2)} (представление, не эквивалентность)`
                              : ''}
                          </p>
                        </>
                      }
                    >
                      <span
                        className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
                        aria-label="Основание связи"
                      >
                        <Info className="size-3" aria-hidden />
                        {e.basis.type}
                      </span>
                    </TooltipWrapper>
                    <FragmentRef fragment={other} />
                  </div>
                )
              })}
            </div>
          )}
        </CardSection>

        {/* limitations */}
        {limitations.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-md border border-dashed px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50">
              <span className="inline-flex items-center gap-1.5">
                <TriangleAlert className="size-3.5" aria-hidden />
                Ограничения анализа ({limitations.length})
              </span>
              <ChevronDown
                className="size-3.5 transition-transform group-data-[state=open]:rotate-180"
                aria-hidden
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="px-1 pt-1">
              <ul className="ml-4 list-disc space-y-0.5 text-[11px] text-muted-foreground">
                {limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      <InterpretDialog
        open={interpretOpen}
        onOpenChange={setInterpretOpen}
        fragment={f}
        versionId={f.versionId}
      />
    </div>
  )
}

function CardSection({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Small local tooltip wrapper (the shared Tooltip requires a provider per use). */
function TooltipWrapper({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-80 text-xs">
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
