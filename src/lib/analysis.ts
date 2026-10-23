// Local structural analysis: marker-based layer classification, lexical
// repetition search, conflict-candidate heuristics, reference checking.
// Works on in-memory fragment lists so it can be reused for impact previews.

import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import type { ParsedFragment } from '@/lib/parser'
import type {
  ConflictCandidate,
  FragmentAnnotation,
  LayerBasis,
  LayerId,
  LocalAnalysisResult,
  RepetitionGroup,
} from '@/lib/types'

export type AnalyzableFragment = ParsedFragment & { id: string }

export interface AnalysisSection {
  path: string
  title: string | null
}

export interface AnalysisScenario {
  id: string
  title: string
  fragmentId: string | null
  /** Pre-resolved section path of the linked fragment (for in-memory runs). */
  sectionPath?: string | null
}

export type CoreAnalysisResult = Omit<
  LocalAnalysisResult,
  'analysisId' | 'versionId' | 'createdAt' | 'durationMs'
>

// ---------- shared helpers ----------

/** First 1-2 path components that match an existing section. */
export function sectionPathOf(path: string, sectionPaths: Set<string>): string | null {
  const comps = path.split('.')
  if (comps.length >= 2) {
    const two = `${comps[0]}.${comps[1]}`
    if (sectionPaths.has(two)) return two
  }
  if (sectionPaths.has(comps[0])) return comps[0]
  return null
}

function uniq(items: string[]): string[] {
  return [...new Set(items)]
}

function collectMatches(text: string, re: RegExp): string[] {
  const out: string[] = []
  for (const m of text.matchAll(re)) out.push(m[0])
  return uniq(out)
}

const MARKER_WORDS = [
  'must', 'shall', 'should', 'may', 'can', 'cannot', 'required', 'require',
  'allowed', 'permitted', 'prohibited', 'forbidden', 'always', 'never', 'only',
  'available', 'unavailable', 'sufficient', 'insufficient', 'verified',
  'complete', 'incomplete', 'unknown', 'guarantee', 'ensure', 'necessary',
  'optional', 'explicit', 'implicitly', 'silently', 'fabricate', 'invent',
  'preserve', 'evidence', 'provenance', 'checked', 'executed',
]

const AMBIGUITY_MARKERS = [
  'appropriate', 'reasonable', 'suitable', 'relevant', 'materially',
  'significantly', 'when needed', 'as needed', 'properly', 'correct',
  'correctly', 'good', 'better', 'best', 'useful', 'important', 'clear',
  'clearly', 'ordinary', 'focused',
]

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'where',
  'while', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'as',
  'is', 'are', 'be', 'been', 'was', 'were', 'am', 'it', 'its', 'this', 'that',
  'these', 'those', 'not', 'no', 'nor', 'do', 'does', 'did', 'done', 'can',
  'could', 'may', 'might', 'must', 'shall', 'should', 'will', 'would', 'use',
  'used', 'uses', 'using', 'than', 'each', 'every', 'any', 'all', 'some',
  'such', 'only', 'also', 'into', 'within', 'without', 'between', 'per',
  'via', 'one', 'two', 'three', 'new', 'other', 'same', 'more', 'most',
  'less', 'least', 'own', 'so', 'up', 'down', 'out', 'over', 'under', 'again',
  'further', 'once', 'here', 'there', 'why', 'how', 'both', 'few', 'too',
  'very', 'just', 'because', 'until', 'against', 'above', 'below', 'before',
  'after', 'during', 'through', 'has', 'have', 'had', 'having', 'they',
  'them', 'their', 'we', 'our', 'you', 'your', 'he', 'she', 'his', 'her',
  'who', 'whom', 'which', 'what', 'whose', 'does', 'does', 'it',
])

// crude stemming: cut trailing ing/ed/es/s
function stem(token: string): string {
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3)
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2)
  if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2)
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1)
  return token
}

