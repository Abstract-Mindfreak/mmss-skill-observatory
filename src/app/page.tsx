'use client'

import * as React from 'react'
import { AppShell } from '@/components/shell/app-shell'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { useStore, type StudioId } from '@/lib/store'
import AtlasStudio from '@/components/studios/atlas-studio'
import GraphStudio from '@/components/studios/graph-studio'
import RoadsStudio from '@/components/studios/roads-studio'
import ScenarioStudio from '@/components/studios/scenario-studio'
import LabStudio from '@/components/studios/lab-studio'
import EvolutionStudio from '@/components/studios/evolution-studio'
import MetricsStudio from '@/components/studios/metrics-studio'
import ConnectionsStudio from '@/components/studios/connections-studio'
import ExportStudio from '@/components/studios/export-studio'
import RegistryStudio from '@/components/studios/registry-studio'
import AssistantStudio from '@/components/studios/assistant-studio'
import OverviewStudio from '@/components/studios/overview-studio'
import ResearchStudio from '@/components/studios/research-studio'
import ProcessCenterStudio from '@/components/studios/process-center-studio'

const STUDIOS: Record<StudioId, React.ComponentType> = {
  research: ResearchStudio,
  overview: OverviewStudio,
  atlas: AtlasStudio,
  graph: GraphStudio,
  roads: RoadsStudio,
  scenario: ScenarioStudio,
  lab: LabStudio,
  evolution: EvolutionStudio,
  metrics: MetricsStudio,
  connections: ConnectionsStudio,
  export: ExportStudio,
  registry: RegistryStudio,
  assistant: AssistantStudio,
  processes: ProcessCenterStudio,
}

export default function Home() {
  const init = useStore((s) => s.init)
  const loading = useStore((s) => s.loading)
  const loadError = useStore((s) => s.loadError)
  const appState = useStore((s) => s.appState)
  const studio = useStore((s) => s.studio)

  React.useEffect(() => {
    // Restore the persisted working context AFTER hydration (avoids SSR mismatch)
    useStore.persist.rehydrate()
    void init()
  }, [init])

  const Studio = STUDIOS[studio] ?? OverviewStudio

  return (
    <AppShell>
      {loading && !appState ? (
        <LoadingState label="Инициализация обсерватории…" />
      ) : loadError && !appState ? (
        <div className="py-8">
          <ErrorState error={loadError} title="Не удалось загрузить исследовательскую среду" onRetry={() => void init()} />
        </div>
      ) : (
        <Studio key={studio} />
      )}
    </AppShell>
  )
}
