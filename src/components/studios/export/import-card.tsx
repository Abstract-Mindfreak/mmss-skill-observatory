// Импорт архива проекта: файл .json или вставка текста, клиентская проверка JSON,
// серверная валидация формата с указательными путями ошибок.
'use client'

import * as React from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { ErrorState, InlineSpinner } from '@/components/shared/states'
import { useToast } from '@/hooks/use-toast'
import { api, ApiError } from '@/lib/api-client'
import { useStore } from '@/lib/store'

export function ImportCard() {
  const { toast } = useToast()
  const refresh = useStore((s) => s.refresh)
  const setProject = useStore((s) => s.setProject)
  const setStudio = useStore((s) => s.setStudio)
  const fileRef = React.useRef<HTMLInputElement>(null)

  const [pasted, setPasted] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [errorDetail, setErrorDetail] = React.useState<string | null>(null)
  const [warnings, setWarnings] = React.useState<string[] | null>(null)

  const doImport = async (raw: string) => {
    setBusy(true)
    setError(null)
    setErrorDetail(null)
    setWarnings(null)
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      setError('Строка не является корректным JSON — проверьте, что скопирован весь файл архива.')
      setErrorDetail(e instanceof Error ? e.message : '')
      setBusy(false)
      return
    }
    try {
      const r = await api.importArchive(parsed)
      setWarnings(r.warnings.length > 0 ? r.warnings : null)
      await setProject(r.project.id)
      await refresh()
      toast({
        title: 'Проект импортирован',
        description: `${r.project.name}${r.warnings.length > 0 ? ` · предупреждений: ${r.warnings.length}` : ''}`,
      })
      setPasted('')
      setStudio('overview')
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message)
        setErrorDetail(e.detail ?? null)
      } else {
        setError(e instanceof Error ? e.message : 'Неизвестная ошибка импорта')
      }
    } finally {
      setBusy(false)
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const raw = await file.text()
      await doImport(raw)
    } catch {
      setError('Не удалось прочитать файл.')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <Card>
      <CardHeader className="gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Upload className="size-4 text-primary" aria-hidden />
          Импорт архива проекта
        </CardTitle>
        <CardDescription>
          Формат: JSON-архив <span className="font-mono text-[11px]">mmss-observatory-archive</span>,{' '}
          <span className="font-mono text-[11px]">archiveVersion: 1</span> — создаётся кнопкой «Архив проекта (JSON)».
          Импорт создаёт новый проект с суффиксом «(импорт)».
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            id="import-archive-file"
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="size-4" aria-hidden />
            Выбрать файл .json
          </Button>
          <span className="text-[11px] text-muted-foreground">или вставьте содержимое архива ниже</span>
        </div>
        <Textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={5}
          placeholder='{"format":"mmss-observatory-archive","archiveVersion":1,…}'
          className="font-mono text-xs"
          aria-label="Вставленный JSON архива проекта"
        />
        {busy ? (
          <InlineSpinner label="Импорт и пересборка проекта…" />
        ) : (
          <Button size="sm" disabled={!pasted.trim()} onClick={() => void doImport(pasted)}>
            Импортировать из текста
          </Button>
        )}
        {error && <ErrorState error={errorDetail ? `${error}\n\n${errorDetail}` : error} title="Импорт не выполнен" />}
        {warnings && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
              Проект создан с предупреждениями ({warnings.length}):
            </p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[11px] text-muted-foreground">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
