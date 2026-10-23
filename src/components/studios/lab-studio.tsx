// Behavior Lab — лаборатория поведения (ТЗ п.9): слева запуск и роли,
// справа список запусков и деталь выбранного запуска.
'use client'

import * as React from 'react'
import { FlaskConical } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ErrorState } from '@/components/shared/states'
import { SectionHeader } from '@/components/shared/misc'
import { StatusBadge } from '@/components/shared/status-badges'
import { useStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { RunLauncher } from './lab/launcher'
import { RolesSection } from './lab/role-cards'
import { RunsList } from './lab/runs-list'
import { RunDetail } from './lab/run-detail'

export default function LabStudio() {
  const appState = useStore((s) => s.appState)
  const loadError = useStore((s) => s.loadError)
  const refresh = useStore((s) => s.refresh)
  const selectedRunId = useStore((s) => s.selectedRunId)
  const codemapReturnCampaignId = useStore((s) => s.codemapReturnCampaignId)
  const setStudio = useStore((s) => s.setStudio)

  if (loadError && !appState) {
    return <ErrorState error={loadError} title="Не удалось загрузить данные проекта" onRetry={() => void refresh()} />
  }
  if (!appState?.project) {
    return (
      <ErrorState
        title="Нет активного проекта"
        error="Создайте проект или импортируйте архив — лаборатория работает внутри проекта."
      />
    )
  }

  const realRuns = appState.runs.filter((r) => r.origin === 'real').length
  const running = appState.runs.filter((r) => r.status === 'running' || r.status === 'queued').length

  return (
    <div className="space-y-4 py-2">
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            <FlaskConical className="size-5 text-primary" aria-hidden />
            Behavior Lab
          </span>
        }
        description="Запуски ролей на реальных моделях, локальные программные проверки и вердикты. Статус выполнения ≠ вердикт проверки: завершённая проверка может обнаружить дефект."
        badges={
          <>
            <StatusBadge status="LIVE" withHint={false} />
            <Badge variant="secondary" className="text-[10px]">
              {realRuns} запусков (реальные)
            </Badge>
            {running > 0 && (
              <Badge variant="outline" className="gap-1 text-[10px] text-teal-600 dark:text-teal-300">
                <span className="pulse-dot size-1.5 rounded-full bg-teal-400" aria-hidden />
                активных: {running}
              </Badge>
            )}
          </>
        }
        actions={codemapReturnCampaignId ? <Button size="sm" variant="outline" onClick={() => setStudio('research')}>Вернуться к кампании</Button> : undefined}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(340px,5fr)_minmax(0,7fr)]">
        <div className="min-w-0 space-y-4">
          <RunLauncher />
          <RolesSection />
        </div>
        <div className="min-w-0 space-y-4">
          <RunsList />
          <RunDetail runId={selectedRunId} />
        </div>
      </div>
    </div>
  )
}
