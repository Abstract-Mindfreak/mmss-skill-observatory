// «Оценить результат (Evaluator)»: диалог запуска оценщика по
// завершённому executor-запуску — цепочка executor → (LOCAL проверки)
// → evaluator с parentRunId и честными примечаниями.
'use client'

import * as React from 'react'
import { Info, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ErrorState } from '@/components/shared/states'
import { BackendPicker, BACKEND_NONE, type BackendValue, type PickerState } from './backend-picker'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api-client'
import { useStore } from '@/lib/store'
import type { RunDTO } from '@/lib/types'
import { InstructionContextSelector } from '@/components/shared/instruction-context-selector'
import { RolePromptPreview } from '@/components/shared/role-prompt-preview'
import type { InstructionContextSelection } from '@/lib/instruction-context'

export function EvaluateDialog({
  run,
  open,
  onOpenChange,
}: {
  run: RunDTO
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { toast } = useToast()
  const appState = useStore((s) => s.appState)
  const sessionCloud = useStore((s) => s.sessionCloud)
  const refresh = useStore((s) => s.refresh)
  const selectRun = useStore((s) => s.selectRun)

  const [criterion, setCriterion] = React.useState('')
  const [backend, setBackend] = React.useState<PickerState>({ none: BACKEND_NONE })
  const [busy, setBusy] = React.useState(false)
  const [elapsed, setElapsed] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [instructionContext, setInstructionContext] = React.useState<InstructionContextSelection>({ mode: 'none', versionId: run.versionId, fragmentIds: [], includeParentSections: false })
  const versions = (appState?.documents ?? []).flatMap((document) => document.versions.map((version) => ({ version, documentTitle: document.title })))

  React.useEffect(() => {
    if (!open) return
    setError(null)
    setInstructionContext({ mode: 'none', versionId: run.versionId, fragmentIds: [], includeParentSections: false })
    const scenario = appState?.scenarios.find((s) => s.id === run.scenarioId) ?? null
    setCriterion(scenario ? (scenario.description ? `${scenario.title}\n\n${scenario.description}` : scenario.title) : '')
    const a = appState?.assignments.find((x) => x.role === 'evaluator')
    if (a?.backend === 'ollama' && a.connectionId)
      setBackend({ mode: 'ollama', connectionId: a.connectionId, model: a.model })
    else if (a?.backend === 'freellmapi' && a.connectionId)
      setBackend({ mode: 'freellmapi', connectionId: a.connectionId, model: a.model })
    else {
      setBackend({ none: BACKEND_NONE })
    }
  }, [open])

  React.useEffect(() => {
    if (!busy) return
    setElapsed(0)
    const t0 = performance.now()
    const iv = setInterval(() => setElapsed((performance.now() - t0) / 1000), 100)
    return () => clearInterval(iv)
  }, [busy])

  const validBackend = 'mode' in backend && Boolean(backend.connectionId && backend.model)
  const canRun = !busy && criterion.trim().length > 0 && validBackend

  const launch = async () => {
    if (!appState?.project || !canRun) return
    setBusy(true)
    setError(null)
    try {
      if (!('mode' in backend)) throw new Error('Выберите FreeLLMAPI или Ollama либо назначьте подключение роли Evaluator в «Подключениях».')
      const mode = backend.mode
      const base: Parameters<typeof api.createRun>[0] = {
        projectId: appState.project.id,
        role: 'evaluator',
        backend: mode,
        connectionId: backend.connectionId ?? undefined,
        model: backend.model ?? undefined,
        scenarioId: run.scenarioId ?? undefined,
        versionId: instructionContext.versionId ?? undefined,
        action: 'evaluate-result',
        taskContext: {
          criterion: criterion.trim(),
          outputToEvaluate: run.output ?? '',
          instructionContext,
        },
        settings: { timeoutMs: 120000, programChecks: false },
      }
      // parentRunId is supported by the API but absent from client typings
      const body: Parameters<typeof api.createRun>[0] & { parentRunId?: string } = {
        ...base,
        parentRunId: run.id,
      }
      const res = await api.createRun(body)
      const created = res.runs[res.runs.length - 1]
      if (created) selectRun(created.id)
      await refresh()
      toast({ title: 'Оценка выполнена', description: 'Вердикт появится в деталях запуска оценщика.' })
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось запустить оценку')
    } finally {
      setBusy(false)
    }
  }

  const outputPreview = run.output ? (run.output.length > 600 ? run.output.slice(0, 600) + '\n…' : run.output) : ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto scroll-observatory sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Оценить результат — Evaluator</DialogTitle>
          <DialogDescription>
            Оценка сохраняется как отдельный запуск с родительской связью на этот executor-запуск. Статус выполнения ≠
            вердикт проверки.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ev-criterion" className="text-xs">
              Критерий оценки (обязателен)
            </Label>
            <Textarea
              id="ev-criterion"
              value={criterion}
              onChange={(e) => setCriterion(e.target.value)}
              placeholder="Что считается правильным результатом…"
              className="min-h-20 text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Подставлено из сценария (заголовок и описание) — отредактируйте при необходимости.
            </p>
          </div>

          <InstructionContextSelector value={instructionContext} onChange={setInstructionContext} versions={versions} disabled={busy} />
          <RolePromptPreview projectId={appState?.project?.id ?? null} role="evaluator" contextSelection={instructionContext} promptContext={{ criterion, outputToEvaluate: run.output ?? '', task: appState?.scenarios.find((item) => item.id === run.scenarioId) ? `Оценка результата сценария «${appState.scenarios.find((item) => item.id === run.scenarioId)!.title}»` : 'Оценка сохранённого результата', scenario: appState?.scenarios.find((item) => item.id === run.scenarioId) ? { title: appState.scenarios.find((item) => item.id === run.scenarioId)!.title, description: appState.scenarios.find((item) => item.id === run.scenarioId)!.description } : undefined }} />

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Результат для оценки (вывод executor, только для чтения)</Label>
            <pre className="scroll-observatory max-h-40 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
              {outputPreview || '—'}
            </pre>
            <p className="text-[10px] text-muted-foreground">Полный вывод будет отправлен модели целиком.</p>
          </div>

          <BackendPicker
            idPrefix="ev"
            value={backend}
            onChange={(v) => setBackend(v as BackendValue)}
            connections={appState?.connections ?? []}
            sessionCloud={sessionCloud ?? appState?.sessionCloud ?? null}
            allowFreeLLMAPI
            noneOption={{ value: BACKEND_NONE, label: 'Не назначено — выберите подключение' }}
          />

          <p className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] leading-relaxed">
            <Info className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden />
            Можно запустить несколько оценок одного результата: все заключения сохраняются отдельно, расхождения
            показываются в деталях. Несколько вызовов одной модели не являются независимым подтверждением.
          </p>

          {error && <ErrorState error={error} title="Оценка не выполнена" />}

          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              {busy ? (
                <span className="inline-flex items-center gap-2" role="status">
                  <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />
                  Модель работает… {elapsed.toFixed(1)} с
                </span>
              ) : (
                'Запрос синхронный — не закрывайте страницу.'
              )}
            </span>
            <Button size="sm" disabled={!canRun} onClick={() => void launch()}>
              {busy ? 'Оценка выполняется…' : 'Запустить оценку'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
