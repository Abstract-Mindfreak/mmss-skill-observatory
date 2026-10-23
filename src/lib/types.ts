// ============================================================
// MMSS Skill Observatory — shared types (single source of truth)
// Both backend (API routes) and frontend (studios) import from here.
// Do not duplicate these shapes elsewhere.
// ============================================================

// ---------- Statuses ----------

/** Data provenance / execution mode of a feature or result. */
export type ProvenanceStatus =
  | 'LIVE' // real execution through a connected service
  | 'LOCAL' // real local computation or check
  | 'DEMO' // synthetic data for interface demonstration
  | 'PLACEHOLDER' // function not implemented
  | 'STALE' // result refers to a previous version of input data
  | 'ERROR'; // execution ended with an error

/** Execution lifecycle of a run. Verdict is separate (a completed check may find a defect). */
export type RunStatus =
  | 'planned'
  | 'queued'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type Verdict = 'pass' | 'fail' | 'inconclusive';
export type VerdictBy = 'model' | 'user' | 'program';

/** How a metric value was obtained. */
export type MetricProvenance =
  | 'measured' // direct measurement (e.g. run duration)
  | 'computed' // deterministic computation over stored data
  | 'model-evaluated' // LLM produced the value/judgement
  | 'goal' // proposed target, not a result
  | 'synthetic' // demo data
  | 'no-data'; // no data available

export type Origin = 'real' | 'demo';

// ---------- Layer / statement classification ----------

export type LayerId =
  | 'obligation' // обязательство
  | 'prohibition' // запрет
  | 'permission' // разрешение
  | 'recommendation' // рекомендация
  | 'condition' // условие
  | 'exception' // исключение
  | 'definition' // определение
  | 'identifier' // устойчивый идентификатор
  | 'evidence' // требование к доказательности
  | 'unknown' // неизвестность
  | 'ambiguity' // потенциальная неоднозначность
  | 'repetition' // повторение
  | 'conflict' // возможный конфликт
  | 'missing-link' // отсутствующая связь
  | 'coverage'; // покрытие проверочными сценариями

export const LAYER_TITLES: Record<LayerId, string> = {
  obligation: 'Обязательства',
  prohibition: 'Запреты',
  permission: 'Разрешения',
  recommendation: 'Рекомендации',
  condition: 'Условия',
  exception: 'Исключения',
  definition: 'Определения',
  identifier: 'Устойчивые идентификаторы',
  evidence: 'Требования к доказательности',
  unknown: 'Неизвестности',
  ambiguity: 'Потенциальная неоднозначность',
  repetition: 'Повторения',
  conflict: 'Возможные конфликты',
  'missing-link': 'Отсутствующие связи',
  coverage: 'Покрытие сценариями',
};

/** Why a fragment was assigned a layer — always explainable. */
export interface LayerBasis {
  layer: LayerId;
  /** Matched textual patterns (modal words, markers). */
  matched: string[];
  /** Human-readable explanation (RU) of the classification basis. */
  reason: string;
  /** Limitations of this classification. */
  limitations: string;
}

// ---------- Fragments ----------

export type FragmentKind = 'section' | 'paragraph' | 'sentence' | 'list_item';

export interface FragmentDTO {
  id: string;
  versionId: string;
  kind: FragmentKind;
  path: string; // e.g. "6.2.1.3"
  order: number;
  title: string | null;
  text: string;
  startLine: number;
  endLine: number;
  meta: {
    wordCount?: number;
    listIndex?: number;
    indent?: number;
  };
}

// ---------- Local structural analysis ----------

export interface FragmentAnnotation {
  fragmentId: string;
  layers: LayerBasis[];
  /** Terms defined or used in this fragment (capitalised multi-word terms, quoted ids, backticked ids). */
  terms: string[];
  /** Section references like "Section 16", "§6.2". */
  sectionRefs: string[];
  /** Marker words of special interest (must/should/may/always/only/available/sufficient/verified/complete/unknown/guarantee...). */
  markers: string[];
}

export interface RepetitionGroup {
  fragmentIds: string[];
  /** Lexical similarity (Jaccard over stemmed tokens), 0..1. NOT logical equivalence. */
  similarity: number;
  method: string; // description of similarity computation
}

