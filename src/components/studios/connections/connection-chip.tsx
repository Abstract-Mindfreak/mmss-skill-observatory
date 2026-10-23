// Кабинет подключений: статус подключения + подписи для проб моделей.
'use client'

import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { ConnectionDTO, ModelInfo } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Honest connection status chip: ok / error / unknown (never «проверена» without a real response). */
export function ConnectionStatusChip({
  status,
  lastError,
  className,
}: {
  status: ConnectionDTO['status']
  lastError?: string | null
  className?: string
}) {
  const meta =
    status === 'ok'
      ? { label: 'Подключено', hint: 'Реальный ответ от сервера Ollama (GET /api/tags)', cls: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' }
      : status === 'error'
        ? {
            label: 'Ошибка соединения',
            hint: lastError ? `Последняя проверка: ${lastError}` : 'Последняя проверка завершилась ошибкой',
            cls: 'border-rose-500/50 bg-rose-500/10 text-rose-600 dark:text-rose-400',
          }
        : { label: 'Не проверялось', hint: 'Соединение ещё не проверялось реальным запросом', cls: 'border-zinc-500/50 bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border-dashed' }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn('gap-1.5 text-xs', meta.cls, className)}>
            <span className={cn('size-1.5 rounded-full', status === 'ok' ? 'bg-emerald-400' : status === 'error' ? 'bg-rose-400' : 'bg-zinc-400')} />
            {meta.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-72 text-xs">
          <p>{meta.hint}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** How model capabilities were determined — always explainable. */
export const PROBE_HINTS: Record<ModelInfo['probe'], string> = {
  show: 'определено через /api/show — сервер сообщил о возможностях модели',
  probe: 'определено реальной пробой запроса',
  'tags-only': 'эвристика по имени модели — проверьте пробой',
  unknown: 'способ определения неизвестен',
}

export function CapabilityChip({ kind, probe }: { kind: 'generate' | 'embed'; probe: ModelInfo['probe'] }) {
  const isGenerate = kind === 'generate'
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn(
              'font-mono text-[10px]',
              isGenerate
                ? 'border-teal-500/50 bg-teal-500/10 text-teal-600 dark:text-teal-300'
                : 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300'
            )}
          >
            {isGenerate ? 'Генерация' : 'Embedding'}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-64 text-xs">
          <p>{isGenerate ? 'Поддерживает генерацию (chat)' : 'Поддерживает embedding-запросы'}</p>
          <p className="mt-1 text-muted-foreground">{PROBE_HINTS[probe]}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** bytes → «4.7 GB / 512 MB»; null → «—». */
export function formatModelSize(sizeBytes: number | null): string {
  if (sizeBytes == null || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return '—'
  const gb = sizeBytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = sizeBytes / 1024 ** 2
  if (mb >= 1) return `${Math.round(mb)} MB`
  return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`
}
