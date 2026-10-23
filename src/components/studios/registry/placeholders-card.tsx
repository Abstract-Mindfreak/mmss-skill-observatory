// Список заглушек (PLACEHOLDER_REGISTRY) с копированием markdown.
'use client'

import * as React from 'react'
import { Puzzle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CopyButton } from '@/components/shared/copy'
import { StatusBadge } from '@/components/shared/status-badges'
import { PLACEHOLDER_REGISTRY } from '@/lib/types'

export function placeholdersMarkdown(): string {
  const lines = ['# Заглушки обсерватории (PLACEHOLDER)', '']
  for (const p of PLACEHOLDER_REGISTRY) {
    lines.push(`## ${p.title}`)
    lines.push(`- id: \`${p.id}\``)
    lines.push(`- чего не хватает: ${p.missing}`)
    lines.push(`- обходной путь: ${p.workaround}`)
    lines.push('')
  }
  lines.push('_Функции не реализованы и не выдаются за работающие; список фиксирован в коде (types.ts)._')
  return lines.join('\n')
}

export function PlaceholdersCard() {
  return (
    <Card>
      <CardHeader className="gap-2 pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <Puzzle className="size-4 text-primary" aria-hidden />
          Заглушки — что не реализовано
          <StatusBadge status="PLACEHOLDER" withHint={false} />
        </CardTitle>
        <CardDescription>
          Осознанные границы функциональности. У каждой заглушки — чего не хватает и обходной путь. Тот же список
          попадает в Research Handoff Report (часть «Заглушки»).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {PLACEHOLDER_REGISTRY.map((p) => (
          <div key={p.id} className="rounded-md border border-dashed bg-card/60 p-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-xs font-medium">{p.title}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{p.id}</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              <span className="text-foreground/80">Чего не хватает:</span> {p.missing}
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              <span className="text-foreground/80">Обходной путь:</span> {p.workaround}
            </p>
          </div>
        ))}
        <div className="pt-1">
          <CopyButton text={placeholdersMarkdown} label="Копировать список (markdown)" />
        </div>
      </CardContent>
    </Card>
  )
}