export interface ConflictCandidate {
  aFragmentId: string;
  bFragmentId: string;
  /** Shared significant terms that caused the pairing. */
  sharedTerms: string[];
  /** Concrete conditions under which the requirements may actually clash (heuristic reconstruction). */
  clashConditions: string;
  /** Condition under which the suspicion is NOT confirmed. */
  acquittalCondition: string;
  basis: string;
}

export interface LocalAnalysisResult {
  analysisId: string;
  versionId: string;
  createdAt: string;
  durationMs: number;
  methodSummary: string; // RU description of the method
  limitations: string[]; // RU list
  fragmentCount: number;
  annotations: FragmentAnnotation[];
  layerCounts: Record<string, number>;
  repetitions: RepetitionGroup[];
  conflictCandidates: ConflictCandidate[];
  /** Defined terms that are never used elsewhere. */
  unusedDefinitions: { fragmentId: string; term: string }[];
  /** Section references pointing to non-existent sections. */
  brokenRefs: { fragmentId: string; ref: string }[];
  /** Sentences with high ambiguity-marker density. */
  ambiguityHotspots: { fragmentId: string; markers: string[] }[];
}

// ---------- Graph ----------

export type GraphNodeKind =
  | 'definition'
  | 'requirement'
  | 'constraint'
  | 'condition'
  | 'exception'
  | 'operation'
  | 'contract'
  | 'validation'
  | 'completion';

export const GRAPH_NODE_KIND_TITLES: Record<GraphNodeKind, string> = {
  definition: 'Определения',
  requirement: 'Требования',
  constraint: 'Ограничения',
  condition: 'Условия',
  exception: 'Исключения',
  operation: 'Операции',
  contract: 'Контракты',
  validation: 'Проверки',
  completion: 'Критерии завершения',
};

export type GraphEdgeKind =
  | 'defines' // определяет
  | 'uses' // использует
  | 'restricts' // ограничивает
  | 'refines' // уточняет
  | 'excepts' // является исключением
  | 'depends-on' // зависит от
  | 'repeats' // повторяет
  | 'conflicts' // потенциально конфликтует
  | 'scenario-supported' // поддерживается сценарием
  | 'disputed' // оспорено наблюдением
  | 'missing-link'; // отсутствующая связь

export const GRAPH_EDGE_KIND_TITLES: Record<GraphEdgeKind, string> = {
  defines: 'определяет',
  uses: 'использует',
  restricts: 'ограничивает',
  refines: 'уточняет',
  excepts: 'является исключением',
  'depends-on': 'зависит от',
  repeats: 'повторяет',
  conflicts: 'потенциально конфликтует',
  'scenario-supported': 'поддерживается сценарием',
  disputed: 'оспорено наблюдением',
  'missing-link': 'отсутствует связь',
};

export interface GraphNode {
  id: string; // fragment id
  fragmentId: string;
  label: string; // short text (<= 80 chars)
  kind: GraphNodeKind;
  path: string;
  sectionPath: string; // top section path e.g. "6"
  sectionTitle: string | null;
  degree: number;
  layers: LayerId[];
}

export type EdgeBasisType =
  | 'shared-term'
  | 'section-reference'
  | 'lexical-similarity'
  | 'structure'
  | 'scenario-link'
  | 'finding-link'
  | 'definition';

export interface GraphEdge {
  id: string;
  source: string; // node id
  target: string; // node id
  kind: GraphEdgeKind;
  basis: {
    type: EdgeBasisType;
    detail: string;
    /** lexical similarity 0..1 when basis is lexical-similarity; representation-specific, not equivalence proof */
    similarity?: number;
  };
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    centralNodes: { nodeId: string; degree: number }[];
    bridges: { edgeId: string; fromSection: string; toSection: string }[];
    isolatedNodes: string[];
    duplicateClusters: { nodeIds: string[]; similarity: number }[];
    longestChain: { nodes: string[]; length: number };
    sectionsWithoutScenarios: { path: string; title: string | null }[];
    methodSummary: string;
    limitations: string[];
  };
  provenance: ProvenanceStatus; // LOCAL (built from local analysis) — scenario/finding links add LIVE/LOCAL basis
  versionId: string;
  generatedAt: string;
}

