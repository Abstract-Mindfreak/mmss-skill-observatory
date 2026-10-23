// Global client store (Zustand). Data comes from /api/state; studios mutate via
// api-client and call refresh(). Cross-studio selection lives here so context
// is preserved when switching screens (ТЗ п.15: «сохранение рабочего контекста»).

'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { api } from '@/lib/api-client'
import type { AppStateDTO, FragmentCardDTO, GraphData } from '@/lib/types'

export type StudioId =
  | 'research'
  | 'overview'
  | 'atlas'
  | 'graph'
  | 'roads'
  | 'scenario'
  | 'lab'
  | 'evolution'
  | 'metrics'
  | 'connections'
  | 'export'
  | 'registry'
  | 'assistant'
  | 'processes'

export const STUDIO_TITLES: Record<StudioId, string> = {
  research: 'Исследование',
  overview: 'Обзор',
  atlas: 'Instruction Atlas',
  graph: 'Карта правил',
  roads: 'Failure Roads',
  scenario: 'Scenario Tree',
  lab: 'Behavior Lab',
  evolution: 'Evolution Studio',
  metrics: 'Метрики',
  connections: 'Подключения',
  export: 'Экспорт и передача',
  registry: 'Реестр статусов',
  assistant: 'Помощник',
  processes: 'Процессы и очередь',
}

interface SessionCloudState {
  available: boolean
  note: string
  error?: string
}

interface ObservatoryState {
  // ---- data ----
  appState: AppStateDTO | null
  sessionCloud: SessionCloudState | null
  loading: boolean
  loadError: string | null
  fragmentCards: Record<string, FragmentCardDTO>
  graphCache: Record<string, { data: GraphData; loadedAt: number }>
  versionContent: Record<string, string>
  cardLoading: Set<string>

  // ---- ui (persisted) ----
  studio: StudioId
  projectId: string | null
  selectedFragmentId: string | null
  selectedVersionId: string | null
  selectedScenarioId: string | null
  selectedRunId: string | null
  codemapTarget: { kind: 'observation' | 'discrepancy'; id: string; positionId: string } | null
  codemapReturnCampaignId: string | null
  selectedProcessId: string | null

  // ---- actions ----
  init: () => Promise<void>
  refresh: () => Promise<void>
  refreshSessionCloud: () => Promise<void>
  setStudio: (s: StudioId) => void
  setProject: (id: string) => Promise<void>
  selectFragment: (id: string | null) => void
  selectVersion: (id: string | null) => void
  selectScenario: (id: string | null) => void
  selectRun: (id: string | null) => void
  selectCodemapTarget: (target: ObservatoryState['codemapTarget']) => void
  setCodemapReturnCampaign: (id: string | null) => void
  selectProcess: (id: string | null) => void
  goToFragment: (id: string, studio?: StudioId) => void
  loadFragmentCard: (id: string, force?: boolean) => Promise<FragmentCardDTO | null>
  loadGraph: (versionId: string, force?: boolean) => Promise<GraphData | null>
  loadVersionContent: (id: string, force?: boolean) => Promise<string | null>
  invalidateGraph: (versionId?: string) => void
}

