// Диалоги проб модели: реальный генеративный запрос и embedding-проба.
// Ошибки показываются честно — без подмены синтетикой.
'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { InlineSpinner } from '@/components/shared/states'
import { useToast } from '@/hooks/use-toast'
import { api, ApiError } from '@/lib/api-client'
import type { ConnectionDTO, ModelInfo } from '@/lib/types'

type GenerateResult = {
  ok: boolean
  output?: string
  durationMs?: number
  tokensIn?: number
  tokensOut?: number
  error?: string
}

export function GenerateTestDialog({
  open,
  onOpenChange,
  connection,
  model,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  connection: ConnectionDTO
  model: ModelInfo
}) {
  const { toast } = useToast()
  const [prompt, setPrompt] = React.useState('Reply with one short sentence.')
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<GenerateResult | null>(null)

  React.useEffect(() => {
    if (open) setResult(null)
  }, [open])

  const run = async () => {
    if (!prompt.trim()) {
      toast({ title: 'Введите текст запроса', variant: 'destructive' })
      return
    }
    setBusy(true)
    setResult(null)
    try {
      const r = await api.generateTest(connection.id, model.name, prompt)
      setResult(r)
      if (r.ok) toast({ title: 'Модель ответила', description: `${r.durationMs ?? '?'} мс` })
      else toast({ title: 'Проба не удалась', description: r.error, variant: 'destructive' })
    } catch (e) {
      setResult({
        ok: false,
        error: e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Неизвестная ошибка',
      })
      toast({ title: 'Проба не удалась', variant: 'destructive', description: e instanceof Error ? e.message : '' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">Пробный запрос · {model.name}</DialogTitle>
          <DialogDescription>
            Реальный запрос <span className="font-mono text-xs">POST {connection.baseUrl}/api/chat</span> — ответ
            приходит целиком, до 60 секунд.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          className="font-mono text-xs"
          aria-label="Текст пробного запроса"
        />
        {result && !result.ok && (
          <div role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-600 dark:text-rose-400">
            Проба завершилась ошибкой: {result.error}
          </div>
        )}
        {result && result.ok && (
          <div className="space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
            <p className="whitespace-pre-wrap break-words text-sm">{result.output ?? '(пустой ответ)'}</p>
            <p className="font-mono text-[11px] text-muted-foreground">
              {result.durationMs != null ? `${result.durationMs} мс` : ''}
              {result.tokensIn != null || result.tokensOut != null
                ? ` · токены: ${result.tokensIn ?? '?'} в / ${result.tokensOut ?? '?'} из`
                : ''}
            </p>
          </div>
        )}
        <DialogFooter>
          {busy ? (
            <InlineSpinner label="Модель отвечает…" />
          ) : (
            <Button size="sm" onClick={() => void run()}>
              Отправить пробный запрос
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type EmbedResult = {
  ok: boolean
  dimensions?: number
  preview?: number[]
  durationMs?: number
  via?: string
  error?: string
}

export function EmbedTestDialog({
  open,
  onOpenChange,
  connection,
  model,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  connection: ConnectionDTO
  model: ModelInfo
}) {
  const { toast } = useToast()
  const [text, setText] = React.useState('Пробный текст для embedding-проверки.')
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<EmbedResult | null>(null)

  React.useEffect(() => {
    if (open) setResult(null)
  }, [open])

  const run = async () => {
    if (!text.trim()) {
      toast({ title: 'Введите текст', variant: 'destructive' })
      return
    }
    setBusy(true)
    setResult(null)
    try {
      const r = await api.embedTest(connection.id, model.name, text)
      setResult(r)
      if (r.ok) toast({ title: 'Embedding получен', description: `размерность ${r.dimensions}` })
      else toast({ title: 'Проба не удалась', description: r.error, variant: 'destructive' })
    } catch (e) {
      setResult({
        ok: false,
        error: e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Неизвестная ошибка',
      })
      toast({ title: 'Проба не удалась', variant: 'destructive', description: e instanceof Error ? e.message : '' })
    } finally {
      setBusy(false)
    }
  }

  const notEmbedModel = model.generate && !model.embed

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">Пробный embedding · {model.name}</DialogTitle>
          <DialogDescription>
            Реальный запрос к <span className="font-mono text-xs">POST {connection.baseUrl}/api/embed</span> (при 404 —
            fallback на /api/embeddings).
          </DialogDescription>
        </DialogHeader>
        {notEmbedModel && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-600 dark:text-amber-300">
            По данным пробы /api/show эта модель генеративная и не заявляет поддержку embedding — запрос может
            завершиться ошибкой; она будет показана как есть.
          </p>
        )}
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="font-mono text-xs"
          aria-label="Текст для embedding-пробы"
        />
        {result && !result.ok && (
          <div role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-600 dark:text-rose-400">
            {notEmbedModel ? 'Эта модель не поддерживает embedding. ' : 'Проба завершилась ошибкой: '}
            {result.error}
          </div>
        )}
        {result && result.ok && (
          <div className="space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
            <p className="font-mono text-xs">
              размерность: <span className="text-emerald-600 dark:text-emerald-400">{result.dimensions}</span>
              {result.durationMs != null ? ` · ${result.durationMs} мс` : ''}
              {result.via ? ` · через ${result.via}` : ''}
            </p>
            <p className="break-all font-mono text-[11px] text-muted-foreground">
              первые значения: [{(result.preview ?? []).map((n) => (typeof n === 'number' ? n.toFixed(3) : String(n))).join(', ')}
              {result.dimensions != null && result.dimensions > (result.preview?.length ?? 0) ? ', …' : ''}]
            </p>
          </div>
        )}
        <DialogFooter>
          {busy ? (
            <InlineSpinner label="Модель отвечает…" />
          ) : (
            <Button size="sm" onClick={() => void run()}>
              Получить embedding
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
