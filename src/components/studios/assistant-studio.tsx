// Помощник — исследовательский чат. Один из инструментов обсерватории, не её
// основа (ТЗ п.1): контекст выбранного фрагмента, честные границы знаний,
// сохранение сообщения при недоступной модели (1-b: 502 + saved:true).
'use client'

import * as React from 'react'
import { Bot, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState, InlineSpinner } from '@/components/shared/states'
import { SectionHeader } from '@/components/shared/misc'
import { useToast } from '@/hooks/use-toast'
import { ApiError, api } from '@/lib/api-client'
import { useStore, assignmentFor } from '@/lib/store'
import type { BackendValue } from './connections/backend-select'
import { ChatMessages } from './assistant/chat-messages'
import { ContextPanel, resolveChatBackend } from './assistant/context-panel'
import { InstructionContextSelector } from '@/components/shared/instruction-context-selector'
import { RolePromptPreview } from '@/components/shared/role-prompt-preview'
import type { InstructionContextSelection } from '@/lib/instruction-context'

const QUICK_PROMPTS = [
  'Что требует раздел 6.2 при недоступном источнике?',
  'Какие критерии завершения задаёт скилл?',
  'Где в тексте возможна неоднозначность терминов?',
]

export default function AssistantStudio() {
  const { toast } = useToast()
  const appState = useStore((s) => s.appState)
  const refresh = useStore((s) => s.refresh)
  const selectedFragmentId = useStore((s) => s.selectedFragmentId)
  const assignment = useStore((s) => assignmentFor(s, 'assistant'))

  const [input, setInput] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [useContext, setUseContext] = React.useState(true)
  const [override, setOverride] = React.useState<BackendValue | null>(null)
  const messages = appState?.chatMessages ?? []
  const versions = (appState?.documents ?? []).flatMap((document) => document.versions.map((version) => ({ version, documentTitle: document.title })))
  const [instructionContext, setInstructionContext] = React.useState<InstructionContextSelection>({ mode: 'none', versionId: appState?.activeVersion?.id ?? null, fragmentIds: [], includeParentSections: false })
  const historyRows = messages.slice(-10).filter((message) => message.role === 'user' || message.role === 'assistant')
  const selectedFragment = useContext && selectedFragmentId ? appState?.fragments.find((item) => item.id === selectedFragmentId) : null
  const taskMaterial = selectedFragment ? `[[обязательный материал id=${selectedFragment.id} path=${selectedFragment.path} version=${selectedFragment.versionId}]]\n${selectedFragment.text}` : undefined

  React.useEffect(() => {
    if (useContext && selectedFragment) setInstructionContext((current) => ({ ...current, versionId: selectedFragment.versionId }))
  }, [useContext, selectedFragment?.id])

  const projectId = appState?.project?.id
  const assignmentValue = assignment ?? { backend: null, connectionId: null, model: null }
  const resolved = React.useMemo(
    () => resolveChatBackend(override, assignmentValue),
    [override, assignmentValue]
  )

  const send = async (text: string) => {
    const content = text.trim()
    if (!content || busy) return
    if (!projectId) {
      toast({ title: 'Нет активного проекта', variant: 'destructive' })
      return
    }
    if (!resolved) {
      toast({
        title: 'Не выбран бэкенд модели',
        description: 'Назначьте роль assistant в кабинете подключений или выберите бэкенд справа.',
        variant: 'destructive',
      })
      return
    }
    setBusy(true)
    setInput('')
    try {
      await api.sendChat(projectId, {
        content,
        contextFragmentId: useContext && selectedFragmentId ? selectedFragmentId : undefined,
        instructionContext,
        backend: resolved.backend,
        connectionId: resolved.connectionId,
        model: resolved.model,
      })
      await refresh()
    } catch (e) {
      // 1-b semantics: on model failure (502, а также 5xx) the user message is
      // already saved — refresh anyway and show the honest error.
      const isSaved = e instanceof ApiError && e.status >= 500
      await refresh()
      if (isSaved) {
        toast({
          title: 'Модель недоступна',
          description: `${e instanceof Error ? e.message : ''} — сообщение сохранено`.trim(),
          variant: 'destructive',
        })
      } else {
        toast({
          title: 'Сообщение не отправлено',
          description: e instanceof ApiError ? e.message : e instanceof Error ? e.message : '',
          variant: 'destructive',
        })
      }
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(input)
    }
  }

  return (
    <div className="space-y-4 py-2">
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            <Bot className="size-5 text-primary" aria-hidden />
            Помощник
          </span>
        }
        description="Помощник отвечает по контексту выбранного фрагмента; чего нет в контексте — он должен сказать прямо. Это вспомогательный инструмент, а не замена атласу и лаборатории."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <div className="space-y-3">
          {messages.length === 0 && !busy ? (
            <EmptyState
              icon={Bot}
              title="Задайте вопрос о документе"
              hint="Например: «Что требует раздел 6.2 при недоступном источнике?» Ответ основан на контексте выбранного фрагмента и истории диалога."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {QUICK_PROMPTS.map((q) => (
                    <Button key={q} size="sm" variant="outline" className="max-w-xs text-xs" onClick={() => void send(q)}>
                      {q}
                    </Button>
                  ))}
                </div>
              }
            />
          ) : (
            <ChatMessages messages={messages} busy={busy} />
          )}

          <div className="space-y-2 rounded-lg border p-3">
            <InstructionContextSelector value={instructionContext} onChange={setInstructionContext} versions={versions} disabled={busy} />
            <RolePromptPreview projectId={projectId ?? null} role="assistant" contextSelection={instructionContext} promptContext={{ task: input }} fragmentId={selectedFragment?.id} history={historyRows.map((message) => ({ role: message.role, content: message.content }))} historyCount={historyRows.length} />
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={3}
              placeholder="Вопрос о документе… (Enter — отправить, Shift+Enter — новая строка)"
              aria-label="Текст сообщения помощнику"
              disabled={busy}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">
                {busy
                  ? 'Модель отвечает… запрос выполняется целиком и может занять до двух минут (стриминг не реализован — см. Реестр заглушек).'
                  : 'Ответ приходит целиком; при недоступной модели сообщение сохраняется в истории.'}
              </p>
              {busy ? (
                <InlineSpinner label="Модель отвечает…" />
              ) : (
                <Button size="sm" className="gap-1.5" disabled={!input.trim() || !resolved} onClick={() => void send(input)}>
                  <Send className="size-4" aria-hidden />
                  Отправить
                </Button>
              )}
            </div>
          </div>
        </div>

        <ContextPanel
          useContext={useContext}
          onUseContextChange={setUseContext}
          override={override}
          onOverrideChange={setOverride}
          resolvedBackend={resolved}
        />
      </div>
    </div>
  )
}
