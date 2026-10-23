// Statistics panel of the rule map: central nodes, bridges, isolated rules,
// duplicate clusters, longest dependency chain, sections without scenarios.
// Every block carries its method + limitations (collapsible) — honest metrics.

'use client'

import * as React from 'react'
import { ChevronDown, Info, ListTree, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { FragmentDTO, GraphData, GraphEdge, GraphNode } from '@/lib/types'
import { GRAPH_EDGE_KIND_TITLES } from '@/lib/types'
import { EDGE_KIND_COLORS, NODE_KIND_COLORS } from './graph-theme'
import { cn } from '@/lib/utils'

function MethodNote({ method, limits }: { method: string; limits: string[] }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full items-center gap-1 pt-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground/80">
        <Info className="size-3 shrink-0" aria-hidden />
        Метод и ограничения
        <ChevronDown className="size-3 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1">
        <p className="text-[11px] leading-relaxed text-muted-foreground">{method}</p>
        <ul className="mt-1 list-inside list-disc text-[11px] leading-relaxed text-muted-foreground">
          {limits.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

function Block({
  title,
  headline,
  children,
  method,
  limits,
  className,
}: {
  title: React.ReactNode
  headline?: React.ReactNode
  children: React.ReactNode
  method: string
  limits: string[]
  className?: string
}) {
  return (
    <Card className={cn('flex min-w-0 flex-col', className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</CardTitle>
        {headline}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2 pt-0">
        {children}
        <div className="mt-auto pt-1">
          <MethodNote method={method} limits={limits} />
        </div>
      </CardContent>
    </Card>
  )
}

function NodeRow({
  node,
  degree,
  fragments,
  onClick,
}: {
  node: GraphNode
  degree?: number
  fragments: Map<string, FragmentDTO>
  onClick: (id: string) => void
}) {
  const frag = fragments.get(node.fragmentId)
  return (
    <button
      type="button"
      onClick={() => onClick(node.id)}
      className="flex w-full items-start gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-primary/10"
    >
      <span className="mt-1 size-2 shrink-0 rounded-full" style={{ background: NODE_KIND_COLORS[node.kind] }} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-foreground/90">{frag ? frag.text : node.label}</span>
        <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
          {node.path}
          {node.sectionTitle ? ` · ${node.sectionTitle.replace(/^\s*[\d.]+\s*/, '')}` : ''}
        </span>
      </span>
      {degree !== undefined && (
        <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
          {degree}
        </Badge>
      )}
    </button>
  )
}

export function GraphStats({
  stats,
  nodes,
  edges,
  fragments,
  onSelectNode,
  onSelectEdge,
  onCreateScenario,
  className,
}: {
  stats: GraphData['stats']
  nodes: Map<string, GraphNode>
  edges: Map<string, GraphEdge>
  fragments: Map<string, FragmentDTO>
  onSelectNode: (id: string) => void
  onSelectEdge: (id: string) => void
  onCreateScenario: () => void
  className?: string
}) {
  const [openCluster, setOpenCluster] = React.useState<number | null>(null)
  const central = stats.centralNodes
  const bridges = stats.bridges
  const isolatedNodes = stats.isolatedNodes.map((id) => nodes.get(id)).filter((n): n is GraphNode => !!n)
  const chain = stats.longestChain.nodes.map((id) => nodes.get(id)).filter((n): n is GraphNode => !!n)

  return (
    <div className={cn('space-y-3', className)}>
      <details className="rounded-lg border bg-muted/30 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          Метод построения графа и его ограничения
        </summary>
        <p className="mt-2 text-xs leading-relaxed text-foreground/80">{stats.methodSummary}</p>
        <ul className="mt-2 list-inside list-disc text-xs leading-relaxed text-muted-foreground">
          {stats.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </details>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Block
          title="Центральные узлы"
          headline={<p className="text-[11px] text-muted-foreground">топ-{central.length} по числу связей</p>}
          method="Степень узла = число рёбер, входящих и исходящих (оба направления считаются одинаково)."
          limits={['Связи строятся эвристически (термины, структура, сценарии) — «центральность» отражает плотность текста, не важность правила.']}
        >
          <div className="scroll-observatory max-h-64 overflow-y-auto pr-1">
            {central.map((c) => {
              const node = nodes.get(c.nodeId)
              if (!node) return null
              return <NodeRow key={c.nodeId} node={node} degree={c.degree} fragments={fragments} onClick={onSelectNode} />
            })}
          </div>
        </Block>

        <Block
          title="Мосты между разделами"
          headline={<p className="text-[11px] text-muted-foreground">{bridges.length} связей через границы разделов</p>}
          method="Рёбра, у которых конечные узлы лежат в разных разделах (sectionPath источника ≠ цели)."
          limits={['Показаны первые 40 межразделовых рёбер — полный список не помещается; порядок — обход графа, не значимость.']}
        >
          <div className="scroll-observatory max-h-64 space-y-0.5 overflow-y-auto pr-1">
            {bridges.map((b) => {
              const edge = edges.get(b.edgeId)
              const kindTitle = edge ? GRAPH_EDGE_KIND_TITLES[edge.kind] : '—'
              return (
                <button
                  key={b.edgeId}
                  type="button"
                  onClick={() => onSelectEdge(b.edgeId)}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-primary/10"
                >
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {b.fromSection} → {b.toSection}
                  </span>
                  <span
                    className="truncate text-[11px]"
                    style={{ color: edge ? EDGE_KIND_COLORS[edge.kind] : undefined }}
                  >
                    {kindTitle}
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground">показать</span>
                </button>
              )
            })}
          </div>
        </Block>

        <Block
          title="Изолированные правила"
          headline={
            <p className="text-[11px] text-muted-foreground">
              <span className="font-mono text-sm font-semibold text-foreground/90">{stats.isolatedNodes.length}</span> узлов без связей
            </p>
          }
          method="Узлы со степенью 0 — ни одного ребра ни с одним другим узлом в этом графе."
          limits={[
            'Отсутствие связи — свойство эвристики построения, не «бесполезность» правила: терминов-перекрытий просто не нашлось.',
            'Список длинный — прокручивается.',
          ]}
        >
          <div className="scroll-observatory max-h-64 overflow-y-auto pr-1">
            {isolatedNodes.map((n) => (
              <NodeRow key={n.id} node={n} fragments={fragments} onClick={onSelectNode} />
            ))}
          </div>
        </Block>

        <Block
          title="Дублирующие формулировки"
          headline={<p className="text-[11px] text-muted-foreground">{stats.duplicateClusters.length} кластеров похожих формулировок</p>}
          method="Группировка повторов из локального анализа: лексическое сходство, Жаккард по токенам."
          limits={['Сходство вычислено в одном представлении — это не доказательство эквивалентности формулировок.']}
        >
          <div className="scroll-observatory max-h-64 space-y-1 overflow-y-auto pr-1">
            {stats.duplicateClusters.map((c, i) => {
              const open = openCluster === i
              return (
                <div key={i} className="rounded-md border bg-muted/30">
                  <button
                    type="button"
                    onClick={() => setOpenCluster(open ? null : i)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-primary/5"
                  >
                    <ChevronDown className={cn('size-3 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
                    <span className="flex-1">кластер из {c.nodeIds.length} формулировок</span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      сходство {c.similarity.toFixed(2)}
                    </Badge>
                  </button>
                  {open && (
                    <div className="space-y-0.5 border-t p-1">
                      {c.nodeIds.map((id) => {
                        const node = nodes.get(id)
                        if (!node) return null
                        return <NodeRow key={id} node={node} fragments={fragments} onClick={onSelectNode} />
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Block>

        <Block
          title="Самая длинная цепочка зависимостей"
          headline={
            <p className="text-[11px] text-muted-foreground">
              длина <span className="font-mono text-sm font-semibold text-foreground/90">{stats.longestChain.length}</span>
            </p>
          }
          method="Поиск в глубину по рёбрам «зависит от» и «уточняет», с защитой от циклов."
          limits={['Приближение: порядок обхода влияет на результат; цепочка не обязана быть самой важной в документе.']}
        >
          {chain.length === 0 ? (
            <p className="text-xs text-muted-foreground">В этом графе цепочек нет.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-1">
              {chain.map((n, i) => (
                <React.Fragment key={n.id}>
                  {i > 0 && <span className="text-muted-foreground" aria-hidden>→</span>}
                  <button
                    type="button"
                    onClick={() => onSelectNode(n.id)}
                    className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] transition-colors hover:border-primary/40 hover:bg-primary/10"
                  >
                    {n.path}
                  </button>
                </React.Fragment>
              ))}
            </div>
          )}
        </Block>

        <Block
          title="Разделы без проверочных сценариев"
          headline={<p className="text-[11px] text-muted-foreground">{stats.sectionsWithoutScenarios.length} разделов без сценариев</p>}
          method="Разделы верхнего уровня, к которым не привязан ни один сценарий (по фрагменту-анкору сценария)."
          limits={['Привязка сценария — редакторское решение; отсутствие сценария не означает отсутствие риска.']}
        >
          <ul className="scroll-observatory max-h-64 space-y-0.5 overflow-y-auto pr-1">
            {stats.sectionsWithoutScenarios.map((s) => (
              <li key={s.path} className="flex items-baseline gap-2 rounded px-1.5 py-1 text-xs">
                <span className="font-mono text-[10px] text-muted-foreground">{s.path}</span>
                <span className="truncate text-foreground/85">{s.title ? s.title.replace(/^\s*[\d.]+\s*/, '') : '—'}</span>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="outline" className="mt-2 gap-1.5" onClick={onCreateScenario}>
            <Plus className="size-3.5" aria-hidden />
            Создать сценарий
          </Button>
        </Block>
      </div>

      <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
        <ListTree className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Показатели вычислены локально из того же графа (LOCAL). Терминологические связи — не логические зависимости;
        сходство — в конкретном представлении.
      </p>
    </div>
  )
}
