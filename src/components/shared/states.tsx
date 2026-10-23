// Shared state components: loading / empty / error. Consistent across studios.
'use client'

import * as React from 'react'
import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function LoadingState({ label = 'Загрузка…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground', className)}>
      <Loader2 className="size-6 animate-spin text-primary/70" aria-hidden />
      <p className="text-sm">{label}</p>
    </div>
  )
}

export function InlineSpinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <Loader2 className="size-3.5 animate-spin" aria-hidden />
      {label}
    </span>
  )
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  hint,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  hint?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-10 text-center', className)}>
      <div className="flex size-11 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        {hint && <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
  )
}

export function ErrorState({
  error,
  onRetry,
  title = 'Что-то пошло не так',
  className,
}: {
  error: string
  onRetry?: () => void
  title?: string
  className?: string
}) {
  return (
    <div role="alert" className={cn('rounded-lg border border-rose-500/30 bg-rose-500/5 p-4', className)}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-500" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-rose-600 dark:text-rose-400">{title}</p>
          <p className="mt-1 break-words text-xs text-muted-foreground">{error}</p>
          {onRetry && (
            <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
              <RefreshCw className="size-3.5" aria-hidden />
              Повторить
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export function SkeletonPanel({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={cn('h-4', i % 3 === 2 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  )
}
