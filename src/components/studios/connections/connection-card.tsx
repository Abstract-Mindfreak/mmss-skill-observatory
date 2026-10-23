// Карточка Ollama-подключения: статус, проверка, модели, пробы, правка, удаление.
'use client'

import * as React from 'react'
import { Pencil, RefreshCw, Trash2, Wand2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { InlineSpinner } from '@/components/shared/states'
import { KV } from '@/components/shared/misc'
import { useToast } from '@/hooks/use-toast'
import { api, ApiError } from '@/lib/api-client'
import { useStore } from '@/lib/store'
import type { ConnectionDTO, ModelInfo } from '@/lib/types'
import { CapabilityChip, ConnectionStatusChip, formatModelSize } from './connection-chip'
import { EmbedTestDialog, GenerateTestDialog } from './model-dialogs'

type TestOutcome =
  | { kind: 'ok'; latencyMs: number | null; modelCount: number | null }
  | { kind: 'error'; error: string }

export function ConnectionCard({ connection }: { connection: ConnectionDTO }) {
  const { toast } = useToast()
  const refresh = useStore((s) => s.refresh)

  const [testBusy, setTestBusy] = React.useState(false)
  const [modelsBusy, setModelsBusy] = React.useState(false)
  const [deleteBusy, setDeleteBusy] = React.useState(false)
  const [testOutcome, setTestOutcome] = React.useState<TestOutcome | null>(null)
  const [modelsError, setModelsError] = React.useState<string | null>(null)

  const [editOpen, setEditOpen] = React.useState(false)
  const [editName, setEditName] = React.useState(connection.name)
  const [editUrl, setEditUrl] = React.useState(connection.baseUrl)
  const [editBusy, setEditBusy] = React.useState(false)

  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [genModel, setGenModel] = React.useState<ModelInfo | null>(null)
  const [embedModel, setEmbedModel] = React.useState<ModelInfo | null>(null)

  // Honest verification: only a real successful response counts.
  const verified = connection.status === 'ok' && connection.models.length > 0

  React.useEffect(() => {
    if (editOpen) {
      setEditName(connection.name)
      setEditUrl(connection.baseUrl)
    }
  }, [editOpen, connection.name, connection.baseUrl])

  const onTest = async () => {
    setTestBusy(true)
    setTestOutcome(null)
    try {
      const r = await api.testConnection(connection.id)
      setTestOutcome(
        r.ok
          ? { kind: 'ok', latencyMs: r.latencyMs ?? null, modelCount: r.modelCount ?? null }
          : { kind: 'error', error: r.error ?? 'неизвестная ошибка' }
      )
      await refresh()
      toast(
        r.ok
          ? { title: 'Соединение работает', description: `${r.latencyMs ?? '?'} мс · моделей: ${r.modelCount ?? '?'}` }
          : { title: 'Соединение недоступно', description: r.error, variant: 'destructive' }
      )
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Не удалось выполнить проверку'
      setTestOutcome({ kind: 'error', error: msg })
      toast({ title: 'Проверка не удалась', description: msg, variant: 'destructive' })
    } finally {
      setTestBusy(false)
    }
  }

  const onRefreshModels = async () => {
    setModelsBusy(true)
    setModelsError(null)
    try {
      const r = await api.refreshModels(connection.id)
      if (r.error) setModelsError(r.error)
      await refresh()
      toast({
        title: r.error ? 'Список моделей получен с ограничением' : 'Модели обновлены',
        description: r.error ?? `${r.models.length} шт. (возможности — через /api/show)`,
        variant: r.error ? 'destructive' : undefined,
      })
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Не удалось обновить модели'
      setModelsError(msg)
      toast({ title: 'Модели недоступны', description: msg, variant: 'destructive' })
    } finally {
      setModelsBusy(false)
    }
  }

  const onSaveEdit = async () => {
    if (!editName.trim() || !editUrl.trim()) {
      toast({ title: 'Заполните название и адрес', variant: 'destructive' })
      return
    }
    setEditBusy(true)
    try {
      await api.updateConnection(connection.id, { name: editName.trim(), baseUrl: editUrl.trim() })
      await refresh()
      setEditOpen(false)
      toast({
        title: 'Подключение обновлено',
        description: editUrl.trim() !== connection.baseUrl ? 'адрес изменён — статус сброшен, проверьте соединение' : undefined,
      })
    } catch (e) {
      toast({
        title: 'Не удалось сохранить',
        description: e instanceof ApiError ? e.message : e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setEditBusy(false)
    }
  }

  const onDelete = async () => {
    setDeleteBusy(true)
    try {
      await api.deleteConnection(connection.id)
      await refresh()
      toast({ title: 'Подключение удалено', description: 'Назначения ролей на нём сброшены' })
    } catch (e) {
      toast({
        title: 'Не удалось удалить',
        description: e instanceof ApiError ? e.message : e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setDeleteBusy(false)
      setDeleteOpen(false)
    }
  }

  return (
    <Card id={`connection-${connection.id}`}>
      <CardHeader className="gap-3 pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CardTitle className="truncate text-sm">{connection.name}</CardTitle>
          <ConnectionStatusChip status={connection.status} lastError={connection.lastError} />
          <Badge variant="secondary" className="text-[10px]">
            моделей: {connection.models.length}
          </Badge>
          <span
            className="font-mono text-[10px] text-muted-foreground"
            title="Честный критерий: успешный ответ /api/tags и полученный список моделей"
          >
            проверено реальным ответом: {verified ? 'да' : 'нет'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {testBusy ? (
            <InlineSpinner label="Проверка…" />
          ) : (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void onTest()}>
              Проверить соединение
            </Button>
          )}
          {modelsBusy ? (
            <InlineSpinner label="Модели…" />
          ) : (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void onRefreshModels()}>
              <RefreshCw className="size-3.5" aria-hidden />
              Обновить модели
            </Button>
          )}
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setEditOpen(true)} aria-label={`Изменить подключение ${connection.name}`}>
            <Pencil className="size-3.5" aria-hidden />
            Изменить
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 text-rose-500 hover:text-rose-400"
            onClick={() => setDeleteOpen(true)}
            aria-label={`Удалить подключение ${connection.name}`}
          >
            <Trash2 className="size-3.5" aria-hidden />
            Удалить
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-x-8 md:grid-cols-2">
          <KV k="Адрес" v={<span className="font-mono text-xs break-all">{connection.baseUrl}</span>} />
          <KV
            k="Последняя проверка"
            v={connection.lastCheckAt ? new Date(connection.lastCheckAt).toLocaleString('ru-RU') : '—'}
          />
        </div>
        {connection.status === 'error' && connection.lastError && (
          <p role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2.5 text-xs text-rose-600 dark:text-rose-400">
            {connection.lastError}
          </p>
        )}
        {testOutcome?.kind === 'ok' && (
          <p className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 font-mono text-xs text-emerald-600 dark:text-emerald-400">
            ответ получен: {testOutcome.latencyMs != null ? `${testOutcome.latencyMs} мс` : 'задержка неизвестна'}
            {testOutcome.modelCount != null ? ` · моделей на сервере: ${testOutcome.modelCount}` : ''}
          </p>
        )}
        {testOutcome?.kind === 'error' && (
          <p role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2.5 text-xs text-rose-600 dark:text-rose-400">
            Соединение недоступно: {testOutcome.error}
          </p>
        )}
        {modelsError && (
          <p role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-600 dark:text-amber-300">
            Часть проб /api/show не удалась: {modelsError}
          </p>
        )}

        {connection.models.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Модели не загружены. Нажмите «Обновить модели» — приложение запросит{' '}
            <span className="font-mono">/api/tags</span> и определит возможности каждой модели через{' '}
            <span className="font-mono">/api/show</span>.
          </p>
        ) : (
          <div className="scroll-observatory max-h-96 overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-9">Модель</TableHead>
                  <TableHead className="h-9">Размер</TableHead>
                  <TableHead className="h-9">Возможности</TableHead>
                  <TableHead className="h-9 text-right">Пробы</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connection.models.map((m) => (
                  <TableRow key={m.name}>
                    <TableCell className="max-w-56 break-all py-2 font-mono text-xs">{m.name}</TableCell>
                    <TableCell className="py-2 text-xs tabular-nums">{formatModelSize(m.sizeBytes)}</TableCell>
                    <TableCell className="py-2">
                      <span className="flex flex-wrap items-center gap-1">
                        {m.generate ? <CapabilityChip kind="generate" probe={m.probe} /> : null}
                        {m.embed ? <CapabilityChip kind="embed" probe={m.probe} /> : null}
                        {!m.generate && !m.embed && <span className="text-xs text-muted-foreground">—</span>}
                      </span>
                    </TableCell>
                    <TableCell className="py-2 text-right">
                      <span className="flex flex-wrap justify-end gap-1.5">
                        <Button size="sm" variant="outline" className="h-8 gap-1 px-2 text-[11px]" onClick={() => setGenModel(m)}>
                          <Wand2 className="size-3" aria-hidden />
                          Пробный запрос
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 gap-1 px-2 text-[11px]" onClick={() => setEmbedModel(m)}>
                          Пробный embedding
                        </Button>
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Edit */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">Изменить подключение</DialogTitle>
            <DialogDescription>
              При смене адреса статус сбрасывается в «Не проверялось» — выполните проверку заново.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`conn-name-${connection.id}`}>Название</Label>
              <Input id={`conn-name-${connection.id}`} value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`conn-url-${connection.id}`}>Адрес (baseUrl)</Label>
              <Input
                id={`conn-url-${connection.id}`}
                value={editUrl}
                onChange={(e) => setEditUrl(e.target.value)}
                className="font-mono text-xs"
                placeholder="http://localhost:11434"
              />
            </div>
          </div>
          <DialogFooter>
            {editBusy ? (
              <InlineSpinner label="Сохранение…" />
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={() => setEditOpen(false)}>
                  Отмена
                </Button>
                <Button size="sm" onClick={() => void onSaveEdit()}>
                  Сохранить
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">Удалить подключение «{connection.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Назначения ролей на этом подключении будут сброшены в «Не назначено». Подключение можно добавить заново,
              но историю проверок оно не сохранит.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteBusy}
              className="bg-rose-600 text-white hover:bg-rose-500"
              onClick={(e) => {
                e.preventDefault()
                void onDelete()
              }}
            >
              {deleteBusy ? 'Удаление…' : 'Удалить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {genModel && (
        <GenerateTestDialog open={genModel != null} onOpenChange={(o) => !o && setGenModel(null)} connection={connection} model={genModel} />
      )}
      {embedModel && (
        <EmbedTestDialog open={embedModel != null} onOpenChange={(o) => !o && setEmbedModel(null)} connection={connection} model={embedModel} />
      )}
    </Card>
  )
}