// ---------- Fragment card ----------

export interface InterpretationDTO {
  id: string; // analysis id
  backend: string; // "ollama" | "session-cloud"
  model: string | null;
  createdAt: string;
  interpretation: string;
  alternatives: string[];
  scopeNote: string; // предполагаемая область действия
  limitations: string;
  analysisType: 'model-interpret';
}

export interface FragmentCardDTO {
  fragment: FragmentDTO;
  /** Parent chain up to section. */
  ancestors: { id: string; kind: FragmentKind; title: string | null; text: string; path: string }[];
  annotation: FragmentAnnotation | null;
  layers: LayerBasis[];
  interpretations: InterpretationDTO[];
  notes: NoteDTO[];
  scenarios: ScenarioDTO[];
  runs: RunDTO[]; // runs linked through scenarios of this fragment or direct
  findings: FindingDTO[];
  graphEdges: GraphEdge[];
  analysisProvenance: ProvenanceStatus; // LOCAL if local analysis exists, else no-data
  limitations: string[];
}

// ---------- Notes ----------

export type NoteKind = 'note' | 'interpretation' | 'objection' | 'user-verdict' | 'todo';

export interface NoteDTO {
  id: string;
  projectId: string;
  versionId: string | null;
  fragmentId: string | null;
  kind: NoteKind;
  body: string;
  author: string;
  origin: Origin;
  linkedRunId: string | null;
  createdAt: string;
}

// ---------- Scenarios ----------

export type ScenarioStatus =
  | 'unexplored' // неисследованная
  | 'explored' // исследованная
  | 'synthetic' // синтетическая
  | 'run-verified' // проверенная запуском
  | 'disputed' // оспоренная
  | 'stopped'; // остановленная

export const SCENARIO_STATUS_TITLES: Record<ScenarioStatus, string> = {
  unexplored: 'Неисследованная',
  explored: 'Исследованная',
  synthetic: 'Синтетическая',
  'run-verified': 'Проверена запуском',
  disputed: 'Оспорена',
  stopped: 'Остановлена',
};

export interface ScenarioDTO {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  description: string | null;
  status: ScenarioStatus;
  stopReason: string | null;
  origin: 'user' | 'model' | 'seed' | 'demo';
  fragmentId: string | null;
  generationMetadata?: { backend: string; connectionId: string | null; connectionName: string | null; requestedModel: string | null; actualProvider: string | null; actualModel: string | null } | null;
  pinned: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
  runCount: number;
  lastRunStatus: RunStatus | null;
}

// ---------- Runs ----------

export type RoleId =
  | 'executor'
  | 'explorer'
  | 'evaluator'
  | 'challenger'
  | 'editor'
  | 'assistant'
  | 'interpreter';

export const ROLE_TITLES: Record<RoleId, string> = {
  executor: 'Executor — исполнитель',
  explorer: 'Explorer — исследователь',
  evaluator: 'Evaluator — оценщик',
  challenger: 'Challenger — критик',
  editor: 'Editor — редактор',
  assistant: 'Помощник',
  interpreter: 'Интерпретатор текста',
};

export const ROLE_DESCRIPTIONS: Record<RoleId, string> = {
  executor: 'Выполняет пользовательскую задачу по скиллу',
  explorer: 'Ищет граничные ситуации и механизмы отказа',
  evaluator: 'Сопоставляет результат с критериями',
  challenger: 'Пытается опровергнуть находку или вердикт',
  editor: 'Предлагает минимальную правку инструкции',
  assistant: 'Исследовательский диалог',
  interpreter: 'Интерпретирует фрагменты текста',
};

