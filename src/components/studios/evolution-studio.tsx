// Evolution Studio (ТЗ п.8): управление версиями документа, экспериментальное
// редактирование с локальным предпросмотром последствий, diff и сверка с репозиторием.
'use client'

import * as React from 'react'
import { GitBranch, PencilLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SectionHeader } from '@/components/shared/misc'
import { EmptyState, InlineSpinner } from '@/components/shared/states'
import { useStore, activeVersion, activeVersionId } from '@/lib/store'
import { api } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'
import type { ImpactResult } from '@/lib/types'
import { VersionTree } from './evolution/version-tree'
import { DiffPanel } from './evolution/diff-view'
import { ExperimentDialog, type ExperimentDraft } from './evolution/experiment-dialog'
import { ImpactReport } from './evolution/impact-report'
import { ImportDocumentCard, RemoteCheckCard } from './evolution/import-panel'

export default function EvolutionStudio() {
  const appState = useStore((s) => s.appState)
  const version = useStore(activeVersion)
  const currentVersionId = useStore(activeVersionId)
  const selectVersion = useStore((s) => s.selectVersion)
  const refresh = useStore((s) => s.refresh)
  const { toast } = useToast()

  const [expOpen, setExpOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<ExperimentDraft | null>(null)
  const [impact, setImpact] = React.useState<ImpactResult | null>(null)
  const [impactBaseLabel, setImpactBaseLabel] = React.useState('')
  const [savedAs, setSavedAs] = React.useState<string | null>(null)
  const [impactBusy, setImpactBusy] = React.useState(false)
  const [saveBusy, setSaveBusy] = React.useState(false)
  const [compareA, setCompareA] = React.useState<string | null>(null)
  const [compareB, setCompareB] = React.useState<string | null>(null)

  const diffRef = React.useRef<HTMLDivElement>(null)
  const impactRef = React.useRef<HTMLDivElement>(null)

  const project = appState?.project ?? null
  const documents = appState?.documents ?? []

  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // ---- экспериментальная ветка ----

  const openExperiment = () => {
    if (!version) return
    const labels = new Set(documents.flatMap((d) => d.versions.map((v) => v.label)))
    let n = documents.reduce((acc, d) => acc + d.versions.filter((v) => v.kind === 'experimental').length, 0) + 1
    let label = `experiment-${n}`
    while (labels.has(label)) {
      n += 1
      label = `experiment-${n}`
    }
    setDraft({ parentId: version.id, label, note: '', content: null })
    setImpact(null)
    setSavedAs(null)
    setExpOpen(true)
  }

  const onDraftChange = React.useCallback((patch: Partial<ExperimentDraft>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  const previewImpact = async () => {
    if (!draft || draft.content === null) return
    setImpactBusy(true)
    try {
      const result = await api.impactVersion(draft.parentId, draft.content)
      setImpact(result)
      const parentLabel = documents.flatMap((d) => d.versions).find((v) => v.id === draft.parentId)?.label ?? draft.parentId
      setImpactBaseLabel(parentLabel)
      setSavedAs(null)
      setExpOpen(false)
      toast({
        title: 'Предпросмотр последствий готов',
        description: 'Локальный расчёт: 0 запросов к модели. Сохранение ветки — отдельное действие.',
      })
      setTimeout(() => scrollTo(impactRef), 80)
    } catch (e) {
      toast({
        title: 'Не удалось вычислить последствия',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setImpactBusy(false)
    }
  }

  const saveBranch = async () => {
    if (!draft || draft.content === null) return
    setSaveBusy(true)
    try {
      const res = (await api.branchVersion(draft.parentId, {
        label: draft.label.trim() || 'experiment',
        content: draft.content,
        note: draft.note.trim() || undefined,
      })) as { id?: string }
      await refresh()
      if (res?.id) selectVersion(res.id)
      setSavedAs(draft.label.trim())
      setExpOpen(false)
      toast({
        title: `Ветка «${draft.label.trim()}» сохранена`,
        description: 'Фрагменты пересобраны, локальный анализ выполнен. Результаты прежней версии помечаются устаревшими.',
      })
      setTimeout(() => scrollTo(impactRef), 80)
    } catch (e) {
      toast({
        title: 'Сохранение не удалось',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setSaveBusy(false)
    }
  }

  if (!project) {
    return (
      <EmptyState
        title="Нет активного проекта"
        hint="Создайте проект или импортируйте архив, чтобы управлять версиями документа."
      />
    )
  }

  return (
    <div className="space-y-6 py-2">
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            <GitBranch className="size-5 text-primary" aria-hidden />
            Evolution Studio
          </span>
        }
        description="Версии документа, экспериментальные правки и честная оценка последствий: что изменится буквально, какие постановки затронуты, какие результаты устареют и сколько стоит пересчёт. Предпросмотр последствий — локальный расчёт без обращений к моделям."
        actions={
          <Button size="sm" className="gap-1.5" onClick={openExperiment} disabled={!version}>
            <PencilLine className="size-4" aria-hidden />
            Создать экспериментальную ветку
          </Button>
        }
      />

      {/* Дерево версий */}
      <div className="space-y-6">
        {compareA && (
          <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
            Сравнение: версия A — «{documents.flatMap((d) => d.versions).find((v) => v.id === compareA)?.label ?? compareA}».
            Выберите вторую версию кнопкой «Сравнить» на карточке или в панели ниже.
          </p>
        )}
        <VersionTree
          documents={documents}
          selectedId={currentVersionId}
          activeId={appState?.activeVersion?.id ?? null}
          compareA={compareA}
          onSelect={selectVersion}
          onCompareWith={(id) => {
            setCompareA(id)
            setCompareB(null)
            setTimeout(() => scrollTo(diffRef), 80)
          }}
          onCompareTo={(id) => {
            setCompareB(id)
            setTimeout(() => scrollTo(diffRef), 80)
          }}
          onVersionCreated={() => undefined}
        />
      </div>

      {/* Сравнение версий */}
      <div ref={diffRef} className="scroll-mt-20">
        <DiffPanel
          documents={documents}
          aId={compareA}
          bId={compareB}
          onAId={setCompareA}
          onBId={setCompareB}
          panelRef={diffRef}
        />
      </div>

      {/* Отчёт о последствиях правки */}
      {impact && draft && (
        <div ref={impactRef} className="scroll-mt-20">
          <ImpactReport
            impact={impact}
            baseLabel={impactBaseLabel}
            savedAs={savedAs}
            actions={
              <>
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setExpOpen(true)}>
                  <PencilLine className="size-3" aria-hidden />
                  Продолжить редактирование
                </Button>
                {impact.newVersionId === 'unsaved' && (
                  <Button size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={() => void saveBranch()} disabled={saveBusy}>
                    {saveBusy ? <InlineSpinner label="Сохранение…" /> : 'Сохранить ветку'}
                  </Button>
                )}
              </>
            }
          />
        </div>
      )}

      {/* Сверка с репозиторием + импорт документа */}
      <div className="grid gap-4 lg:grid-cols-2">
        <RemoteCheckCard activeVersion={appState?.activeVersion ?? null} />
        <ImportDocumentCard projectId={project.id} />
      </div>

      {/* Диалог экспериментальной ветки */}
      {draft && version && (
        <ExperimentDialog
          open={expOpen}
          onOpenChange={setExpOpen}
          parent={documents.flatMap((d) => d.versions).find((v) => v.id === draft.parentId) ?? version}
          draft={draft}
          onDraftChange={onDraftChange}
          onPreviewImpact={() => void previewImpact()}
          onSave={() => void saveBranch()}
          previewBusy={impactBusy}
          saveBusy={saveBusy}
        />
      )}
    </div>
  )
}
