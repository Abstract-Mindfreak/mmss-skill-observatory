// Document outline: section tree (path + title + line range), sections linked
// to scenarios are marked with a Target icon. Click scrolls the reading pane
// to the section, expands and highlights it.

'use client'

import * as React from 'react'
import { Target } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { pluralRu } from './format'
import { useAtlas } from './context'
import type { SectionNode } from './doc-structure'
import { cn } from '@/lib/utils'

export function OutlinePanel({ onNavigate }: { onNavigate?: () => void }) {
  const { structure } = useAtlas()
  return (
    <nav aria-label="Оглавление документа" className="space-y-0.5">
      {structure.roots.map((node) => (
        <OutlineItem key={node.section.id} node={node} onNavigate={onNavigate} />
      ))}
    </nav>
  )
}

function OutlineItem({ node, onNavigate }: { node: SectionNode; onNavigate?: () => void }) {
  const { selectedSectionPath, selectSection, linkedSections } = useAtlas()
  const path = node.section.path
  const selected = selectedSectionPath === path
  const linked = linkedSections.get(path) ?? 0
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          selectSection(path)
          onNavigate?.()
        }}
        aria-current={selected ? 'true' : undefined}
        title={`Прокрутить текст к разделу ${path} (строки ${node.section.startLine}–${node.section.endLine})`}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted',
          selected && 'bg-primary/10 text-primary glow-teal'
        )}
      >
        <span className="w-9 shrink-0 truncate font-mono text-[10px] text-muted-foreground">{path}</span>
        <span className="min-w-0 flex-1 truncate">
          {node.section.title ?? node.section.text.split('\n')[0].slice(0, 48)}
        </span>
        {linked > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex shrink-0 items-center gap-0.5 text-emerald-500"
                  aria-label="Раздел связан со сценариями"
                >
                  <Target className="size-3" aria-hidden />
                  {linked > 1 && <span className="font-mono text-[9px]">{linked}</span>}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-64 text-xs">
                К разделу привязаны сценарии: {linked} {pluralRu(linked, 'сценарий', 'сценария', 'сценариев')} —
                покрытие проверками
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <span className="shrink-0 font-mono text-[9px] text-muted-foreground/70">
          {node.section.startLine}–{node.section.endLine}
        </span>
      </button>
      {node.children.length > 0 && (
        <div className="ml-3 space-y-0.5 border-l border-border/60 pl-1.5">
          {node.children.map((c) => (
            <OutlineItem key={c.section.id} node={c} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  )
}
