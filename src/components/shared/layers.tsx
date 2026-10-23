// Layer visual system for the Instruction Atlas and everywhere layers appear.
// Underline color + style + icon + label — color is never the only carrier of meaning.
'use client'

import * as React from 'react'
import {
  Ban,
  BookOpen,
  CloudFog,
  Copy as CopyIcon,
  GitBranch,
  HelpCircle,
  Lightbulb,
  Search,
  ShieldCheck,
  Split,
  Tag,
  Target,
  Unlink,
  Zap,
  CheckCircle2,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { LAYER_TITLES, type LayerBasis, type LayerId } from '@/lib/types'
import { cn } from '@/lib/utils'

export interface LayerVisual {
  color: string // hex, used for underline & chips
  style: 'solid' | 'dotted' | 'dashed' | 'wavy'
  icon: React.ComponentType<{ className?: string }>
}

export const LAYER_VISUALS: Record<LayerId, LayerVisual> = {
  obligation: { color: '#fbbf24', style: 'solid', icon: ShieldCheck },
  prohibition: { color: '#fb7185', style: 'solid', icon: Ban },
  permission: { color: '#34d399', style: 'dotted', icon: CheckCircle2 },
  recommendation: { color: '#5eead4', style: 'dotted', icon: Lightbulb },
  condition: { color: '#fb923c', style: 'dashed', icon: GitBranch },
  exception: { color: '#e879f9', style: 'dashed', icon: Split },
  definition: { color: '#a3e635', style: 'solid', icon: BookOpen },
  identifier: { color: '#a78bfa', style: 'solid', icon: Tag },
  evidence: { color: '#4ade80', style: 'dotted', icon: Search },
  unknown: { color: '#94a3b8', style: 'dashed', icon: HelpCircle },
  ambiguity: { color: '#fde047', style: 'wavy', icon: CloudFog },
  repetition: { color: '#d6d3d1', style: 'dotted', icon: CopyIcon },
  conflict: { color: '#f87171', style: 'wavy', icon: Zap },
  'missing-link': { color: '#a1a1aa', style: 'dashed', icon: Unlink },
  coverage: { color: '#6ee7b7', style: 'solid', icon: Target },
}

/** Inline span with the layer underline (for the atlas text). */
export function LayerMark({
  layer,
  children,
  active,
  onClick,
}: {
  layer: LayerId
  children: React.ReactNode
  active?: boolean
  onClick?: (e: React.MouseEvent) => void
}) {
  const v = LAYER_VISUALS[layer]
  return (
    <span
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onClick(e as unknown as React.MouseEvent)
        }
      }}
      className={cn('hl-underline', active && 'bg-primary/15')}
      style={{
        textDecorationColor: v.color,
        textDecorationStyle: v.style,
      }}
    >
      {children}
    </span>
  )
}

/** Small colored chip with icon + label; tooltip shows the basis. */
export function LayerChip({
  layer,
  basis,
  size = 'sm',
}: {
  layer: LayerId
  basis?: LayerBasis
  size?: 'sm' | 'xs'
}) {
  const v = LAYER_VISUALS[layer]
  const Icon = v.icon
  const chip = (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-px text-[10px]'
      )}
      style={{ borderColor: `${v.color}55`, backgroundColor: `${v.color}14`, color: v.color }}
    >
      <Icon className={size === 'sm' ? 'size-3' : 'size-2.5'} aria-hidden />
      {LAYER_TITLES[layer]}
    </span>
  )
  if (!basis) return chip
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{chip}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-80 text-xs">
          <p className="font-medium">{LAYER_TITLES[layer]}</p>
          <p className="mt-1">{basis.reason}</p>
          {basis.matched.length > 0 && (
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              маркеры: {basis.matched.join(', ')}
            </p>
          )}
          {basis.limitations && <p className="mt-1 text-muted-foreground">Ограничение: {basis.limitations}</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** Legend row of layers (used in the atlas and graph). */
export function LayerLegend({ layers }: { layers: LayerId[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {layers.map((l) => (
        <LayerChip key={l} layer={l} size="xs" />
      ))}
    </div>
  )
}
