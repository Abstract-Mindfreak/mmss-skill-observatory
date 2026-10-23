// Лента сообщений помощника: пузыри по ролям, подписи backend·model, контекст
// фрагмента, копирование каждого сообщения, автопрокрутка вниз.
'use client'

import * as React from 'react'
import { Bot, User } from 'lucide-react'
import { CopyButton } from '@/components/shared/copy'
import { FragmentRef } from '@/components/shared/misc'
import { useStore } from '@/lib/store'
import type { ChatMessageDTO, FragmentDTO } from '@/lib/types'
import { cn } from '@/lib/utils'

export function ChatMessages({ messages, busy }: { messages: ChatMessageDTO[]; busy: boolean }) {
  const appState = useStore((s) => s.appState)
  const bottomRef = React.useRef<HTMLDivElement>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  const findFragment = (id: string | null): FragmentDTO | null =>
    id ? appState?.fragments.find((f) => f.id === id) ?? null : null

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, busy])

  return (
    <div
      ref={scrollRef}
      className="scroll-observatory max-h-[62vh] min-h-64 space-y-4 overflow-y-auto rounded-lg border bg-muted/20 p-4"
      role="log"
      aria-label="История диалога с помощником"
      aria-live="polite"
    >
      {messages.length === 0 && !busy && (
        <p className="py-8 text-center text-xs text-muted-foreground">Сообщений пока нет — задайте вопрос ниже.</p>
      )}
      {messages.map((m) => {
        const isUser = m.role === 'user'
        const fragment = findFragment(m.contextFragmentId)
        return (
          <div key={m.id} className={cn('flex gap-2.5', isUser ? 'justify-end' : 'justify-start')}>
            {!isUser && (
              <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full border bg-card">
                <Bot className="size-3.5 text-primary" aria-hidden />
              </span>
            )}
            <div className={cn('min-w-0 max-w-[85%] space-y-1', isUser && 'items-end text-right')}>
              <div
                className={cn(
                  'rounded-lg border px-3 py-2 text-left',
                  isUser
                    ? 'border-primary/30 bg-primary/10'
                    : 'border-border bg-card'
                )}
              >
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{m.content}</p>
              </div>
              <div
                className={cn(
                  'flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground',
                  isUser ? 'justify-end' : 'justify-start'
                )}
              >
                <span className="inline-flex items-center gap-1">
                  {isUser ? <User className="size-3" aria-hidden /> : null}
                  {isUser ? 'Вы' : 'Помощник'}
                </span>
                {m.backend && (
                  <span className="font-mono">
                    Тип подключения: {m.backend} · подключение: {m.connectionName ?? 'не сохранено'} · запрошенная модель: {m.model ?? 'не сохранена'} · фактический маршрут: {m.responseMetadata?.actualProvider ?? 'не сообщён'} / {m.responseMetadata?.actualModel ?? 'не сообщена'}
                  </span>
                )}
                {!isUser && m.responseMetadata?.contextMode && <span className="font-mono">Инструкция: {m.responseMetadata.contextMode} · версия {m.responseMetadata.contextVersionId ?? 'не выбрана'} · фрагменты {m.responseMetadata.contextFragmentIds?.join(', ') || '—'} · SHA-256 {m.responseMetadata.contextSha256 ?? 'не применимо'} · {m.responseMetadata.contextChars ?? 0} символов · история {m.responseMetadata.historyCount ?? 'неизвестна'} сообщений</span>}
                <span>{new Date(m.createdAt).toLocaleString('ru-RU')}</span>
                <CopyButton text={m.content} size="icon" variant="ghost" label="" />
              </div>
              {m.contextFragmentId &&
                (fragment ? (
                  <div className={cn(isUser && 'flex justify-end')}>
                    <FragmentRef fragment={fragment} />
                  </div>
                ) : (
                  <p className="font-mono text-[10px] text-muted-foreground">
                    контекст: фрагмент {m.contextFragmentId} (не в активной версии)
                  </p>
                ))}
            </div>
            {isUser && (
              <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full border bg-card">
                <User className="size-3.5 text-muted-foreground" aria-hidden />
              </span>
            )}
          </div>
        )
      })}
      {busy && (
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-card">
            <Bot className="size-3.5 animate-pulse text-primary" aria-hidden />
          </span>
          <p className="rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground" role="status">
            Модель отвечает…
          </p>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