export const useStore = create<ObservatoryState>()(
  persist(
    (set, get) => ({
      appState: null,
      sessionCloud: null,
      loading: false,
      loadError: null,
      fragmentCards: {},
      graphCache: {},
      versionContent: {},
      cardLoading: new Set<string>(),

      studio: 'research',
      projectId: null,
      selectedFragmentId: null,
      selectedVersionId: null,
      selectedScenarioId: null,
      selectedRunId: null,
      codemapTarget: null,
      codemapReturnCampaignId: null,
      selectedProcessId: null,

      init: async () => {
        if (get().loading) return
        set({ loading: true, loadError: null })
        try {
          let state = await api.getState(get().projectId ?? undefined)
          if (!state.project) {
            // First open: bootstrap seeds the attached SKILL.md research project
            state = await api.bootstrap()
          }
          set({ appState: state, loading: false })
          void get().refreshSessionCloud()
          // drop persisted selection that no longer exists
          const s = get()
          if (s.selectedVersionId && !state.documents.some((d) => d.versions.some((v) => v.id === s.selectedVersionId))) {
            set({ selectedVersionId: null })
          }
          if (s.selectedFragmentId && !state.fragments.some((f) => f.id === s.selectedFragmentId)) {
            set({ selectedFragmentId: null })
          }
        } catch (e) {
          set({
            loading: false,
            loadError: e instanceof Error ? e.message : 'Неизвестная ошибка загрузки',
          })
        }
      },

      refresh: async () => {
        try {
          const state = await api.getState(get().projectId ?? undefined)
          set({ appState: state })
        } catch (e) {
          set({ loadError: e instanceof Error ? e.message : 'Ошибка обновления' })
        }
      },

      refreshSessionCloud: async () => {
        try {
          const sc = await api.sessionCloud()
          set({ sessionCloud: sc })
        } catch {
          set({ sessionCloud: { available: false, note: 'Не удалось проверить облачный бэкенд' } })
        }
      },

      setStudio: (s) => set({ studio: s }),
      setProject: async (id) => {
        set({ projectId: id, selectedVersionId: null, selectedFragmentId: null, selectedScenarioId: null, selectedRunId: null, fragmentCards: {}, graphCache: {}, versionContent: {} })
        try {
          const state = await api.getState(id)
          set({ appState: state })
        } catch (e) {
          set({ loadError: e instanceof Error ? e.message : 'Ошибка загрузки проекта' })
        }
      },

      selectFragment: (id) => set({ selectedFragmentId: id }),
      selectVersion: (id) => set({ selectedVersionId: id }),
      selectScenario: (id) => set({ selectedScenarioId: id }),
      selectRun: (id) => set({ selectedRunId: id }),
      selectCodemapTarget: (target) => set({ codemapTarget: target }),
      setCodemapReturnCampaign: (id) => set({ codemapReturnCampaignId: id }),
      selectProcess: (id) => set({ selectedProcessId: id }),

      goToFragment: (id, studio) =>
        set({ selectedFragmentId: id, studio: studio ?? 'atlas' }),

      loadFragmentCard: async (id, force) => {
        if (!force && get().fragmentCards[id]) return get().fragmentCards[id]
        if (get().cardLoading.has(id)) return null
        set((s) => ({ cardLoading: new Set([...s.cardLoading, id]) }))
        try {
          const card = await api.fragmentCard(id)
          set((s) => {
            const cards = { ...s.fragmentCards, [id]: card }
            return { fragmentCards: cards }
          })
          return card
        } catch {
          return null
        } finally {
          set((s) => {
            const next = new Set(s.cardLoading)
            next.delete(id)
            return { cardLoading: next }
          })
        }
      },

      loadGraph: async (versionId, force) => {
        const cached = get().graphCache[versionId]
        if (!force && cached && Date.now() - cached.loadedAt < 60_000) return cached.data
        try {
          const data = await api.versionGraph(versionId)
          set((s) => ({
            graphCache: { ...s.graphCache, [versionId]: { data, loadedAt: Date.now() } },
          }))
          return data
        } catch {
          return null
        }
      },

      loadVersionContent: async (id, force) => {
        if (!force && get().versionContent[id]) return get().versionContent[id]
        try {
          const { content } = await api.version(id)
          set((s) => ({ versionContent: { ...s.versionContent, [id]: content } }))
          return content
        } catch {
          return null
        }
      },

      invalidateGraph: (versionId) => {
        if (versionId) {
          const next = { ...get().graphCache }
          delete next[versionId]
          set({ graphCache: next })
        } else {
          set({ graphCache: {} })
        }
      },
    }),
    {
      name: 'observatory-ui',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Rehydrate after mount (page.tsx) to avoid SSR hydration mismatches:
      // the server renders default studio/selection, the client restores the
      // persisted working context right after hydration.
      skipHydration: true,
      migrate: (persistedState) => {
        const state = persistedState as Partial<ObservatoryState> | undefined
        return { ...state, studio: state?.studio === 'overview' ? 'research' : state?.studio ?? 'research' }
      },
      partialize: (s) => ({
        studio: s.studio,
        projectId: s.projectId,
        selectedFragmentId: s.selectedFragmentId,
        selectedVersionId: s.selectedVersionId,
        selectedScenarioId: s.selectedScenarioId,
        selectedRunId: s.selectedRunId,
      }),
    }
  )
)

// ---------- selectors (plain functions to avoid re-render issues) ----------

export function activeVersion(s: ObservatoryState) {
  if (!s.appState) return null
  if (s.selectedVersionId) {
    for (const d of s.appState.documents) {
      const v = d.versions.find((x) => x.id === s.selectedVersionId)
      if (v) return v
    }
  }
  return s.appState.activeVersion
}

export function activeVersionId(s: ObservatoryState): string | null {
  return activeVersion(s)?.id ?? null
}

export function fragmentsOfVersion(s: ObservatoryState): AppStateDTO['fragments'] {
  return s.appState?.fragments ?? []
}

/** Assignment for a role, or null. */
export function assignmentFor(
  s: ObservatoryState,
  role: string
): { backend: string | null; connectionId: string | null; model: string | null } | null {
  const a = s.appState?.assignments.find((x) => x.role === role)
  return a ?? { backend: null, connectionId: null, model: null }
}

/** The version currently being viewed may differ from the project's active version. */
export function isViewingActiveVersion(s: ObservatoryState): boolean {
  const av = activeVersion(s)
  return !s.selectedVersionId || s.selectedVersionId === s.appState?.activeVersion?.id || av?.id === s.appState?.activeVersion?.id
}
