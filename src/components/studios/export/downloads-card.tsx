// Скачивание серверных экспортов: архив JSON, отчёт Markdown, таблицы CSV, граф.
'use client'

import * as React from 'react'
import { Download, FileJson, FileText, Sheet, Waypoints } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InlineSpinner } from '@/components/shared/states'
import { useToast } from '@/hooks/use-toast'
import { ApiError, downloadFile, exportUrl, graphExportUrl } from '@/lib/api-client'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

type What = 'archive' | 'report' | 'csv' | 'graph-json' | 'graph-md'

export function DownloadsCard() {
  const { toast } = useToast()
  const appState = useStore((s) => s.appState)
  const activeVersion = useStore((s) => s.appState?.activeVersion ?? null)
  const [busy, setBusy] = React.useState<What | null>(null)

  const project = appState?.project
  const projectId = project?.id
  const slug = (project?.name ?? 'project')
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'project'

  const run = async (what: What, url: string, fallbackName: string) => {
    if (!projectId) return
    setBusy(what)
    try {
      await downloadFile(url, fallbackName)
      toast({ title: 'Файл сформирован', description: `Запрос: ${url.split('?')[0]}` })
    } catch (e) {
      toast({
        title: 'Не удалось скачать',
        description: e instanceof ApiError ? e.message : e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setBusy(null)
    }
  }

  const btn = (what: What) => cn('justify-start', busy !== null && busy !== what && 'opacity-60')

  const disabled = !projectId
  const graphDisabled = disabled || !activeVersion

  return (
    <Card>
      <CardHeader className="gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Download className="size-4 text-primary" aria-hidden />
          Скачивание
        </CardTitle>
        <CardDescription>Файлы формирует сервер из сохранённых данных проекта. Подключения и секреты в экспорт не входят.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {busy === 'archive' ? (
          <InlineSpinner label="Формирую архив…" />
        ) : (
          <Button
            variant="outline"
            size="sm"
            className={cn('w-full gap-2', btn('archive'))}
            disabled={disabled}
            onClick={() => projectId && void run('archive', exportUrl(projectId, 'json', 'all'), `${slug}-archive.json`)}
          >
            <FileJson className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="flex-1 text-left">Архив проекта (JSON)</span>
          </Button>
        )}
        {busy === 'report' ? (
          <InlineSpinner label="Формирую отчёт…" />
        ) : (
          <Button
            variant="outline"
            size="sm"
            className={cn('w-full gap-2', btn('report'))}
            disabled={disabled}
            onClick={() => projectId && void run('report', exportUrl(projectId, 'md', 'all'), `${slug}-report.md`)}
          >
            <FileText className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="flex-1 text-left">Отчёт Markdown</span>
          </Button>
        )}
        {busy === 'csv' ? (
          <InlineSpinner label="Формирую CSV…" />
        ) : (
          <Button
            variant="outline"
            size="sm"
            className={cn('w-full gap-2', btn('csv'))}
            disabled={disabled}
            onClick={() => projectId && void run('csv', exportUrl(projectId, 'csv', 'all'), `${slug}-tables.csv`)}
          >
            <Sheet className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="flex-1 text-left">Таблицы CSV</span>
          </Button>
        )}
        <p className="pl-1 text-[11px] leading-relaxed text-muted-foreground">
          CSV содержит сценарии/запуски/находки/заметки — остальные части архива в CSV не переносятся.
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          {busy === 'graph-json' ? (
            <InlineSpinner label="Граф JSON…" />
          ) : (
            <Button
              variant="outline"
              size="sm"
              className={cn('gap-2', btn('graph-json'))}
              disabled={graphDisabled}
              onClick={() =>
                projectId &&
                activeVersion &&
                void run('graph-json', graphExportUrl(projectId, activeVersion.id, 'json'), `${slug}-graph.json`)
              }
            >
              <Waypoints className="size-4 shrink-0 text-primary" aria-hidden />
              Граф (JSON)
            </Button>
          )}
          {busy === 'graph-md' ? (
            <InlineSpinner label="Граф MD…" />
          ) : (
            <Button
              variant="outline"
              size="sm"
              className={cn('gap-2', btn('graph-md'))}
              disabled={graphDisabled}
              onClick={() =>
                projectId &&
                activeVersion &&
                void run('graph-md', graphExportUrl(projectId, activeVersion.id, 'md'), `${slug}-graph.md`)
              }
            >
              <Waypoints className="size-4 shrink-0 text-primary" aria-hidden />
              Граф (Markdown)
            </Button>
          )}
        </div>
        <p className="pl-1 text-[11px] leading-relaxed text-muted-foreground">
          Граф выгружается по активной версии ({activeVersion ? activeVersion.label : '—'}) — это упрощённое представление
          графа; полная интерактивная карта — раздел «Карта правил».
        </p>
      </CardContent>
    </Card>
  )
}
