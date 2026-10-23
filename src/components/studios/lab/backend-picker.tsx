// Общий выбор бэкенда для запусков/назначений/предложений:
// Ollama или FreeLLMAPI (подключение + модель). Используется
// в Behavior Lab и в диалоге Explorer студии Scenario.
'use client'

import * as React from 'react'
import { Plug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useStore } from '@/lib/store'
import type { ConnectionDTO } from '@/lib/types'
import { cn } from '@/lib/utils'

export interface BackendValue {
  mode: 'ollama' | 'freellmapi'
  connectionId: string | null
  model: string | null
}

export const BACKEND_NONE = '__none__'

/** Union of picker states: either an explicit backend or a "none" marker. */
export type PickerState = { none: string } | BackendValue

export interface NoneOption {
  value: string
  label: string
}

/** Sort: ok first, then unknown, then error — honest status suffixes. */
function sortConnections(connections: ConnectionDTO[]): ConnectionDTO[] {
  const rank = (c: ConnectionDTO) => (c.status === 'ok' ? 0 : c.status === 'unknown' ? 1 : 2)
  return [...connections].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

function statusSuffix(c: ConnectionDTO): string {
  if (c.status === 'ok') return ' · доступно'
  if (c.status === 'error') return ' · ошибка'
  return ' · не проверялось'
}

export function BackendPicker({
  value,
  onChange,
  connections,
  sessionCloud: _sessionCloud,
  noneOption,
  compact = false,
  allowFreeLLMAPI = false,
  idPrefix = 'bp',
}: {
  value: { mode: 'ollama' | 'freellmapi'; connectionId: string | null; model: string | null } | { none: string }
  onChange: (v: BackendValue | { none: string }) => void
  connections: ConnectionDTO[]
  sessionCloud: { available: boolean; note: string } | null
  noneOption?: NoneOption
  compact?: boolean
  allowFreeLLMAPI?: boolean
  idPrefix?: string
}) {
  const setStudio = useStore((s) => s.setStudio)
  const isNone = 'none' in value
  const mode = isNone ? null : value.mode
  const selectedConn = !isNone ? connections.find((c) => c.id === value.connectionId) ?? null : null
  const genModels = selectedConn ? selectedConn.models.filter((m) => m.generate) : []

  const setMode = (next: 'ollama' | 'freellmapi') => {
    // prefer an ok connection, auto-pick its first generate model
    const sorted = sortConnections(connections.filter((c) => c.kind === next))
    const conn = sorted[0] ?? null
    const model = conn ? conn.models.find((m) => m.generate)?.name ?? null : null
    onChange({ mode: next, connectionId: conn?.id ?? null, model })
  }

  const onConnectionChange = (connId: string) => {
    const conn = connections.find((c) => c.id === connId) ?? null
    const model = conn ? conn.models.find((m) => m.generate)?.name ?? null : null
    onChange({ mode: conn?.kind === 'freellmapi' ? 'freellmapi' : 'ollama', connectionId: conn?.id ?? null, model })
  }

  return (
    <div className={cn('space-y-2', compact && 'space-y-1.5')}>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-mode`} className="text-xs text-muted-foreground">
          Бэкенд
        </Label>
        <Select value={isNone ? value.none : mode ?? undefined} onValueChange={(v) => (v === 'ollama' || v === 'freellmapi' ? setMode(v) : onChange({ none: v }))}>
          <SelectTrigger id={`${idPrefix}-mode`} size="sm" className="w-full">
            <SelectValue placeholder="Выберите бэкенд" />
          </SelectTrigger>
          <SelectContent>
            {noneOption && (
              <SelectItem value={noneOption.value}>{noneOption.label}</SelectItem>
            )}
            <SelectItem value="ollama">Ollama · локальное подключение</SelectItem>
            {allowFreeLLMAPI && <SelectItem value="freellmapi">FreeLLMAPI · локальный шлюз</SelectItem>}
          </SelectContent>
        </Select>
      </div>

      {!isNone && (
        <>
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-conn`} className="text-xs text-muted-foreground">
              Подключение
            </Label>
            <Select value={value.connectionId ?? undefined} onValueChange={onConnectionChange}>
              <SelectTrigger id={`${idPrefix}-conn`} size="sm" className="w-full">
                <SelectValue placeholder="Выберите подключение" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {sortConnections(connections.filter((c) => c.kind === mode && (allowFreeLLMAPI || c.kind !== 'freellmapi'))).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {statusSuffix(c)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {!connections.some((c) => c.kind === mode) && (
              <p className="text-[10px] text-muted-foreground">Нет подключений {mode === 'freellmapi' ? 'FreeLLMAPI' : 'Ollama'} — создайте в кабинете подключений.</p>
            )}
            {connections.length > 0 && !selectedConn && (
              <p className="text-[10px] text-muted-foreground">Выберите подключение из списка.</p>
            )}
            {selectedConn && selectedConn.status === 'error' && selectedConn.lastError && (
              <p className="text-[10px] leading-relaxed text-rose-500">
                Последняя проверка: {selectedConn.lastError}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-model`} className="text-xs text-muted-foreground">
          Запрашиваемая модель
            </Label>
            <Select
              value={value.model ?? undefined}
              onValueChange={(m) => mode && onChange({ mode, connectionId: value.connectionId, model: m })}
              disabled={!selectedConn || genModels.length === 0}
            >
              <SelectTrigger id={`${idPrefix}-model`} size="sm" className="w-full">
                <SelectValue placeholder={genModels.length ? 'Выберите модель' : 'нет известных моделей'} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {genModels.map((m) => (
                    <SelectItem key={m.name} value={m.name}>
                      {m.name}
                      {m.sizeBytes ? ` · ${(m.sizeBytes / 1e9).toFixed(1)} ГБ` : ''}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {selectedConn && genModels.length === 0 && (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                У подключения нет известных генерирующих моделей. Обновите список моделей{' '}
                <Button
                  type="button"
                  size="sm"
                  variant="link"
                  className="h-auto gap-1 p-0 text-[10px]"
                  onClick={() => setStudio('connections')}
                >
                  <Plug className="size-3" aria-hidden />
                  в кабинете подключений
                </Button>
                .
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
