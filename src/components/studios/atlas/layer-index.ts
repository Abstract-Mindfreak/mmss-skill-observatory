// Client-side layer index for the Instruction Atlas.
// The local-structural analysis result is not part of /api/state, and there is
// no GET endpoint for it — the agreed approach is to call
// POST /api/versions/{id}/analyze once per version per page session
// (idempotent local computation, ~150-600ms; it replaces the previous
// local-structural analysis row) and cache the built index module-side.

import type {
  ConflictCandidate,
  FragmentAnnotation,
  LayerBasis,
  LayerId,
  LocalAnalysisResult,
} from '@/lib/types'

/** All 15 layers in a stable display order. */
export const LAYER_IDS: LayerId[] = [
  'obligation',
  'prohibition',
  'permission',
  'recommendation',
  'condition',
  'exception',
  'definition',
  'identifier',
  'evidence',
  'unknown',
  'ambiguity',
  'repetition',
  'conflict',
  'missing-link',
  'coverage',
]

/** Priority for the underline when several active layers match one fragment (strongest first). */
export const LAYER_PRIORITY: LayerId[] = [
  'prohibition',
  'obligation',
  'permission',
  'recommendation',
  'exception',
  'condition',
  'definition',
  'evidence',
  'unknown',
  'ambiguity',
  'repetition',
  'conflict',
  'missing-link',
  'coverage',
  'identifier',
]

export const DEFAULT_ACTIVE_LAYERS: LayerId[] = ['obligation', 'prohibition']

export const LAYER_HINTS: Record<LayerId, string> = {
  obligation: 'Обязательные действия (must, required, always…)',
  prohibition: 'Запреты (do not, never, cannot…)',
  permission: 'Разрешения (may, can, is allowed…)',
  recommendation: 'Рекомендации (prefer, should, consider…)',
  condition: 'Условия применения (when, if, unless…)',
  exception: 'Исключения из общих правил (unless, except…)',
  definition: 'Определения терминов и перечни значений',
  identifier: 'Устойчивые идентификаторы (кавычки, backticks, капитализированные обороты)',
  evidence: 'Требования к доказательности (verify, evidence, cite…)',
  unknown: 'Работа с неизвестностью (unknown, unavailable, missing…)',
  ambiguity: 'Плотные скопления неоднозначных слов',
  repetition: 'Повторы по лексическому сходству (группы фрагментов)',
  conflict: 'Кандидаты конфликтов: противоположная модальность + общие термы',
  'missing-link': 'Ссылки на отсутствующие разделы документа',
  coverage: 'Фрагменты в разделах, покрытых проверочными сценариями',
}

/** Marker words of special interest (ТЗ п.4 — the word itself is not dangerous, context matters). */
export const MARKER_WORDS = [
  'must',
  'should',
  'may',
  'always',
  'only',
  'available',
  'sufficient',
  'verified',
  'complete',
  'unknown',
  'guarantee',
]

export interface RepetitionInfo {
  similarity: number
  method: string
  fragmentIds: string[]
}

export interface LayerIndex {
  versionId: string
  analysisId: string
  createdAt: string
  durationMs: number
  methodSummary: string
  limitations: string[]
  fragmentCount: number
  annotations: Map<string, FragmentAnnotation>
  layerCounts: Record<string, number>
  /** repetition groups by member fragment id */
  repetitions: Map<string, RepetitionInfo[]>
  /** conflict candidates by member fragment id */
  conflicts: Map<string, ConflictCandidate[]>
  ambiguityHotspots: Map<string, string[]>
  brokenRefs: { fragmentId: string; ref: string }[]
  unusedDefinitions: { fragmentId: string; term: string }[]
  builtAt: number
}

export type LayerLoadStatus = 'idle' | 'loading' | 'ok' | 'no-analysis' | 'error'

export interface LayerLoadState {
  status: LayerLoadStatus
  index: LayerIndex | null
  error?: string
}

// ---------- module-level session cache (keyed by versionId) ----------

const indexCache = new Map<string, LayerIndex>()

export function getCachedLayerIndex(versionId: string): LayerIndex | null {
  return indexCache.get(versionId) ?? null
}