export interface RunInputDTO {
  prompt: string;
  /** Exact skill text included in executor's system message. */
  skillText?: string;
  skillContextMode?: 'full' | 'relevant';
  sentMessages?: { role: 'system' | 'user' | 'assistant'; content: string }[];
  contextProvenance?: {
    mode: 'none' | 'selected' | 'full' | 'unknown';
    versionId: string | null;
    versionLabel: string | null;
    fullVersionSha256: string | null;
    fullVersionChars: number | null;
    selectedFragmentIds: string[];
    includedFragmentIds: string[];
    sentContextSha256: string | null;
    sentContextChars: number;
  };
  action?: string;
  versionId?: string;
  modelCallId?: string;
  responseMetadata?: { actualProvider: string | null; actualModel: string | null; modelCallId?: string | null; contextMode?: string; contextVersionId?: string | null; contextFragmentIds?: string[]; contextSha256?: string | null; contextChars?: number; finishReason?: string | null; outputTruncated?: boolean | null };
  skillVerification?: {
    versionId: string | null;
    fullTextSha256: string | null;
    fullTextChars: number | null;
    mode: 'full' | 'relevant' | 'unknown';
    status: 'matches' | 'mismatch' | 'unverified';
    detail: string;
  };
  /** Optional conversation for assistant runs. */
  messages?: { role: 'user' | 'assistant'; content: string }[];
  settings: {
    temperature?: number;
    numPredict?: number;
    timeoutMs: number;
    programChecks: boolean; // run program JSON-validity check after executor
  };
  taskContext?: {
    scenarioId?: string;
    fragmentId?: string;
    versionId?: string;
    criterion?: string;
    outputToEvaluate?: string;
    findingId?: string;
    skillContextMode?: 'full' | 'relevant';
    instructionContext?: {
      mode: 'none' | 'selected' | 'full';
      versionId: string | null;
      fragmentIds: string[];
      includeParentSections: boolean;
    };
  };
}

export interface RunDTO {
  id: string;
  projectId: string;
  scenarioId: string | null;
  versionId: string | null;
  parentRunId: string | null;
  role: RoleId;
  backend: 'ollama' | 'freellmapi' | 'session-cloud' | 'demo';
  connectionId: string | null;
  connectionName: string | null;
  model: string | null;
  status: RunStatus;
  input: RunInputDTO | null;
  output: string | null;
  error: string | null;
  verdict: Verdict | null;
  verdictBy: VerdictBy | null;
  modelVerdict: Verdict | null;
  modelVerdictBy: VerdictBy | null;
  durationMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  origin: Origin;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Program check results (LOCAL checks like JSON validity). */
  programChecks: ProgramCheckDTO[];
}

export interface ProgramCheckDTO {
  name: string
  passed: boolean
  detail: string
  status?: 'passed' | 'failed' | 'unverified'
  scope?: 'raw-response' | 'normalized-response' | 'syntax-scan'
  version?: string
  provenance?: 'local-program'
}

export interface ResearchDiscrepancyDTO {
  noteId: string
  projectId: string
  versionId: string
  createdAt: string
  payload: import('@/lib/research-discrepancy').ResearchDiscrepancy
}

export interface NextResearchActionDTO {
  key: string
  gap: string
  linkedIds: string[]
  action: string
  rationale: string
  limitations: string[]
  target?: { kind: 'position' | 'scenario' | 'run' | 'observation' | 'discrepancy' | 'index'; id: string }
}

export interface ResearchPositionStateDTO {
  positionId: string
  title: string
  interpretationStatus: string
  index: { status: 'ready' | 'stale' | 'failed' | 'missing'; model?: string | null }
  relations: { proposed: number; accepted: number; disputed: number }
  scenarioIds: string[]
  runIds: string[]
  technicalErrorRunIds: string[]
  evaluatorRunIds: string[]
  evaluations: { runId: string; runStatus: string; verdict: string | null; verdictBy: string | null }[]
  observationIds: string[]
  unverifiedObservationIds: string[]
  openDiscrepancyNoteIds: string[]
  recommendations: NextResearchActionDTO[]
}