function lexicalTokens(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of text.toLowerCase().split(/[^a-z0-9-]+/)) {
    if (raw.length < 2) continue
    const t = stem(raw)
    if (t.length < 2 || STOPWORDS.has(t) || STOPWORDS.has(raw)) continue
    out.add(t)
  }
  return out
}

function extractTerms(text: string): string[] {
  const terms = new Set<string>()
  for (const m of text.matchAll(/`([^`\n]{1,60})`/g)) {
    const t = m[1].trim()
    if (t.length >= 2) terms.add(t)
  }
  // quoted phrases starting with a capital letter (1..6 words)
  for (const m of text.matchAll(/"((?:[A-Z][A-Za-z0-9-]*)(?:\s+[A-Za-z0-9-]+){0,5})"/g)) {
    if (m[1].length >= 3) terms.add(m[1])
  }
  // hyphenated identifiers with an ALL-CAPS component (e.g. MMSS-json)
  for (const m of text.matchAll(/\b([A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)\b/g)) {
    const parts = m[1].split('-')
    if (parts.some((p) => /^[A-Z]{2,}$/.test(p))) terms.add(m[1])
  }
  // camelCase / snake_case tokens
  for (const m of text.matchAll(/\b([a-z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*|_[a-z0-9]+)+)\b/g)) {
    terms.add(m[1])
  }
  // SCREAMING_SNAKE identifiers
  for (const m of text.matchAll(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g)) {
    terms.add(m[1])
  }
  // ALL-CAPS acronyms, length >= 2
  for (const m of text.matchAll(/\b([A-Z]{2,}[0-9]*)\b/g)) {
    terms.add(m[1])
  }
  return [...terms]
}

const SECTION_REF_RE = /\bSection (\d+(?:\.\d+)?)|§(\d+(?:\.\d+)?)/g

// ---------- layer heuristics ----------

const LAYER_META: Record<string, { reason: string; limitations: string }> = {
  prohibition: {
    reason: 'маркеры запрета',
    limitations: 'совпадение по регулярному выражению: отрицание может относиться к другому объекту или входить в устойчивый оборот',
  },
  obligation: {
    reason: 'модальные маркеры обязательства',
    limitations: 'модальный глагол может выражать не только обязанность; контекст предложения не анализируется',
  },
  permission: {
    reason: 'маркеры разрешения',
    limitations: 'слово may/can в английском многозначно — интерпретация контекстная',
  },
  recommendation: {
    reason: 'маркеры рекомендации',
    limitations: 'should может выражать и совет, и ожидание; сила требования не определена',
  },
  condition: {
    reason: 'маркеры условия',
    limitations: 'маркер не гарантирует условную семантику',
  },
  exception: {
    reason: 'маркеры исключения',
    limitations: 'слова however/instead могут связывать предложения, не вводя исключение из правила',
  },
  definition: {
    reason: 'маркеры определения термина',
    limitations: 'оборот определения или перечень значений может быть примером, а не определением',
  },
  identifier: {
    reason: 'устойчивый идентификатор: обратные кавычки или имя из 2–4 слов в кавычках',
    limitations: 'выделение идентификатора по синтаксису; имя может быть случайным совпадением',
  },
  evidence: {
    reason: 'маркеры доказательности и проверки',
    limitations: 'наличие слова не означает, что проверка выполнена',
  },
  unknown: {
    reason: 'маркеры неизвестности',
    limitations: 'слово может относиться к предметной области, а не к статусу знания',
  },
  ambiguity: {
    reason: 'плотность маркеров неопределённости',
    limitations: 'порог «2 разных маркера» — эвристика; субъективные оценки в тексте часто уместны',
  },
}

function basis(layer: LayerId, matched: string[]): LayerBasis {
  const meta = LAYER_META[layer]
  return { layer, matched, reason: meta.reason, limitations: meta.limitations }
}

function obligationMatches(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\b(?:must|shall)\b|is required|required to|has to|is mandatory/gi)) {
    if (/^(must|shall)$/i.test(m[0])) {
      const rest = text.slice((m.index ?? 0) + m[0].length)
      if (/^\s+not\b/i.test(rest)) continue // 'must not' handled by prohibition
    }
    out.push(m[0])
  }
  return uniq(out)
}

function isEnumLikeItem(text: string): boolean {
  const stripped = text.replace(/[.:;,]+$/, '').trim()
  return /^[a-z][a-z0-9_-]*$/.test(stripped) && stripped.length <= 25
}

// ---------- core analysis (in-memory) ----------

export function analyzeParsed(
  fragments: AnalyzableFragment[],
  sections: Map<string, AnalysisSection>,
  scenarios: AnalysisScenario[]
): CoreAnalysisResult {
  const leaves = fragments.filter(
    (f) => f.kind === 'sentence' || f.kind === 'list_item'
  )
  const sectionPaths = new Set(sections.keys())
  const fragmentById = new Map(fragments.map((f) => [f.id, f]))

  // sections whose body is a dictionary-like list of short values
  const enumSections = new Set<string>()
  {
    const perSection: Map<string, number> = new Map()
    for (const leaf of leaves) {
      if (leaf.kind !== 'list_item' || !isEnumLikeItem(leaf.text)) continue
      const sp = sectionPathOf(leaf.path, sectionPaths)
      if (!sp) continue
      perSection.set(sp, (perSection.get(sp) ?? 0) + 1)
    }
    for (const [sp, count] of perSection) {
      if (count >= 3) enumSections.add(sp)
    }
  }

  // scenario-covered sections
  const coveredSections = new Set<string>()
  for (const sc of scenarios) {
    if (sc.fragmentId && fragmentById.has(sc.fragmentId)) {
      const sp = sectionPathOf(fragmentById.get(sc.fragmentId)!.path, sectionPaths)
      if (sp) coveredSections.add(sp)
    } else if (sc.sectionPath) {
      coveredSections.add(sc.sectionPath)
    }
  }

  const annotations: FragmentAnnotation[] = []
  const annotationsById = new Map<string, FragmentAnnotation>()
  const termFragments = new Map<string, Set<string>>()
  const ambiguityHotspots: { fragmentId: string; markers: string[] }[] = []

  for (const leaf of leaves) {
    const text = leaf.text
    const layers: LayerBasis[] = []

    const markers: string[] = []
    for (const word of MARKER_WORDS) {
      if (new RegExp(`\\b${word}\\b`, 'i').test(text)) markers.push(word)
    }

    const prohibition = collectMatches(
      text,
      /must not|shall not|do not|don't|never \w|cannot|can not|may not|is prohibited|forbidden|not allowed|do not fabricate/gi
    )
    if (prohibition.length > 0) layers.push(basis('prohibition', prohibition))

    const obligation = obligationMatches(text)
    if (obligation.length > 0) layers.push(basis('obligation', obligation))

    const permission = collectMatches(
      text,
      /\bmay\b(?!.{0,4}\bnot\b)|\ballowed\b|permitted|optional/gi
    )
    if (permission.length > 0) layers.push(basis('permission', permission))

    const recommendation = collectMatches(
      text,
      /\bshould\b|prefer(?:s|red|rence)?|recommended|when possible|when useful|where appropriate/gi
    )
    if (recommendation.length > 0) layers.push(basis('recommendation', recommendation))

    const condition = collectMatches(
      text,
      /\bif\b|\bwhen\b|\bunless\b|\bwhere\b|in case|provided that|otherwise/gi
    )
    if (condition.length > 0) layers.push(basis('condition', condition))

    const exception = collectMatches(
      text,
      /except|unless|other than|instead of|however|nevertheless|only when|only if|in that case/gi
    )
    if (exception.length > 0) layers.push(basis('exception', exception))

    const definition = collectMatches(
      text,
      /is defined as|\bmeans\b|refers to|treat [^.]* as|project-defined|is considered|denotes|may identify/gi
    )
    const leafSection = sectionPathOf(leaf.path, sectionPaths)
    const enumDefinition =
      leaf.kind === 'list_item' && leafSection !== null &&
      enumSections.has(leafSection) && isEnumLikeItem(leaf.text)
    if (enumDefinition && definition.length === 0) {
      definition.push(leaf.text.trim())
    }
    if (definition.length > 0) layers.push(basis('definition', definition))

    const terms = extractTerms(text)
    const hasBacktick = /`[^`\n]+`/.test(text)
    const hasQuotedName = /"(?:[A-Z][A-Za-z0-9-]*\s+){1,3}[A-Z][A-Za-z0-9-]*"/.test(text)
    if (hasBacktick || hasQuotedName) {
      layers.push(basis('identifier', collectMatches(text, /`[^`\n]+`|"(?:[A-Z][A-Za-z0-9-]*\s+){1,3}[A-Z][A-Za-z0-9-]*"/g)))
    }

    const evidence = collectMatches(
      text,
      /verif|evidence|provenance|check|execut|measured|observed|tested|validat|inspect/gi
    )
    if (evidence.length > 0) layers.push(basis('evidence', evidence))

    const unknownMarkers = collectMatches(
      text,
      /unknown|not known|cannot be established|unavailable|no data|not available|unclear|cannot be determined/gi
    )
    if (unknownMarkers.length > 0) layers.push(basis('unknown', unknownMarkers))

    const ambiguityFound: string[] = []
    for (const marker of AMBIGUITY_MARKERS) {
      const re = marker.includes(' ')
        ? new RegExp(marker.replace(/ /g, '\\s+'), 'i')
        : new RegExp(`\\b${marker}\\b`, 'i')
      if (re.test(text)) ambiguityFound.push(marker)
    }
    if (ambiguityFound.length >= 2) {
      layers.push(basis('ambiguity', ambiguityFound))
      ambiguityHotspots.push({ fragmentId: leaf.id, markers: ambiguityFound })
    }

    const sectionRefs: string[] = []
    for (const m of text.matchAll(SECTION_REF_RE)) {
      sectionRefs.push(m[0])
    }

    for (const term of terms) {
      if (!termFragments.has(term)) termFragments.set(term, new Set())
      termFragments.get(term)!.add(leaf.id)
    }

    const annotation: FragmentAnnotation = {
      fragmentId: leaf.id,
      layers,
      terms,
      sectionRefs,
      markers,
    }
    annotations.push(annotation)
    annotationsById.set(leaf.id, annotation)
  }

  // ---------- repetitions (pairwise Jaccard + transitive clustering) ----------
  const leafTokens = new Map<string, Set<string>>()
  for (const leaf of leaves) leafTokens.set(leaf.id, lexicalTokens(leaf.text))
  const similarPairs: { a: string; b: string; similarity: number }[] = []
  for (let i = 0; i < leaves.length; i++) {
    const a = leaves[i]
    const ta = leafTokens.get(a.id)!
    if (ta.size === 0) continue
    for (let j = i + 1; j < leaves.length; j++) {
      const b = leaves[j]
      const tb = leafTokens.get(b.id)!
      if (tb.size === 0) continue
      const minSize = Math.min(ta.size, tb.size)
      const maxSize = Math.max(ta.size, tb.size)
      if (minSize / maxSize < 0.55) continue // Jaccard upper bound
      let inter = 0
      for (const t of ta) if (tb.has(t)) inter++
      const union = ta.size + tb.size - inter
      if (union === 0) continue
      const similarity = inter / union
      if (similarity >= 0.55) {
        similarPairs.push({ a: a.id, b: b.id, similarity: Math.round(similarity * 100) / 100 })
      }
    }
  }

  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root)!
    let cur = x
    while (parent.get(cur) !== cur) {
      const next = parent.get(cur)!
      parent.set(cur, root)
      cur = next
    }
    return root
  }
  const union = (x: string, y: string) => {
    const rx = find(x)
    const ry = find(y)
    if (rx !== ry) parent.set(rx, ry)
  }
  for (const leaf of leaves) parent.set(leaf.id, leaf.id)
  for (const pair of similarPairs) union(pair.a, pair.b)
  const clusters = new Map<string, string[]>()
  for (const leaf of leaves) {
    const root = find(leaf.id)
    if (!clusters.has(root)) clusters.set(root, [])
    clusters.get(root)!.push(leaf.id)
  }
  const repetitions: RepetitionGroup[] = []
  for (const members of clusters.values()) {
    if (members.length < 2) continue
    const memberSet = new Set(members)
    const pairSims = similarPairs
      .filter((p) => memberSet.has(p.a) && memberSet.has(p.b))
      .map((p) => p.similarity)
    const similarity =
      pairSims.length > 0
        ? Math.round((pairSims.reduce((s, v) => s + v, 0) / pairSims.length) * 100) / 100
        : 0
    repetitions.push({
      fragmentIds: members,
      similarity,
      method: 'Жаккард по лексическим токенам с простым стеммингом; сходство в этом представлении, не доказательство смысловой эквивалентности',
    })
  }
  repetitions.sort((x, y) => y.fragmentIds.length - x.fragmentIds.length)

  // ---------- conflict candidates ----------
  const leafCount = Math.max(1, leaves.length)
  const significantTerm = (term: string): boolean => {
    if (term.length < 4) return false
    if (STOPWORDS.has(term.toLowerCase())) return false
    const df = termFragments.get(term)?.size ?? 0
    return df <= leafCount * 0.3
  }
  const conflictCandidates: ConflictCandidate[] = []
  {
    const prohibitionLeaves = leaves.filter((l) =>
      annotationsById.get(l.id)?.layers.some((x) => x.layer === 'prohibition')
    )
    const opposingLeaves = leaves.filter((l) => {
      const ls = annotationsById.get(l.id)?.layers ?? []
      return ls.some((x) => x.layer === 'permission' || x.layer === 'obligation')
    })
    const byProhibition: Map<string, string[]> = new Map() // term -> prohibition leaf ids
    for (const p of prohibitionLeaves) {
      for (const term of annotationsById.get(p.id)?.terms ?? []) {
        if (!significantTerm(term)) continue
        if (!byProhibition.has(term)) byProhibition.set(term, [])
        byProhibition.get(term)!.push(p.id)
      }
    }
    const byOpposing: Map<string, string[]> = new Map() // term -> opposing leaf ids
    for (const o of opposingLeaves) {
      for (const term of annotationsById.get(o.id)?.terms ?? []) {
        if (!significantTerm(term)) continue
        if (!byOpposing.has(term)) byOpposing.set(term, [])
        byOpposing.get(term)!.push(o.id)
      }
    }
    const seen = new Set<string>()
    const ranked: { a: string; b: string; shared: string[]; rarity: number }[] = []
    for (const [term, pros] of byProhibition) {
      const opps = byOpposing.get(term)
      if (!opps) continue
      const rarity = termFragments.get(term)?.size ?? 999
      for (const a of pros) {
        for (const b of opps) {
          if (a === b) continue
          const key = a < b ? `${a}|${b}` : `${b}|${a}`
          if (seen.has(key)) continue
          seen.add(key)
          const aTerms = new Set(annotationsById.get(a)?.terms ?? [])
          const bTerms = new Set(annotationsById.get(b)?.terms ?? [])
          const shared = [...aTerms].filter((t) => bTerms.has(t) && significantTerm(t))
          if (shared.length === 0) continue
          ranked.push({ a, b, shared, rarity })
        }
      }
    }
    ranked.sort((x, y) => x.rarity - y.rarity)
    for (const cand of ranked.slice(0, 25)) {
      const aMatched =
        annotationsById.get(cand.a)?.layers.find((l) => l.layer === 'prohibition')?.matched[0] ?? ''
      const bLayers = annotationsById.get(cand.b)?.layers ?? []
      const bMatched =
        bLayers.find((l) => l.layer === 'prohibition')?.matched[0] ??
        bLayers.find((l) => l.layer === 'obligation')?.matched[0] ??
        bLayers.find((l) => l.layer === 'permission')?.matched[0] ??
        ''
      const term = cand.shared[0]
      conflictCandidates.push({
        aFragmentId: cand.a,
        bFragmentId: cand.b,
        sharedTerms: cand.shared,
        clashConditions: `Фрагмент A содержит «${aMatched}», фрагмент B — «${bMatched}» при общем термине «${term}»: требования могут столкнуться, если оба применяются к одной операции/артефакту одновременно`,
        acquittalCondition:
          'Если области действия различны (разные контракты, этапы или типы артефактов), требования совместимы',
        basis: 'эвристика: противоположная модальность + общий значимый термин; не логический анализ — подтверждение требует сценария',
      })
    }
  }

  // ---------- unused definitions ----------
  const unusedDefinitions: { fragmentId: string; term: string }[] = []
  {
    const seen = new Set<string>()
    for (const ann of annotations) {
      const isDefinition = ann.layers.some((l) => l.layer === 'definition')
      if (!isDefinition) continue
      for (const term of ann.terms) {
        const df = termFragments.get(term)?.size ?? 0
        if (df === 1 && !seen.has(`${ann.fragmentId}|${term}`)) {
          seen.add(`${ann.fragmentId}|${term}`)
          unusedDefinitions.push({ fragmentId: ann.fragmentId, term })
        }
      }
    }
  }

  // ---------- broken section references ----------
  const brokenRefs: { fragmentId: string; ref: string }[] = []
  for (const ann of annotations) {
    for (const ref of ann.sectionRefs) {
      const num = /(?:Section |§)(\d+(?:\.\d+)?)/.exec(ref)?.[1]
      if (num && !sectionPaths.has(num)) {
        brokenRefs.push({ fragmentId: ann.fragmentId, ref })
      }
    }
  }

  // ---------- layer counts ----------
  const layerCounts: Record<string, number> = {}
  for (const key of [
    'obligation', 'prohibition', 'permission', 'recommendation', 'condition',
    'exception', 'definition', 'identifier', 'evidence', 'unknown', 'ambiguity',
    'repetition', 'conflict', 'missing-link', 'coverage',
  ]) {
    layerCounts[key] = 0
  }
  let coverageCount = 0
  for (const ann of annotations) {
    for (const layer of ann.layers) {
      layerCounts[layer.layer] = (layerCounts[layer.layer] ?? 0) + 1
    }
    const sp = sectionPathOf(fragmentById.get(ann.fragmentId)?.path ?? '', sectionPaths)
    if (sp && coveredSections.has(sp)) coverageCount++
  }
  layerCounts['coverage'] = coverageCount
  const repetitionIds = new Set(repetitions.flatMap((r) => r.fragmentIds))
  layerCounts['repetition'] = repetitionIds.size
  layerCounts['conflict'] = new Set(
    conflictCandidates.flatMap((c) => [c.aFragmentId, c.bFragmentId])
  ).size

  return {
    methodSummary:
      'Локальный структурный анализ: разбор Markdown на разделы/абзацы/предложения; классификация по маркерам модальности и служебным словам; поиск повторов по лексическому сходству Жаккара; поиск кандидатов конфликтов по противоположной модальности с общими терминами; проверка ссылок на разделы.',
    limitations: [
      'Классификация по регулярным выражениям не понимает контекст полностью',
      'Лексическое сходство не является семантической эквивалентностью',
      'Кандидаты конфликтов — гипотезы, требующие проверки сценарием',
      'Английский текст; для других языков покрытие маркеров неполное',
    ],
    fragmentCount: fragments.length,
    annotations,
    layerCounts,
    repetitions,
    conflictCandidates,
    unusedDefinitions,
    brokenRefs,
    ambiguityHotspots,
  }
}

export function buildAnalysisSummary(core: CoreAnalysisResult): string {
  const c = core.layerCounts
  return [
    `Локальный структурный анализ: ${core.fragmentCount} фрагментов, из них листовых классифицируемых ${core.annotations.length}.`,
    `Слои: обязательства ${c.obligation ?? 0}, запреты ${c.prohibition ?? 0}, разрешения ${c.permission ?? 0}, рекомендации ${c.recommendation ?? 0}, условия ${c.condition ?? 0}, исключения ${c.exception ?? 0}, определения ${c.definition ?? 0}, доказательность ${c.evidence ?? 0}, неизвестность ${c.unknown ?? 0}.`,
    `Горячие точки неоднозначности: ${core.ambiguityHotspots.length}; группы повторов: ${core.repetitions.length}; кандидаты конфликтов: ${core.conflictCandidates.length}; битые ссылки на разделы: ${core.brokenRefs.length}; неиспользуемые определения: ${core.unusedDefinitions.length}.`,
  ].join(' ')
}

// ---------- persisted analysis ----------

export async function runLocalAnalysis(
  versionId: string
): Promise<{ result: LocalAnalysisResult; durationMs: number }> {
  const version = await db.documentVersion.findUnique({ where: { id: versionId } })
  if (!version) throw new Error('Версия не найдена')
  const fragments = await db.fragment.findMany({
    where: { versionId },
    orderBy: { order: 'asc' },
  })
  const scenarios = await db.scenario.findMany({
    where: { projectId: version.projectId },
  })

  const sections = new Map<string, AnalysisSection>()
  for (const f of fragments) {
    if (f.kind === 'section' && !sections.has(f.path)) {
      sections.set(f.path, { path: f.path, title: f.title })
    }
  }
  const sectionPaths = new Set(sections.keys())
  const fragmentById = new Map(fragments.map((f) => [f.id, f]))
  const scenarioInput: AnalysisScenario[] = scenarios.map((s) => ({
    id: s.id,
    title: s.title,
    fragmentId: s.fragmentId,
    sectionPath:
      s.fragmentId && fragmentById.has(s.fragmentId)
        ? sectionPathOf(fragmentById.get(s.fragmentId)!.path, sectionPaths)
        : null,
  }))

  const started = Date.now()
  const analyzable: AnalyzableFragment[] = fragments.map((f) => ({
    id: f.id,
    kind: f.kind as AnalyzableFragment['kind'],
    path: f.path,
    order: f.order,
    title: f.title,
    text: f.text,
    startLine: f.startLine,
    endLine: f.endLine,
    meta: JSON.parse(f.meta || '{}'),
  }))
  const core = analyzeParsed(analyzable, sections, scenarioInput)
  const durationMs = Math.max(1, Date.now() - started)

  const analysisId = randomUUID()
  const createdAt = new Date()
  const result: LocalAnalysisResult = {
    ...core,
    analysisId,
    versionId,
    createdAt: createdAt.toISOString(),
    durationMs,
  }

  await db.analysis.deleteMany({ where: { versionId, type: 'local-structural' } })
  await db.analysis.create({
    data: {
      id: analysisId,
      versionId,
      projectId: version.projectId,
      type: 'local-structural',
      backend: 'local',
      model: null,
      status: 'completed',
      summary: buildAnalysisSummary(core),
      result: JSON.stringify(result),
      fragmentCount: core.fragmentCount,
      durationMs,
      createdAt,
    },
  })

  return { result, durationMs }
}
