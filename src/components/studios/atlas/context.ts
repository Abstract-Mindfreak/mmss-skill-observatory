// Atlas studio context: shared state for outline / reading pane / fragment card.

'use client'

import * as React from 'react'
import type { FragmentDTO, LayerId } from '@/lib/types'
import type { DocStructure } from './doc-structure'
import type { LayerIndex } from './layer-index'

export type AtlasZoom = 'document' | 'sections' | 'paragraphs' | 'sentences' | 'words'

export interface WordInspectState {
  word: string
  count: number
  sentences: FragmentDTO[]
  isMarker: boolean
  x: number
  y: number
}

export interface AtlasContextValue {
  structure: DocStructure
  layerIndex: LayerIndex | null
  layersAvailable: boolean
  coverageSet: Set<string>
  /** section path -> number of linked scenarios (prefix match) */
  linkedSections: Map<string, number>
  activeLayers: ReadonlySet<LayerId>
  zoom: AtlasZoom
  query: string
  selectedFragmentId: string | null
  selectedSectionPath: string | null
  expandedSections: ReadonlySet<string>
  projectId: string
  selectFragment: (id: string) => void
  toggleSection: (path: string) => void
  selectSection: (path: string) => void
  toggleLayer: (layer: LayerId) => void
  setLayersPreset: (mode: 'all' | 'default') => void
  setZoom: (z: AtlasZoom) => void
  setQuery: (q: string) => void
  wordInspect: WordInspectState | null
  setWordInspect: (s: WordInspectState | null) => void
}

export const AtlasContext = React.createContext<AtlasContextValue | null>(null)

export function useAtlas(): AtlasContextValue {
  const v = React.useContext(AtlasContext)
  if (!v) throw new Error('useAtlas: компонент используется вне AtlasContext')
  return v
}