export interface ResearchStateDTO {
  projectId: string
  versionId: string
  scope: 'version'
  interpretations: { total: number; proposed: number; accepted: number; disputed: number }
  index: { ready: number; stale: number; failed: number; missing: number }
  relations: { proposed: number; accepted: number; disputed: number }
  scenarios: { total: number; unexplored: number; explored: number; runVerified: number; byKind: Record<string, number> }
  runs: { attempts: number; completed: number; failed: number; cancelled: number; technicalErrors: number; evaluations: number; evaluationVerdicts: Record<string, number>; localCheckFailures: number; localChecksUnverified: number }
  observations: { total: number; unverified: number; other: number }
  discrepancies: { open: number; accepted: number; disputed: number }
  findings: { total: number; hypotheses: number; supported: number; disputed: number; rejected: number }
  unverifiedConclusions: { proposedPositions: number; unverifiedObservations: number }
  gaps: { unrepresentedFragmentCount: number | null; contourCoverage: Record<string, number> | null }
  positions: ResearchPositionStateDTO[]
  recommendations: NextResearchActionDTO[]
  limitations: string[]
}

// ---------- Findings ----------

export type FindingSeverity = 'info' | 'warning' | 'issue';
export type FindingStatus = 'hypothesis' | 'supported' | 'disputed' | 'rejected';

export interface EvidenceStep {
  kind:
    | 'fragment' // фрагмент инструкции
    | 'criterion' // критерий
    | 'scenario' // сценарий
    | 'run-input' // вход запуска
    | 'executor-output' // ответ исполнителя
    | 'evaluator-conclusion' // заключение проверяющего
    | 'objection' // возражение
    | 'note' // заметка
    | 'assumption' // допущение
    | 'program-check'; // программная проверка
  refId: string | null;
  label: string;
  detail: string;
  status: 'present' | 'missing' | 'partial';
}

export interface EvidenceChain {
  steps: EvidenceStep[];
  /** Where the chain is incomplete. */
  gaps: string[];
  distinction:
    | 'observation' // наблюдение
    | 'inference' // вывод
    | 'assumption' // допущение
    | 'new-requirement' // новое требование
    | 'model-evaluation' // модельная оценка
    | 'executed-check' // выполненная проверка
    | 'unverified-hypothesis'; // непроверенная гипотеза
}

export interface FindingDTO {
  id: string;
  projectId: string;
  versionId: string | null;
  fragmentId: string | null;
  scenarioId: string | null;
  runId: string | null;
  title: string;
  description: string;
  severity: FindingSeverity;
  status: FindingStatus;
  provenance: string;
  origin: Origin;
  evidence: EvidenceChain | null;
  createdAt: string;
}

// ---------- Connections ----------

export interface ModelInfo {
  name: string;
  sizeBytes: number | null;
  /** What operations the model supports, as probed. */
  generate: boolean;
  embed: boolean;
  /** How capabilities were determined. */
  probe: 'show' | 'probe' | 'tags-only' | 'unknown';
}

export interface ConnectionDTO {
  id: string;
  projectId: string | null;
  name: string;
  kind: string;
  baseUrl: string;
  status: 'unknown' | 'ok' | 'error';
  lastError: string | null;
  lastCheckAt: string | null;
  models: ModelInfo[];
  createdAt: string;
  updatedAt: string;
}

export interface AssignmentDTO {
  role: RoleId | 'embedding';
  backend: 'ollama' | 'freellmapi' | 'session-cloud' | null;
  connectionId: string | null;
  connectionName: string | null;
  model: string | null;
}

// ---------- Documents / versions ----------

export interface DocumentVersionDTO {
  id: string;
  documentId: string;
  projectId: string;
  label: string;
  kind: string;
  source: string;
  sourceUrl: string | null;
  knownVersion: string | null;
  completeness: string;
  contentHash: string;
  contentLength: number;
  lineCount: number;
  parentVersionId: string | null;
  note: string | null;
  importDate: string;
  isActive: boolean;
  fragmentCount: number;
  hasLocalAnalysis: boolean;
  lastAnalysisAt: string | null;
  childCount: number;
}

export interface DocumentDTO {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  versions: DocumentVersionDTO[];
}

export interface ProjectDTO {
  id: string;
  name: string;
  description: string | null;
  origin: string;
  createdAt: string;
  updatedAt: string;
}

// ---------- Diff / evolution ----------

export interface WordOp {
  type: 'equal' | 'add' | 'remove';
  text: string;
}

