// «Предложить ветви (Explorer)» — диалог роста дерева через модель:
// count 1..5, бэкенд session-cloud/Ollama, честные ошибки 502.
// Новые ветви: origin='model', status='unexplored' — НЕ проверены.
'use client'

import * as React from 'react'
import { Loader2, Sparkles, ChevronRight, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { CopyButton } from '@/components/shared/copy'
import { ErrorState } from '@/components/shared/states'
import { OriginBadge } from '@/components/shared/status-badges'
import { BackendPicker, BACKEND_NONE, type PickerState } from '@/components/studios/lab/backend-picker'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api-client'
import { useStore } from '@/lib/store'
import type { ScenarioDTO } from '@/lib/types'
import { clampInt, type ResearchParams } from './export'
import { cn } from '@/lib/utils'
import { InstructionContextSelector } from '@/components/shared/instruction-context-selector'
import { RolePromptPreview } from '@/components/shared/role-prompt-preview'
import type { InstructionContextSelection } from '@/lib/instruction-context'

interface SuggestResult {
  created: ScenarioDTO[]
  raw: string
  backend: string
  model: string | null
}

export function SuggestDialog({
  open,
  onOpenChange,
  scenario,
  params,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scenario: ScenarioDTO
  params: ResearchParams
  onCreated: (parentId: string) => void
}) {
  const { toast } = useToast()
  const appState = useStore((s) => s.appState)
  const sessionCloud = useStore((s) => s.sessionCloud)
  const refresh = useStore((s) => s.refresh)

  const [count, setCount] = React.useState(3)
  const [backend, setBackend] = React.useState<PickerState>({ none: BACKEND_NONE })
  const [busy, setBusy] = React.useState(false)
  const [elapsed, setElapsed] = React.useState(0)
  const [result, setResult] = React.useState<SuggestResult | null>(null)
  const [error, setError] = React.useState<{ message: string; detail?: string } | null>(null)
  const [rawOpen, setRawOpen] = React.useState(false)
  const [linkedFragment, setLinkedFragment] = React.useState<import('@/lib/types').FragmentDTO | null>(null)
  React.useEffect(() => {
    if (!scenario.fragmentId) { setLinkedFragment(null); return }
    const active = appState?.fragments.find((fragment) => fragment.id === scenario.fragmentId)
    if (active) { setLinkedFragment(active); return }
    let current = true
    api.fragmentCard(scenario.fragmentId).then((card) => { if (current) setLinkedFragment(card.fragment) }).catch(() => { if (current) setLinkedFragment(null) })
    return () => { current = false }
  }, [scenario.fragmentId, appState?.fragments])
  const linkedVersionId = linkedFragment?.versionId ?? appState?.activeVersion?.id ?? null
  const [instructionContext, setInstructionContext] = React.useState<InstructionContextSelection>({ mode: 'none', versionId: linkedVersionId, fragmentIds: [], includeParentSections: false })
  React.useEffect(() => {
    if (!open) return
    const versionId = linkedFragment?.versionId ?? (!scenario.fragmentId ? appState?.activeVersion?.id : null)
    const version = (appState?.documents ?? []).flatMap((document) => document.versions).find((item) => item.id === versionId)
    if (!version) return
    setInstructionContext({ mode: version.contentLength <= 24000 ? 'full' : 'selected', versionId: version.id, fragmentIds: version.contentLength <= 24000 || !linkedFragment ? [] : [linkedFragment.id], includeParentSections: version.contentLength > 24000 && Boolean(linkedFragment), includeTableOfContents: version.contentLength > 24000 })
  }, [linkedFragment?.id, appState?.documents, appState?.activeVersion?.id, open, scenario.fragmentId])
  const versions = (appState?.documents ?? []).flatMap((document) => document.versions.map((version) => ({ version, documentTitle: document.title })))

  // (re)initialize on open
  React.useEffect(() => {
    if (!open) return
    setResult(null)
    setError(null)
    setRawOpen(false)
    setInstructionContext({ mode: 'none', versionId: linkedVersionId, fragmentIds: [], includeParentSections: false })
    setCount(clampInt(params.maxNewBranches, 1, 5, 3))
    const assignment = appState?.assignments.find((a) => a.role === 'explorer')
    if ((assignment?.backend === 'ollama' || assignment?.backend === 'freellmapi') && assignment.connectionId && assignment.model) {
      setBackend({ mode: assignment.backend, connectionId: assignment.connectionId, model: assignment.model })
    } else setBackend({ none: BACKEND_NONE })
  }, [open, appState?.assignments])

  // elapsed timer while busy
  React.useEffect(() => {
    if (!busy) return
    setElapsed(0)
    const t0 = performance.now()
    const iv = setInterval(() => setElapsed((performance.now() - t0) / 1000), 100)
    return () => clearInterval(iv)
  }, [busy])

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      if (!('mode' in backend) || !backend.connectionId || !backend.model) throw new Error('Назначьте Explorer в «Подключениях» или выберите FreeLLMAPI/Ollama для этого действия.')
      const res = await api.suggestScenarios(scenario.id, {
        backend: backend.mode,
        connectionId: backend.connectionId,
        model: backend.model,
        count: clampInt(count, 1, 5, 3),
        contextSelection: instructionContext,
      })
      setResult(res)
      await refresh()
      onCreated(scenario.id)
      toast({
        title: 'Предложения добавлены',
        description: `Создано ветвей: ${res.created.length}. Они не исследованы — это не проверка.`,
      })
    } catch (e) {
      const err = e as { message?: string; detail?: string }
      setError({ message: err.message ?? 'Не удалось получить предложения', detail: err.detail })
    } finally {
      setBusy(false)
    }
  }

  const canRun =
    !busy && 'mode' in backend && Boolean(backend.connectionId && backend.model)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto scroll-observatory sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden />
            Предложить ветви — Explorer
          </DialogTitle>
          <DialogDescription>
            Модель предложит РАЗЛИЧАЮЩИЕСЯ механизмы отказа (разные причины, не вариации одной темы) как дочерние
            ветви «{scenario.title}».
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-md border bg-emerald-500/10 px-2 py-1 text-emerald-600 dark:text-emerald-400">
                Создано: {result.created.length}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {result.backend}
                {result.model ? ` · ${result.model}` : ''}
              </span>
            </div>

            <p className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] leading-relaxed">
              <Info className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden />
              Новые ветви созданы со статусом «Неисследованная» и происхождением «предложено моделью». Это
              гипотезы для проверки, а не подтверждённые результаты.
            </p>

            <ul className="space-y-1.5">
              {result.created.map((c) => (
                <li key={c.id} className="rounded-md border bg-muted/30 p-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 font-medium">{c.title}</span>
                    {c.origin === 'demo' && <OriginBadge origin="demo" />}
                  </div>
                  {c.description && (
                    <p className="mt-0.5 text-muted-foreground">{c.description.length > 220 ? c.description.slice(0, 220) + '…' : c.description}</p>
                  )}
                </li>
              ))}
            </ul>

            <Collapsible open={rawOpen} onOpenChange={setRawOpen}>
              <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-xs hover:bg-muted/60">
                Полный ответ модели
                <ChevronRight className={cn('size-3.5 transition-transform', rawOpen && 'rotate-90')} aria-hidden />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 space-y-2">
                  <pre className="scroll-observatory max-h-72 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
                    {result.raw}
                  </pre>
                  <div className="flex justify-end">
                    <CopyButton text={result.raw} label="Скопировать ответ" />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {error && <ErrorState error={error.message} title="Ошибка при повторе" />}

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => { setResult(null); setError(null) }}>
                Предложить ещё
              </Button>
              <Button size="sm" onClick={() => onOpenChange(false)}>
                Готово
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="sg-count" className="text-xs">
                Сколько ветвей предложить (1..5)
              </Label>
              <div className="flex items-center gap-3">
                <Input
                  id="sg-count"
                  type="number"
                  min={1}
                  max={5}
                  value={count}
                  onChange={(e) => setCount(clampInt(Number(e.target.value), 1, 5, 3))}
                  className="h-8 w-20 text-xs"
                />
                <span className="text-[10px] text-muted-foreground">
                  По умолчанию — из «Параметров исследования» (макс. ветвей за шаг).
                </span>
              </div>
            </div>

            <BackendPicker
              idPrefix="sg"
              value={backend}
              onChange={(v) => setBackend(v as PickerState)}
              connections={appState?.connections ?? []}
              sessionCloud={sessionCloud ?? appState?.sessionCloud ?? null}
              allowFreeLLMAPI
              noneOption={{ value: BACKEND_NONE, label: 'Не назначено — выберите подключение' }}
            />

            <div className="rounded border p-2 text-[11px]"><strong>Обязательный материал сценария:</strong> {scenario.title}{scenario.description ? ` · ${scenario.description}` : ''}{linkedFragment ? ` · фрагмент ${linkedFragment.id} ${linkedFragment.path}` : ''}</div>
            <InstructionContextSelector value={instructionContext} onChange={setInstructionContext} versions={versions} disabled={busy} />
            <RolePromptPreview projectId={appState?.project?.id ?? null} role="explorer" contextSelection={instructionContext} scenarioId={scenario.id} promptContext={{ mechanismsCount: clampInt(count, 1, 5, 3) }} />

            <p className="flex gap-2 rounded-md border bg-muted/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Запрос выполняется синхронно и может занять до 2 минут. Прогресс по шагам не транслируется —
              честный ответ приходит целиком.
            </p>

            {error && (
              <ErrorState
                error={error.message + (error.detail ? ` Подробности: ${error.detail}` : '')}
                title="Модель не смогла предложить ветви"
              />
            )}

            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">
                {busy ? (
                  <span className="inline-flex items-center gap-2" role="status">
                    <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />
                    Модель работает… {elapsed.toFixed(1)} с
                  </span>
                ) : (
                  'Дерево вырастет только вашими решениями — предложения не проверяются автоматически.'
                )}
              </span>
              <Button size="sm" disabled={!canRun} onClick={() => void run()}>
                {busy ? 'Модель работает…' : 'Предложить'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
