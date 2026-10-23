// Форма добавления Ollama-подключения + карточка о безопасности.
'use client'

import * as React from 'react'
import { Plus, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InlineSpinner } from '@/components/shared/states'
import { useToast } from '@/hooks/use-toast'
import { api, ApiError } from '@/lib/api-client'
import { useStore } from '@/lib/store'

export function AddConnectionCard() {
  const { toast } = useToast()
  const refresh = useStore((s) => s.refresh)
  const [kind, setKind] = React.useState<'ollama' | 'freellmapi'>('ollama')
  const [name, setName] = React.useState('Локальная Ollama')
  const [baseUrl, setBaseUrl] = React.useState('http://localhost:11434')
  const [busy, setBusy] = React.useState(false)

  const submit = async () => {
    if (!name.trim() || !baseUrl.trim()) {
      toast({ title: 'Заполните название и адрес', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const c = await api.createConnection(name.trim(), baseUrl.trim(), kind)
      await refresh()
      toast({
        title: 'Подключение добавлено',
        description: `Адрес: ${c.baseUrl}. Проверка не выполнялась — нажмите «Проверить соединение».`,
      })
    } catch (e) {
      toast({
        title: 'Не удалось добавить',
        description: e instanceof ApiError ? e.message : e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Добавить подключение модели</CardTitle>
        <CardDescription>
          Подключение создаётся без автоматической проверки — статус «Не проверялось» сменится только после реального
          ответа сервера.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(120px,0.8fr)_minmax(140px,1fr)_minmax(220px,2fr)_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="new-conn-kind">Провайдер</Label>
            <select
              id="new-conn-kind"
              value={kind}
              onChange={(e) => {
                const next = e.target.value as 'ollama' | 'freellmapi'
                setKind(next)
                if (next === 'freellmapi') {
                  setName('FreeLLMAPI · локальный шлюз')
                  setBaseUrl('http://127.0.0.1:31415/v1')
                } else {
                  setName('Локальная Ollama')
                  setBaseUrl('http://localhost:11434')
                }
              }}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="ollama">Ollama</option>
              <option value="freellmapi">FreeLLMAPI</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-conn-name">Название</Label>
            <Input id="new-conn-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Локальная Ollama" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-conn-url">Адрес (baseUrl)</Label>
            <Input
              id="new-conn-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="font-mono text-xs"
              placeholder="http://localhost:11434"
            />
          </div>
          {busy ? (
            <InlineSpinner label="Добавление…" />
          ) : (
            <Button size="sm" className="gap-1.5" onClick={() => void submit()}>
              <Plus className="size-4" aria-hidden />
              Добавить
            </Button>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {kind === 'freellmapi' ? (
            <>FreeLLMAPI: <span className="font-mono">http://127.0.0.1:31415/v1</span>. API-ключ задаётся только на сервере через <span className="font-mono">FREELLMAPI_API_KEY</span> в <span className="font-mono">.env.local</span>.</>
          ) : (
            <>Ollama по умолчанию слушает <span className="font-mono">localhost:11434</span>; для другого хоста укажите <span className="font-mono">http://&lt;host&gt;:11434</span>.</>
          )}
        </p>
        <div className="flex items-start gap-2.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
          <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
            Приложение обращается к указанному адресу с сервера. Ключ FreeLLMAPI хранится только в env и не передаётся клиенту.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