export function cacheLayerIndex(index: LayerIndex): void {
  indexCache.set(index.versionId, index)
}

export function buildLayerIndex(versionId: string, result: LocalAnalysisResult): LayerIndex {
  const annotations = new Map<string, FragmentAnnotation>()
  for (const a of result.annotations ?? []) annotations.set(a.fragmentId, a)

  const repetitions = new Map<string, RepetitionInfo[]>()
  for (const g of result.repetitions ?? []) {
    for (const fid of g.fragmentIds) {
      const list = repetitions.get(fid) ?? []
      list.push({ similarity: g.similarity, method: g.method, fragmentIds: g.fragmentIds })
      repetitions.set(fid, list)
    }
  }

  const conflicts = new Map<string, ConflictCandidate[]>()
  for (const c of result.conflictCandidates ?? []) {
    for (const fid of [c.aFragmentId, c.bFragmentId]) {
      const list = conflicts.get(fid) ?? []
      list.push(c)
      conflicts.set(fid, list)
    }
  }

  const layerCounts: Record<string, number> = { ...(result.layerCounts ?? {}) }
  // live counts for group-based layers: unique member fragments
  layerCounts.repetition = repetitions.size
  layerCounts.conflict = conflicts.size

  return {
    versionId,
    analysisId: result.analysisId,
    createdAt: result.createdAt,
    durationMs: result.durationMs,
    methodSummary: result.methodSummary,
    limitations: result.limitations ?? [],
    fragmentCount: result.fragmentCount,
    annotations,
    layerCounts,
    repetitions,
    conflicts,
    ambiguityHotspots: new Map((result.ambiguityHotspots ?? []).map((h) => [h.fragmentId, h.markers])),
    brokenRefs: result.brokenRefs ?? [],
    unusedDefinitions: result.unusedDefinitions ?? [],
    builtAt: Date.now(),
  }
}

/** Strongest layer of the given set according to LAYER_PRIORITY. */
export function strongestLayer(layers: LayerId[]): LayerId | null {
  for (const l of LAYER_PRIORITY) {
    if (layers.includes(l)) return l
  }
  return null
}

export interface LayerInfo {
  layer: LayerId
  basis: LayerBasis
}

/**
 * Full layer list of a fragment: annotation layers (with backend basis) plus
 * group-derived layers (repetition, conflict) and live scenario coverage.
 */
export function fragmentLayerInfos(
  index: LayerIndex | null,
  fragmentId: string,
  coverageSet: ReadonlySet<string>
): LayerInfo[] {
  const out: LayerInfo[] = []
  const ann = index?.annotations.get(fragmentId)
  if (ann) {
    for (const b of ann.layers) out.push({ layer: b.layer, basis: b })
  }
  const reps = index?.repetitions.get(fragmentId)
  if (reps) {
    for (const r of reps) {
      out.push({
        layer: 'repetition',
        basis: {
          layer: 'repetition',
          matched: [],
          reason: `Повторяет ${r.fragmentIds.length - 1} ${
            r.fragmentIds.length - 1 === 1 ? 'фрагмент' : 'фрагмента(ов)'
          } документа по лексическому сходству ${r.similarity.toFixed(2)}`,
          limitations: r.method,
        },
      })
    }
  }
  const confs = index?.conflicts.get(fragmentId)
  if (confs) {
    for (const c of confs) {
      out.push({
        layer: 'conflict',
        basis: {
          layer: 'conflict',
          matched: c.sharedTerms,
          reason: c.clashConditions,
          limitations: `${c.basis}. Подозрение снимается, если: ${c.acquittalCondition}`,
        },
      })
    }
  }
  if (coverageSet.has(fragmentId)) {
    out.push({
      layer: 'coverage',
      basis: {
        layer: 'coverage',
        matched: [],
        reason: 'Раздел, содержащий фрагмент, покрыт проверочными сценариями',
        limitations:
          'Покрытие относится к разделу в целом, а не к отдельному предложению; наличие сценария не равно пройденной проверке',
      },
    })
  }
  return out
}
