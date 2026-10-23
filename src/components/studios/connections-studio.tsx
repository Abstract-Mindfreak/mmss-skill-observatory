// Кабинет подключений: честное управление Ollama-подключениями и назначениями
// моделей по ролям (ТЗ п.10). В песочнице Ollama недоступна — интерфейс показывает
// это честно; облачный бэкенд сессии доступен и помечен как временный.
'use client'

import * as React from 'react'
import { Plug } from 'lucide-react'
import { SectionHeader } from '@/components/shared/misc'
import { EmptyState } from '@/components/shared/states'
import { useStore } from '@/lib/store'
import { AddConnectionCard } from './connections/add-connection-card'
import { AssignmentsPanel } from './connections/assignments-panel'
import { ConnectionCard } from './connections/connection-card'
import { LocalRunCard, SessionCloudCard } from './connections/session-cloud-card'

export default function ConnectionsStudio() {
  const appState = useStore((s) => s.appState)
  const sessionCloud = useStore((s) => s.sessionCloud)

  const connections = appState?.connections ?? []
  const okCount = connections.filter((c) => c.status === 'ok').length

  return (
    <div className="space-y-6 py-2">
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            <Plug className="size-5 text-primary" aria-hidden />
            Кабинет подключений
          </span>
        }
        description="Подключения Ollama и FreeLLMAPI для модельных операций: адрес, проверка, выбор моделей, генерация, embedding и назначения по ролям. Статус появляется после реального ответа сервера."
        badges={
          <span className="font-mono text-[10px] text-muted-foreground">
            подключений: {connections.length} · проверено: {okCount}
          </span>
        }
      />

      <div className="space-y-4">
        {connections.length === 0 ? (
          <EmptyState
            icon={Plug}
            title="Подключений моделей пока нет"
            hint="Добавьте адрес Ollama или FreeLLMAPI ниже."
          />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {connections.map((c) => (
              <ConnectionCard key={c.id} connection={c} />
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <AddConnectionCard />
        <div className="space-y-4">
          <SessionCloudCard />
          <LocalRunCard />
        </div>
      </div>

      <AssignmentsPanel />

      <p className="text-xs leading-relaxed text-muted-foreground">
        {sessionCloud?.available
          ? 'Сейчас доступны запуски через облачный бэкенд сессии (LIVE). Ollama в этой среде не запущена — реальные подключения появятся при локальном запуске проекта.'
          : 'Облачный бэкенд сессии недоступен. Для LIVE-запусков подключите Ollama по инструкции выше.'}
      </p>
    </div>
  )
}
