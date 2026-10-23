'use client'

import * as React from 'react'
import { Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { ErrorState } from '@/components/shared/states'
import { api } from '@/lib/api-client'
import type { InstructionContextSelection } from '@/lib/instruction-context'
import type { RolePromptContext } from '@/lib/role-prompts'

const MESSAGE_ROLE_RU = { system: 'Служебные указания роли + дополнительная инструкция', user: 'Задача и обязательный материал', assistant: 'История помощника' }

export function RolePromptPreview({
  projectId, role, contextSelection, promptContext, historyCount, scenarioId, fragmentId, findingId, history,
}: {
  projectId: string | null
  role: string
  contextSelection: InstructionContextSelection
  promptContext: RolePromptContext
  historyCount?: number
  scenarioId?: string
  fragmentId?: string
  findingId?: string
  history?: { role: 'user' | 'assistant'; content: string }[]
}) {
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<Awaited<ReturnType<typeof api.previewRole>> | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const load = async () => {
    if (!projectId) return
    setBusy(true); setError(null)
    try { setResult(await api.previewRole({ projectId, role, contextSelection, promptContext, scenarioId, fragmentId, findingId, history })) }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось собрать предпросмотр') }
    finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) void load() }}>
      <DialogTrigger asChild><Button size="sm" variant="outline" disabled={!projectId}><Eye className="mr-1.5 size-3.5" aria-hidden />Предпросмотр отправки</Button></DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Фактические сообщения для роли {role}</DialogTitle><DialogDescription>Предпросмотр собирается тем же серверным сборщиком сообщений, который используют запуск и выбранный клиент провайдера. Секреты подключения в сообщениях не показываются.</DialogDescription></DialogHeader>
        {busy && <p className="text-xs text-muted-foreground">Собираю сообщения…</p>}
        {error && <ErrorState error={error} title="Предпросмотр недоступен" />}
        {result && <div className="space-y-3">
          <div className="rounded border bg-muted/20 p-2 text-[11px]">
            <p>Режим инструкции: <strong>{result.instruction.mode}</strong> · версия: <strong>{result.instruction.versionLabel ?? 'не выбрана'}</strong></p>
            {result.instruction.mode !== 'none' && <p>Включённый контекст: {result.instruction.sentContextChars.toLocaleString('ru-RU')} символов · SHA-256 выборки {result.instruction.sentContextSha256}</p>}
            {result.instruction.mode === 'full' && <p>SHA-256 полной версии {result.instruction.fullVersionSha256} · {result.instruction.fullVersionChars?.toLocaleString('ru-RU')} символов</p>}
            {result.instruction.mode === 'selected' && <><p>Выбраны ID: {result.instruction.selectedFragmentIds.join(', ') || '—'}</p><p>Фактически включены ID: {result.instruction.includedFragmentIds.join(', ') || '—'}</p></>}
            {result.instruction.mode === 'none' && <p>Дополнительная инструкция отсутствует; обязательный материал задачи остаётся в сообщениях.</p>}
            {historyCount !== undefined && <p>История Assistant в запросе: {historyCount} сообщений.</p>}
            <p>Размер всех сообщений: {result.totalChars.toLocaleString('ru-RU')} символов.</p>
          </div>
          {result.messages.map((message, index) => <section key={index} className="space-y-1 rounded border p-2">
            <h3 className="text-xs font-medium">{index + 1}. {MESSAGE_ROLE_RU[message.role]}</h3>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px]">{message.content}</pre>
          </section>)}
        </div>}
      </DialogContent>
    </Dialog>
  )
}
