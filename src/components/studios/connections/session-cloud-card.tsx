// Карточка облачного бэкенда сессии + инструкция локального запуска.
'use client'

import * as React from 'react'
import { ChevronDown, Cloud, RefreshCw, ShieldAlert, Terminal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { InlineSpinner } from '@/components/shared/states'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

export function SessionCloudCard() {
  const sessionCloud = useStore((s) => s.sessionCloud)
  const refreshSessionCloud = useStore((s) => s.refreshSessionCloud)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    void refreshSessionCloud()
  }, [refreshSessionCloud])

  const onRefresh = async () => {
    setBusy(true)
    try {
      await refreshSessionCloud()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="gap-2 pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <Cloud className="size-4 text-primary" aria-hidden />
          Облачный бэкенд сессии
          {sessionCloud?.available ? (
            <Badge variant="outline" className="gap-1.5 border-emerald-500/50 bg-emerald-500/10 font-mono text-[10px] text-emerald-600 dark:text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-400 pulse-dot" />
              LIVE
            </Badge>
          ) : (
            <Badge variant="outline" className="border-zinc-500/50 bg-zinc-500/10 font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
              недоступен
            </Badge>
          )}
        </CardTitle>
        <CardDescription>Временный бэкенд для запусков внутри этой среды разработки.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {sessionCloud?.available ? (
          <p className="text-xs leading-relaxed text-emerald-600 dark:text-emerald-400">
            доступен в этой сессии — роли можно назначать на него без локальной Ollama
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-rose-600 dark:text-rose-400" role="alert">
            {sessionCloud?.note || 'Облачный бэкенд недоступен'} — запуски ролей требуют подключения Ollama.
          </p>
        )}
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
          Облачный бэкенд существует только внутри сессии разработки. Локальный запуск проекта должен использовать
          Ollama — облачный путь исчезнет вместе с сессией.
        </p>
        {busy ? (
          <InlineSpinner label="Проверка…" />
        ) : (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void onRefresh()}>
            <RefreshCw className="size-3.5" aria-hidden />
            Проверить снова
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function CodeLine({ children }: { children: React.ReactNode }) {
  return (
    <code className="block break-all rounded bg-muted/60 px-2 py-1.5 font-mono text-[11px] text-foreground">
      {children}
    </code>
  )
}

export function LocalRunCard() {
  const [open, setOpen] = React.useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CardHeader className="gap-2 pb-3">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2 text-left"
              aria-expanded={open}
              aria-controls="local-run-instructions"
            >
              <Terminal className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="flex-1 text-sm font-semibold">Как запустить проект локально с Ollama</span>
              <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
            </button>
          </CollapsibleTrigger>
          <CardDescription>Инструкция для развёртывания вне этой сессии.</CardDescription>
        </CardHeader>
        <CollapsibleContent id="local-run-instructions">
          <CardContent className="space-y-3 text-xs leading-relaxed">
            <ol className="list-decimal space-y-2.5 pl-4">
              <li>
                Установите Ollama: <CodeLine>curl -fsSL https://ollama.com/install.sh | sh</CodeLine>
                (Linux/macOS) или скачайте установщик с ollama.com.
              </li>
              <li>
                Загрузите модель для генерации, например:{' '}
                <CodeLine>ollama pull llama3.1</CodeLine>
                для embedding-проб при необходимости:{' '}
                <CodeLine>ollama pull nomic-embed-text</CodeLine>
              </li>
              <li>
                Проверьте, что сервер отвечает:
                <CodeLine>curl localhost:11434/api/tags</CodeLine>
              </li>
              <li>
                Если браузер и Ollama на разных машинах, Ollama должна слушать доступный адрес:{' '}
                <CodeLine>OLLAMA_HOST=0.0.0.0 ollama serve</CodeLine>
              </li>
              <li>
                Затем добавьте подключение в форме выше с адресом вида{' '}
                <span className="font-mono">http://&lt;host&gt;:11434</span> и нажмите «Проверить соединение».
              </li>
            </ol>
            <div className="flex items-start gap-2.5 rounded-md border border-rose-500/30 bg-rose-500/5 p-3">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-rose-500" aria-hidden />
              <p className="text-[11px] leading-relaxed text-rose-600 dark:text-rose-400">
                OLLAMA_HOST=0.0.0.0 открывает сервер всем интерфейсам машины. Не открывайте Ollama в интернет без
                аутентификации — лучше использовать ssh-туннель:{' '}
                <span className="font-mono">ssh -L 11434:localhost:11434 user@host</span>.
              </p>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