export interface DiffOp {
  type: 'equal' | 'add' | 'remove';
  aLine?: number;
  bLine?: number;
  text: string;
  /** Word-level detail when a remove+add pair represents a changed line. */
  words?: WordOp[];
}

export interface DiffHunk {
  aStart: number;
  aLines: string[];
  bStart: number;
  bLines: string[];
  ops: DiffOp[];
}

export interface VersionDiffDTO {
  aVersionId: string;
  bVersionId: string;
  aLabel: string;
  bLabel: string;
  aHash: string;
  bHash: string;
  identical: boolean;
  addedLines: number;
  removedLines: number;
  hunks: DiffHunk[];
}

export interface ImpactResult {
  analysisId: string;
  baseVersionId: string;
  newVersionId: string;
  literalChanges: {
    addedLines: number;
    removedLines: number;
    changedSections: string[]; // section paths
    changedFragmentIds: string[];
  };
  layerChanges: {
    layer: LayerId;
    baseCount: number;
    newCount: number;
    delta: number;
    fragmentIds: string[];
  }[];
  affectedTerms: string[];
  relatedFragments: { fragmentId: string; reason: string }[]; // затронутые маршруты/связи
  scenariosToRerun: { scenarioId: string; title: string; reason: string }[];
  staleResults: {
    kind: 'analysis' | 'interpretation' | 'run' | 'finding';
    id: string;
    label: string;
    reason: string;
  }[];
  costEstimate: {
    kind: 'A' | 'B' | 'C' | 'D';
    title: string;
    description: string;
    estimatedRequests: number;
    estimatedSeconds: number | null; // null = unknown
    available: boolean;
  }[];
  limitations: string[];
}

// ---------- Metrics ----------

export interface MetricSeriesPoint {
  label: string;
  value: number;
  parts?: Record<string, number>; // for stacked bars
  drilldown?: { kind: 'section' | 'fragment' | 'scenario' | 'run' | 'finding' | 'version'; id: string }[];
}

export interface MetricDefinition {
  id: string;
  title: string;
  chartType: 'bar' | 'stacked-bar' | 'pie' | 'line' | 'list';
  provenance: MetricProvenance;
  definition: string; // определение показателя
  method: string; // способ получения
  limitations: string;
  sampleSize: number | null; // null = не применимо
  dataOrigin: Origin; // demo excluded from real metrics
  computedAt: string;
  versionId: string | null;
  series: MetricSeriesPoint[];
  noData: boolean;
  noDataReason?: string;
}

export interface MetricsBundle {
  projectId: string;
  versionId: string;
  metrics: MetricDefinition[];
  demoExcluded: boolean;
  generatedAt: string;
}

// ---------- Remote (GitHub) check ----------

export interface RemoteCheckResult {
  reachable: boolean;
  error: string | null;
  url: string;
  remoteHash: string | null;
  localHash: string;
  identical: boolean;
  remoteLength: number | null;
  fetchedAt: string | null;
  note: string;
}

// ---------- Export ----------

export type ExportFormat = 'md' | 'json' | 'csv' | 'txt';

export interface HandoffSection {
  id: string;
  title: string;
  included: boolean;
}

