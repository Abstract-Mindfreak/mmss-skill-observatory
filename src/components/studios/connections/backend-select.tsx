// Общий селектор бэкенда: «Не назначено» / «Облачный бэкенд сессии» / модель
// конкретного Ollama-подключения. Используется в кабинете подключений (назначения
// ролей) и в чате помощника (переопределение бэкенда).
'use client'

import * as React from 'react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ConnectionDTO } from '@/lib/types'
import { cn } from '@/lib/utils'

export type BackendValue =
  | { backend: null }
  | { backend: 'ollama' | 'freellmapi'; connectionId: string; model: string }

export const BACKEND_NONE = 'none'

export function encodeBackendValue(v: BackendValue): string {
  if (v.backend === null) return BACKEND_NONE
  return `${v.backend}|${v.connectionId}|${v.model}`
}

export function decodeBackendValue(s: string): BackendValue {
  if (s === BACKEND_NONE) return { backend: null }
  if (s.startsWith('ollama|') || s.startsWith('freellmapi|')) {
    const [backend, connectionId, model] = s.split('|')
    if (connectionId && model) return { backend: backend as 'ollama' | 'freellmapi', connectionId, model }
  }
  return { backend: null }
}

/** Human-readable summary of the current assignment (mono, short). */
export function describeBackend(
  v: { backend: string | null; connectionId?: string | null; connectionName?: string | null; model?: string | null }
): string {
  if (!v.backend) return 'не назначено'
  const conn = v.connectionName ?? v.connectionId ?? '?'
  return `${v.backend} · подключение «${conn}» · модель ${v.model ?? 'не указана'}`
}

export function BackendSelect({
  value,
  onChange,
  connections,
  noneLabel = 'Не назначено',
  sessionAvailable: _sessionAvailable,
  allowFreeLLMAPI = false,
  disabled,
  className,
  ariaLabel,
}: {
  value: BackendValue
  onChange: (v: BackendValue) => void
  connections: ConnectionDTO[]
  noneLabel?: string
  sessionAvailable?: boolean
  allowFreeLLMAPI?: boolean
  disabled?: boolean
  className?: string
  ariaLabel?: string
}) {
  const encoded = encodeBackendValue(value)

  // Current ollama value may reference a model not listed in the cached models
  // (e.g. models were never refreshed) — render it as an explicit extra item.
  const needsFallbackItem =
    (value.backend === 'ollama' || value.backend === 'freellmapi') &&
    !connections.some((c) => c.id === value.connectionId && c.models.some((m) => m.name === value.model))
  const fallbackConnection = value.backend === 'ollama' || value.backend === 'freellmapi' ? connections.find((c) => c.id === value.connectionId) : undefined

  return (
    <Select
      value={encoded}
      onValueChange={(v) => onChange(decodeBackendValue(v))}
      disabled={disabled}
    >
      <SelectTrigger size="sm" className={cn('min-w-0 max-w-full font-mono text-xs', className)} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={BACKEND_NONE}>{noneLabel}</SelectItem>
        {needsFallbackItem && (value.backend === 'ollama' || value.backend === 'freellmapi') && (
          <SelectItem value={encoded}>
            Тип подключения {value.backend} · подключение «{fallbackConnection ? fallbackConnection.name : '—'}» · запрашиваемая модель {value.model}
          </SelectItem>
        )}
        {connections.filter((c) => allowFreeLLMAPI || c.kind !== 'freellmapi').map((c) => (
          <SelectGroup key={c.id}>
          <SelectLabel className="text-xs">
              Тип подключения: {c.kind} · название: {c.name} — {c.baseUrl}
            </SelectLabel>
            {c.models.length === 0 ? (
              <SelectItem value={`${c.id}__empty`} disabled>
                модели не загружены — нажмите «Обновить модели»
              </SelectItem>
            ) : (
              c.models.map((m) => (
                <SelectItem key={m.name} value={`${c.kind}|${c.id}|${m.name}`} className="font-mono text-xs">
                  Запрашиваемая модель: {m.name}
                </SelectItem>
              ))
            )}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
