// Импорт: сверка базовой версии с репозиторием (без молчаливой замены) и
// загрузка нового Markdown-документа (файл или вставка текста).
'use client'

import * as React from 'react'
import { BadgeCheck, FileUp, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { StatusBadge } from '@/components/shared/status-badges'
import { ErrorState, InlineSpinner } from '@/components/shared/states'
import { CopyBlock } from '@/components/shared/copy'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'
import type { DocumentVersionDTO, RemoteCheckResult } from '@/lib/types'

/** Сверка с репозиторием: показывает факт, не подменяет базовую версию. */
export function RemoteCheckCard({ activeVersion }: { activeVersion: DocumentVersionDTO | null }) {
  const [result, setResult] = React.useState<RemoteCheckResult | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const check = async () => {
    if (!activeVersion) return
    setBusy(true)
    setError(null)
    try {
      setResult(await api.checkRemote(activeVersion.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка проверки')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <BadgeCheck className="size-4 text-primary" aria-hidden />
          Сверка с репозиторием
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Сравнивается sha256 активной версии
          {activeVersion ? (
            <>
              {' '}
              «<span className="font-mono">{activeVersion.label}</span>»
            </>
          ) : null}{' '}
          с файлом в репозитории. Проверка ничего не изменяет: при различии показывается ссылка и
          инструкция — базовая версия не заменяется молча.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void check()} disabled={busy || !activeVersion}>
            {busy ? <InlineSpinner label="Проверка…" /> : 'Проверить репозиторий'}
          </Button>
          {result && (
            <StatusBadge
              status={result.reachable ? (result.identical ? 'LOCAL' : 'STALE') : 'ERROR'}
            />
          )}
        </div>
        {error && <ErrorState error={error} title="Проверка не удалась" />}
        {result && (
          <div className="space-y-2 rounded-md border p-3 text-xs">
            {result.reachable ? (
              result.identical ? (
                <p>
                  Активная версия и репозиторий <strong>идентичны</strong> (хэши совпадают):{' '}
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {result.remoteHash?.slice(0, 16)}…
                  </span>
                </p>
              ) : (
                <>
                  <p>
                    Содержимое репозитория <strong>отличается</strong> от активной версии.
                  </p>
                  <div className="grid gap-1 font-mono text-[11px] text-muted-foreground">
                    <span>локально: {result.localHash.slice(0, 24)}…</span>
                    <span>удалённо: {result.remoteHash?.slice(0, 24) ?? '—'} ({result.remoteLength ?? '?'} симв.)</span>
                  </div>
                  <CopyBlock title="URL удалённого файла" text={result.url} />
                  <div className="flex flex-wrap items-center gap-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0}>
                            <Button size="sm" variant="outline" disabled aria-disabled>
                              Импортировать удалённую версию как отдельную
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-72 text-xs">
                          Импорт удалённой версии не реализован — скачайте файл и вставьте через
                          «Новый документ»
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <StatusBadge status="PLACEHOLDER" />
                  </div>
                  <ol className="list-decimal space-y-0.5 pl-4 text-[11px] leading-snug text-muted-foreground">
                    <li>
                      скачайте файл:{' '}
                      <a
                        href={result.url}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-primary underline-offset-2 hover:underline"
                      >
                        {result.url}
                      </a>
                    </li>
                    <li>откройте вкладку «Вставить текст» в карточке «Загрузить Markdown» справа;</li>
                    <li>
                      вставьте содержимое — будет создан <strong>отдельный документ-версия</strong>, базовая
                      версия останется нетронутой.
                    </li>
                  </ol>
                </>
              )
            ) : (
              <p className="text-rose-600 dark:text-rose-400">
                Репозиторий недоступен: {result.error ?? 'причина неизвестна'}
              </p>
            )}
            <p className="border-t pt-1.5 text-[11px] text-muted-foreground">{result.note}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Загрузка нового Markdown-документа (файл .md или вставка текста). */
export function ImportDocumentCard({ projectId }: { projectId: string }) {
  const refresh = useStore((s) => s.refresh)
  const { toast } = useToast()
  const [title, setTitle] = React.useState('')
  const [knownVersion, setKnownVersion] = React.useState('')
  const [content, setContent] = React.useState('')
  const [source, setSource] = React.useState<'paste' | 'upload'>('paste')
  const [busy, setBusy] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)

  const onFile = (file: File | null) => {
    if (!file) return
    if (!/\.md$/i.test(file.name) && !/\.markdown$/i.test(file.name) && file.type !== 'text/markdown') {
      toast({ title: 'Выберите файл .md', description: `Получен: ${file.name}`, variant: 'destructive' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setContent(String(reader.result ?? ''))
      setSource('upload')
      if (!title) setTitle(file.name.replace(/\.(md|markdown)$/i, ''))
    }
    reader.onerror = () => toast({ title: 'Не удалось прочитать файл', variant: 'destructive' })
    reader.readAsText(file)
  }

  const submit = async () => {
    if (!title.trim() || !content.trim()) {
      toast({ title: 'Заполните заголовок и содержимое', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const doc = await api.importDocument(projectId, {
        title: title.trim(),
        content,
        source,
        knownVersion: knownVersion.trim() || undefined,
      })
      await refresh()
      const v = doc.versions[0]
      toast({
        title: `Документ «${doc.title}» импортирован`,
        description: v ? `Версия «${v.label}» стала активной для исследования (${v.fragmentCount} фрагментов)` : undefined,
      })
      setTitle('')
      setKnownVersion('')
      setContent('')
      setSource('paste')
      if (fileRef.current) fileRef.current.value = ''
    } catch (e) {
      toast({ title: 'Импорт не удался', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileUp className="size-4 text-primary" aria-hidden />
          Загрузить Markdown
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            новый документ
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Новый документ создаётся с собственной версией-оригиналом, разбирается на фрагменты и проходит
          локальный структурный анализ; его версия становится активной. Существующие документы не изменяются.
        </p>
        <Tabs
          value={source}
          onValueChange={(v) => setSource(v as 'paste' | 'upload')}
        >
          <TabsList className="h-8">
            <TabsTrigger value="file" className="text-xs">
              Файл
            </TabsTrigger>
            <TabsTrigger value="paste" className="text-xs">
              Вставить текст
            </TabsTrigger>
          </TabsList>
          <TabsContent value="file" className="mt-2 space-y-2">
            <Label htmlFor="md-file">Файл .md</Label>
            <Input
              id="md-file"
              ref={fileRef}
              type="file"
              accept=".md,.markdown,text/markdown"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-[11px] text-muted-foreground">
              Файл читается локально (FileReader) и отправляется как текст — содержимое не покидает приложение.
            </p>
          </TabsContent>
          <TabsContent value="paste" className="mt-2 space-y-2">
            <Label htmlFor="md-paste">Текст Markdown</Label>
            <Textarea
              id="md-paste"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="# Заголовок документа…"
              className="scroll-observatory min-h-32 font-mono text-xs"
              aria-label="Текст документа"
            />
          </TabsContent>
        </Tabs>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="md-title">Заголовок документа</Label>
            <Input id="md-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="SKILL.md — my-skill" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="md-known">Известная версия (необязательно)</Label>
            <Input
              id="md-known"
              value={knownVersion}
              onChange={(e) => setKnownVersion(e.target.value)}
              placeholder="например 0.2.0"
              className="font-mono"
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">
            {content.length.toLocaleString('ru-RU')} симв.
          </span>
          <Button size="sm" className="gap-1.5" onClick={() => void submit()} disabled={busy}>
            {busy ? <InlineSpinner label="Импорт…" /> : <><Upload className="size-3.5" aria-hidden />Импортировать документ</>}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