export interface ProjectArchive {
  format: 'mmss-observatory-archive';
  archiveVersion: 1;
  exportedAt: string;
  project: ProjectDTO & {
    documents: (DocumentDTO & {
      versions: (DocumentVersionDTO & { content: string })[];
    })[];
    scenarios: ScenarioDTO[];
    runs: RunDTO[];
    findings: FindingDTO[];
    notes: NoteDTO[];
    assignments: AssignmentDTO[];
    chatMessages: ChatMessageDTO[];
    analyses: {
      id: string;
      versionId: string;
      type: string;
      backend: string;
      model: string | null;
      status: string;
      summary: string;
      result: unknown;
      createdAt: string;
    }[];
    modelCalls: { id: string; role: string; action: string; contextMode: string; contextMetadata: unknown; messages: unknown; backend: string; connectionName: string | null; requestedModel: string | null; actualProvider: string | null; actualModel: string | null; status: string; relatedEntities: unknown; createdAt: string }[];
    fragmentRefs?: { id: string; versionId: string; path: string; textHash: string }[];
    semanticIndexPolicy?: 'rebuild-on-import';
    semanticPositions?: {
      id: string; versionId: string; title: string; purpose: string; regulatedDecision: string; conditions: string;
      expectedBehavior: string; limitations: string; provenance: string; provenanceRef: string | null; status: string;
      sourceFragmentRefs?: unknown; createdAt: string; updatedAt: string; fragments: { id: string; path: string; textHash: string }[];
    }[];
    semanticRelations?: { id: string; versionId: string; sourcePositionId: string; targetPositionId: string; kind: string; rationale: string; provenance: string; status: string; createdAt: string }[];
    positionObservations?: { id: string; versionId: string; positionId: string; runId: string | null; noteId: string | null; observation: string; evidenceText: string; conditions: string; criterion: string; status: string; limitations: string; createdAt: string }[];
    researchCampaigns?: unknown[];
    /** Connections excluded by default — may contain internal addresses. */
    connectionsIncluded: boolean;
  };
}

export interface ChatMessageDTO {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  backend: string | null;
  connectionName: string | null;
  model: string | null;
  responseMetadata: { actualProvider: string | null; actualModel: string | null; modelCallId?: string | null; contextMode?: string; contextVersionId?: string | null; contextFragmentIds?: string[]; contextSha256?: string | null; contextChars?: number; historyCount?: number; finishReason?: string | null; outputTruncated?: boolean | null } | null;
  contextFragmentId: string | null;
  createdAt: string;
}

// ---------- App state (GET /api/state) ----------

/** Fixed registry of honestly-not-implemented functions (PLACEHOLDER). */
export const PLACEHOLDER_REGISTRY: { id: string; title: string; missing: string; workaround: string }[] = [
  {
    id: 'ollama-pull',
    title: 'Загрузка моделей Ollama через UI',
    missing: 'Управление локальными моделями из интерфейса',
    workaround: 'Используйте команду `ollama pull <model>` в терминале, затем обновите список моделей',
  },
  {
    id: 'embeddings-index',
    title: 'Пакетное индексирование embedding-модели',
    missing: 'Возобновляемое индексирование с сохранением прогресса всей версии',
    workaround: 'Индексируйте выбранные функциональные положения, источники и наблюдения в Смысловой карте',
  },
  {
    id: 'github-publish',
    title: 'Публикация изменений в GitHub',
    missing: 'Push в репозиторий требует токена и отдельного разрешения',
    workaround: 'Экспортируйте правку в Evolution Studio и примените вручную',
  },
  {
    id: 'scheduled-runs',
    title: 'Отложенные и повторяющиеся запуски',
    missing: 'Планировщик заданий',
    workaround: 'Используйте ограниченные серии запусков в Behavior Lab',
  },
  {
    id: 'streaming-chat',
    title: 'Потоковый вывод чата',
    missing: 'SSE/стриминг ответов модели',
    workaround: 'Ответы приходят целиком после завершения запроса',
  },
  {
    id: 'auto-scenario-tree',
    title: 'Автогенерация полного дерева сценариев',
    missing: 'Автоматический перебор всех ситуаций',
    workaround: 'Осознанное ограничение: используйте Explorer с указанием области/глубины/бюджета',
  },
];

export interface AppStateDTO {
  project: ProjectDTO | null;
  documents: DocumentDTO[];
  activeVersion: DocumentVersionDTO | null;
  fragments: FragmentDTO[]; // of active version
  scenarios: ScenarioDTO[];
  runs: RunDTO[]; // latest 200
  findings: FindingDTO[];
  notes: NoteDTO[];
  connections: ConnectionDTO[];
  assignments: AssignmentDTO[];
  chatMessages: ChatMessageDTO[];
  analyses: {
    id: string;
    versionId: string;
    type: string;
    backend: string;
    model: string | null;
    status: string;
    summary: string;
    fragmentCount: number | null;
    createdAt: string;
  }[];
  sessionCloud: { available: boolean; note: string };
  seeded: boolean;
}

// ---------- API error shape ----------

export interface ApiError {
  error: string;
  detail?: string;
}
