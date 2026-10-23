# MMSS Skill Observatory — Architecture & Contracts

Единый документ-контракт для всех агентов. Прочитать ДО начала работы.
Общие типы: `src/lib/types.ts` — единственный источник правды о формах данных. НЕ дублировать типы в других файлах.

## Продукт

Исследовательская среда для чтения, анализа, испытания и развития инструкций AI-агентов.
Первый исследуемый документ — SKILL.md скилла `mmss-principle-synthesis` v0.1.4
(файл-вложение идентичен `https://github.com/Abstract-Mindfreak/mmss-principle-synthesis`
по пути `skills/mmss-principle-synthesis/SKILL.md`, sha256 `ddd187d4...`, проверено).
Сид хранится в `src/seed/mmss-principle-synthesis.SKILL.md`.

Стек: Next.js 16 App Router (единственный пользовательский маршрут — `/`), TypeScript,
Tailwind 4 + shadcn/ui, Prisma + SQLite (`db/custom.db`), Zustand. API — только route handlers
(`/api/...`), никаких server actions. Реальный бэкенд моделей: Ollama (локально у пользователя)
и опционально `session-cloud` (z-ai-web-dev-sdk, только backend-код, помечен как временный).

## Статусы честности (обязательны в UI)

- `LIVE` — реальное выполнение через подключённый сервис.
- `LOCAL` — реальное локальное вычисление/проверка.
- `DEMO` — синтетические данные для демонстрации интерфейса (origin='demo', не входят в реальные метрики).
- `PLACEHOLDER` — функция не реализована (видна на месте использования + в реестре).
- `STALE` — результат относится к предыдущей версии входных данных.
- `ERROR` — ошибка выполнения.

Статус выполнения запуска (planned/queued/running/completed/cancelled/failed) ≠ вердикт проверки
(pass/fail/inconclusive). Завершённая проверка может обнаружить дефект.

## Разделы интерфейса (studios), все — компоненты в `src/components/studios/`

1. `OverviewStudio` — обзор проекта, метаданные документа, готовность разделов, быстрый старт.
2. `AtlasStudio` — Instruction Atlas: текст с масштабированием документ→раздел→абзац→предложение, слои, карточки фрагментов, заметки.
3. `GraphStudio` — карта взаимодействий правил (интерактивный граф).
4. `RoadsStudio` — Failure Roads: дороги решений и потенциальных отказов.
5. `ScenarioStudio` — Scenario Tree: многомасштабное дерево ситуаций.
6. `LabStudio` — Behavior Lab: роли, назначения моделей, запуски, вердикты.
7. `EvolutionStudio` — версионирование, diff, анализ последствий правки.
8. `MetricsStudio` — метрики и графики с паспортом каждого показателя.
9. `ConnectionsStudio` — кабинет подключений (Ollama + session-cloud), пробы, назначения моделей по ролям.
10. `ExportStudio` — копирование/экспорт/импорт, Research Handoff Report.
11. `RegistryStudio` — реестр статусов функций, DEMO-данные (загрузка/очистка), список заглушек.
12. `AssistantStudio` — чат с исследовательским помощником (один из инструментов, не основа).

Язык интерфейса — русский. Машинные идентификаторы и английский текст скилла — без перевода.

## Карта владения файлами (НЕ трогать чужие файлы)

- Главный агент: `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`, `src/lib/types.ts`,
  `src/lib/serialize.ts` (ГОТОВ — общие сериализаторы DTO + sha256Hex + safeParse, импортируйте свободно),
  `src/lib/api-client.ts`, `src/lib/store.ts`, `src/components/shell/*`, `src/components/shared/*`,
  `prisma/schema.prisma`, `src/seed/*`, `docs/*`, `README.md`.
- Агент 1-a (backend core): `src/lib/parser.ts`, `src/lib/analysis.ts`, `src/lib/graph.ts`,
  `src/lib/diff.ts`, `src/lib/import-doc.ts`, `src/lib/seed.ts`,
  `src/app/api/bootstrap/route.ts`, `src/app/api/state/route.ts`, `src/app/api/projects/route.ts`,
  `src/app/api/projects/[id]/route.ts`, `src/app/api/projects/[id]/documents/route.ts`,
  `src/app/api/documents/[id]/route.ts`, `src/app/api/versions/[id]/route.ts`,
  `src/app/api/versions/[id]/branch/route.ts`, `src/app/api/versions/[id]/diff/route.ts`,
  `src/app/api/versions/[id]/analyze/route.ts`, `src/app/api/versions/[id]/impact/route.ts`,
  `src/app/api/versions/[id]/graph/route.ts`, `src/app/api/versions/[id]/check-remote/route.ts`,
  `src/app/api/fragments/[id]/route.ts`, `src/app/api/notes/route.ts`, `src/app/api/notes/[id]/route.ts`,
  `src/app/api/projects/[id]/notes/route.ts`.
- Агент 1-b (backend runs): `src/lib/ollama.ts`, `src/lib/session-cloud.ts`, `src/lib/role-prompts.ts`,
  `src/lib/runner.ts`, `src/lib/run-registry.ts`, `src/lib/demo-data.ts`,
  `src/app/api/connections/route.ts`, `src/app/api/connections/[id]/route.ts`,
  `src/app/api/connections/[id]/test/route.ts`, `src/app/api/connections/[id]/models/route.ts`,
  `src/app/api/connections/[id]/generate-test/route.ts`, `src/app/api/connections/[id]/embed-test/route.ts`,
  `src/app/api/assignments/route.ts`, `src/app/api/runs/route.ts`, `src/app/api/runs/[id]/route.ts`,
  `src/app/api/runs/[id]/cancel/route.ts`, `src/app/api/runs/[id]/retry/route.ts`,
  `src/app/api/runs/[id]/verdict/route.ts`, `src/app/api/projects/[id]/scenarios/route.ts`,
  `src/app/api/scenarios/[id]/route.ts`, `src/app/api/scenarios/[id]/suggest/route.ts`,
  `src/app/api/versions/[id]/analyze-model/route.ts`, `src/app/api/projects/[id]/chat/route.ts`,
  `src/app/api/projects/[id]/demo/route.ts`, `src/app/api/session-cloud/route.ts`.
- Агент 1-c (backend export): `src/lib/metrics.ts`, `src/lib/exporters.ts`, `src/lib/importers.ts`,
  `src/app/api/projects/[id]/metrics/route.ts`, `src/app/api/projects/[id]/export/route.ts`,
  `src/app/api/projects/[id]/handoff/route.ts`, `src/app/api/projects/[id]/graph-export/route.ts`,
  `src/app/api/import/route.ts`.
- Агент 3-a: `src/components/studios/AtlasStudio.tsx` (+ подпапка `src/components/studios/atlas/*`).
- Агент 3-b: `src/components/studios/GraphStudio.tsx`, `src/components/studios/RoadsStudio.tsx`
  (+ подпапки `graph/*`, `roads/*`; в roads — каталог «ям» `roads-pits.ts`).
- Агент 3-c: `src/components/studios/ScenarioStudio.tsx`, `src/components/studios/LabStudio.tsx`
  (+ подпапки `scenario/*`, `lab/*`).
- Агент 3-d: `src/components/studios/EvolutionStudio.tsx`, `src/components/studios/MetricsStudio.tsx`
  (+ подпапки `evolution/*`, `metrics/*`).
- Агент 3-e: `src/components/studios/ConnectionsStudio.tsx`, `src/components/studios/ExportStudio.tsx`,
  `src/components/studios/RegistryStudio.tsx`, `src/components/studios/AssistantStudio.tsx`
  (+ подпапки `connections/*`, `export/*`, `registry/*`, `assistant/*`).

Общие: `src/lib/db.ts`, `src/lib/utils.ts`, `src/lib/types.ts`, `src/components/ui/*` — читать можно всем, менять только главный агент.

## Правила для backend-агентов

- Route handlers: `export async function GET/POST/PUT/PATCH/DELETE(req: Request, { params }: { params: Promise<{ id: string }> })`.
  В Next 16 `params` — Promise, обязательно `await params`.
- Ответы — `NextResponse.json(...)`. Ошибки — `{ error: string, detail?: string }` с корректным HTTP-кодом.
- Все строки с JSON из Prisma парсить через safeParse (хелпер в `src/lib/serialize.ts` — владелец 1-a, остальные импортируют).
- НЕ менять `prisma/schema.prisma` (схема финализирована). Если не хватает поля — записать блокер в worklog.md.
- НЕ перезапускать dev-сервер (он уже работает на :3000). Проверять свои роуты через `curl localhost:3000/api/...`.
- Лог компиляции — `tail /home/z/my-project/dev.log`.
- z-ai-web-dev-sdk — ТОЛЬКО в серверном коде.
- Не выдумывать данные: все эвристики снабжать `reason`/`limitations`; при отсутствии данных — `no-data`.
- Демо-данные создавать только с `origin='demo'`.

## Спецификация API (все типы — из src/lib/types.ts)

### Общие

- `GET /api/state?projectId=<id>` → `AppStateDTO`. Без projectId — активный проект (первый по createdAt; активная версия — isActive, иначе последняя). Фронт вызывает при загрузке.
- `POST /api/bootstrap` → создаёт seed-проект, если проектов нет (идемпотентно: если есть — вернуть существующий). Возвращает `AppStateDTO`. Сид: проект «mmss-principle-synthesis — исследование скилла», документ SKILL.md (source='attachment', knownVersion из front-matter '0.1.4', completeness='full', sourceUrl=URL репо), версия label='origin', kind='original', isActive, парсинг фрагментов, локальный структурный анализ, стартовые сценарии (каталог ниже). Установка Setting('seeded','true').
- `GET /api/health` → `{ ok: true }`.

### Проекты и документы (1-a)

- `GET /api/projects` → `ProjectDTO[]`.
- `POST /api/projects` body `{ name, description? }` → `ProjectDTO` (пустой проект).
- `GET /api/projects/[id]` → `{ project, documents: DocumentDTO[] }`.
- `PATCH /api/projects/[id]` body `{ name?, description?, activeVersionId? }`.
- `DELETE /api/projects/[id]` → 204. Нельзя удалить последний проект? Можно (потом /api/bootstrap пересоздаст сид).
- `POST /api/projects/[id]/documents` body `{ title, content, source: 'paste'|'upload', knownVersion?, sourceUrl?, note? }` → создаёт документ+версию kind='original', isActive=true (остальные версии документа isActive=false), парсит фрагменты, запускает локальный анализ. → `DocumentDTO`.
- `GET /api/documents/[id]` → `DocumentDTO` (со всеми версиями, без content).
- `GET /api/versions/[id]` → `{ version: DocumentVersionDTO, content: string }`.
- `PATCH /api/versions/[id]` body `{ label?, note?, isActive? }` (isActive=true снимает флаг с остальных версий документа).
- `DELETE /api/versions/[id]` — только kind='experimental' (иначе 400 с объяснением). Удаляет версию с фрагментами/анализами.
- `POST /api/versions/[id]/branch` body `{ label?, content?, note? }` → новая версия kind='experimental', source='branch', parentVersionId=id, content = переданный текст (обязателен), knownVersion наследуется, isActive=false. Парсит фрагменты + локальный анализ. → `DocumentVersionDTO`.
- `POST /api/versions/[id]/restore` → нет отдельного роута; восстановление = branch с label `restore-from-<label>` (фронт так и вызывает).
- `GET /api/versions/[id]/diff?other=<versionId>` → `VersionDiffDTO` (word-level внутри line-hunks).
- `POST /api/versions/[id]/analyze` body `{}` → пересчёт локального структурного анализа (type='local-structural', backend='local', status, summary на русском). → `{ analysis: { id, createdAt, durationMs, fragmentCount }, result: LocalAnalysisResult }`.
- `POST /api/versions/[id]/impact` body `{ newContent: string }` → НЕ сохраняет ничего: парсит newContent в памяти, считает diff против версии, слой-дельты, affectedTerms (термы из изменённых фрагментов), relatedFragments (граф-соседи изменённых фрагментов), scenariosToRerun (сценарии, привязанные к изменённым/соседним фрагментам), staleResults (анализы/интерпретации/запуски/находки, привязанные к этой версии — все станут устаревшими при сохранении), costEstimate (A: 0 запросов, локальный пересчёт — секунды; B: 1 запрос модели на интерпретацию изменений; C: N повторных запусков = числу scenariosToRerun; D: сравнение результатов — 0 запросов). → `ImpactResult`.
- `GET /api/versions/[id]/graph` → `GraphData` (строится из последнего local-structural анализа; если нет — 404 `{error:'Сначала выполните локальный анализ'}`).
- `POST /api/versions/[id]/check-remote` body `{ url?: string }` → `RemoteCheckResult`. URL по умолчанию `https://raw.githubusercontent.com/Abstract-Mindfreak/mmss-principle-synthesis/main/skills/mmss-principle-synthesis/SKILL.md`. Сервер fetch с таймаутом 15с, sha256 сравнение. Недоступность — честный `reachable:false, error`. Не подменяет базовую версию.
- `GET /api/fragments/[id]` → `FragmentCardDTO` (карточка: анкесторы, слои с основаниями, интерпретации моделей, заметки, сценарии, запуски (последние 20 по связанным сценариям), находки, рёбра графа).
- `GET /api/projects/[id]/notes?fragmentId=` → `NoteDTO[]`.
- `POST /api/notes` body `{ projectId, fragmentId?, versionId?, kind?, body }` → `NoteDTO`.
- `PATCH /api/notes/[id]` body `{ body?, kind? }`; `DELETE /api/notes/[id]`.

### Подключения и запуски (1-b)

- `GET /api/connections` → `ConnectionDTO[]` (глобальные, projectId=null — кабинет подключений общий).
- `POST /api/connections` body `{ name, baseUrl }` → создаёт (baseUrl нормализовать: без /api suffix). Проверка НЕ выполняется автоматически.
- `PATCH /api/connections/[id]` body `{ name?, baseUrl? }`.
- `DELETE /api/connections/[id]` (назначения на нём сбрасываются в null).
- `POST /api/connections/[id]/test` → пинг `GET {baseUrl}/api/tags` таймаут 5с → `{ ok, latencyMs?, error?, modelCount? }` + обновляет status/lastError/lastCheckAt.
- `POST /api/connections/[id]/models` → список из `/api/tags` + определение capabilities: для каждой модели пробуем `POST /api/show` (`capabilities.embedding`) — если поле есть, probe='show'; иначе не делаем дорогих проб (модель может не отвечать) — generate=true (по умолчанию для тегов), embed=из show. Ошибки отдельных проб не валидны → probe='tags-only'. Обновляет models-кэш. → `{ models: ModelInfo[], error?: string }`.
- `POST /api/connections/[id]/generate-test` body `{ model, prompt }` → реальный `POST {baseUrl}/api/chat` `{ model, messages:[{role:'user',content:prompt}], stream:false }`, таймаут 60с → `{ ok, output, durationMs, evalCount? , error? }`. Ошибки — честно.
- `POST /api/connections/[id]/embed-test` body `{ model, text }` → `POST {baseUrl}/api/embed` `{ model, input: text }` (fallback `/api/embeddings`), → `{ ok, dimensions, preview: number[], durationMs, error? }`.
- `GET /api/assignments?projectId=` → `AssignmentDTO[]` (все роли, несуществующие — с null).
- `PUT /api/assignments` body `{ projectId, role, backend, connectionId?, model? }` → upsert.
- `GET /api/runs?projectId=&limit=200` → `RunDTO[]` (новые первыми; при чтении sweeper: runs со status='running' и updatedAt старше 5 минут → status='failed', error='Превышено время выполнения — отметка о потере результата (sweeper)').
- `POST /api/runs` body:
  ```
  { projectId, role, scenarioId?, versionId?, fragmentId?,
    backend: 'ollama'|'session-cloud'|'demo',
    connectionId?, model?, prompt?, settings? { temperature?, numPredict?, timeoutMs?, programChecks? },
    taskContext? { criterion?, outputToEvaluate?, findingId? },
    series? { count: number }  // ограниченная серия: 1..10
  }
  ```
  Создаёт run (или серию), выполняет синхронно каждый (статусы в БД: queued→running→completed/failed/cancelled). Возвращает `{ runs: RunDTO[] }`. Роли/промпты — из `src/lib/role-prompts.ts` (см. ниже). После executor-запуска при settings.programChecks=true выполняется ЛОКАЛЬНАЯ программная проверка JSON (parse, duplicate keys, NaN/Infinity) — результаты в `programChecks[]`. Verdict у evaluator: парсинг JSON-ответа `{verdict:'pass'|'fail'|'inconclusive', reasons:[...]}` (нестрого: искать первое JSON-вхождение; иначе inconclusive + note 'не удалось разобрать вердикт').
- `GET /api/runs/[id]` → `RunDTO` (полный input/output).
- `POST /api/runs/[id]/cancel` → если running — abort (AbortController в реестре), status='cancelled'; иначе 400.
- `POST /api/runs/[id]/retry` → создаёт НОВЫЙ run с теми же параметрами и выполняет.
- `PUT /api/runs/[id]/verdict` body `{ verdict: 'pass'|'fail'|'inconclusive' }` → пользовательский вердикт: modelVerdict сохраняется, verdictBy='user'.
- `GET /api/projects/[id]/scenarios` → `ScenarioDTO[]` (плоский список с runCount/lastRunStatus).
- `POST /api/projects/[id]/scenarios` body `{ parentId?, title, description?, fragmentId?, status?, origin? }` → `ScenarioDTO`.
- `PATCH /api/scenarios/[id]` body `{ title?, description?, status?, stopReason?, pinned?, fragmentId? }`.
- `DELETE /api/scenarios/[id]` → только без дочерних (иначе 400 «сначала удалите/переместите дочерние ветви»).
- `POST /api/scenarios/[id]/suggest` body `{ backend, connectionId?, model?, count (1..5), depth? }` → Explorer-роль: модель предлагает `count` РАЗЛИЧАЮЩИХСЯ механизмов отказа для подветвей сценария; создаёт сценарии origin='model', status='unexplored'. Ответ модели валидировать (title+description); при ошибке — честный 502. → `{ created: ScenarioDTO[], raw: string, backend, model }`.
- `POST /api/versions/[id]/analyze-model` body `{ connectionId?, model?, backend: 'ollama'|'session-cloud', fragmentIds: string[], focus?: string }` → Interpreter-роль: для каждого фрагмента (не более 12 за раз — иначе 400 с пояснением) генерирует интерпретацию: JSON `{interpretation, alternatives: string[], scope: string, limitations: string}`. Сохраняет Analysis type='model-interpret' (одна на фрагмент — result: `{ items: [{fragmentId, ...}] }`). → `{ analysis: {...}, items }`.
- `GET /api/projects/[id]/chat` → `ChatMessageDTO[]`; `POST /api/projects/[id]/chat` body `{ content, contextFragmentId?, backend, connectionId?, model? }` → сохраняет user-сообщение, вызывает модель (assistant-промпт из role-prompts, контекст: фрагмент + его секция), сохраняет ответ. Ошибка модели → честный 502, user-сообщение сохраняется. → `{ messages: ChatMessageDTO[] }`.
- `POST /api/projects/[id]/demo` body `{}` → создаёт DEMO-данные (origin='demo', каталог ниже). `DELETE /api/projects/[id]/demo` → удаляет ВСЁ demo-происхождения. → `{ counts: { scenarios, runs, findings, notes } }`.
- `GET /api/session-cloud` → `{ available: boolean, note: string }` — проверка z-ai (простой тестовый вызов с кэшем на 60с; при ошибке available=false + note с описанием).

### Метрики и экспорт (1-c)

- `GET /api/projects/[id]/metrics?versionId=` → `MetricsBundle`. Метрики (все — `MetricDefinition` с определением/методом/ограничениями; demo-данные исключены; если выборка 0 — noData=true, noDataReason):
  1. `rule-types-by-section` (stacked-bar, computed) — слои по разделам.
  2. `scenario-coverage` (bar, computed) — сценарии на раздел (по fragmentId фрагментов раздела).
  3. `definition-density` (bar, computed) — определения + перекрёстные ссылки на раздел.
  4. `ambiguity-hotspots` (bar, computed) — плотность маркеров неоднозначности.
  5. `findings-distribution` (pie, computed) — по severity/status (только real).
  6. `runs-by-status` (bar, computed) — статус выполнения запусков (real).
  7. `runs-by-verdict` (bar, computed) — вердикты (real; ноль проверок → no-data, НЕ 100% успех).
  8. `evaluator-disagreements` (list, computed) — группы evaluator-запусков одного executor-запуска с разными вердиктами.
  9. `execution-time` (bar, measured) — среднее время по backend+model (только completed, durationMs).
  10. `version-comparison` (bar, computed) — находки/слои по версиям документа.
- `GET /api/projects/[id]/export?format=json|md|csv&parts=all|documents,scenarios,runs,findings,notes,analyses,assignments,chat` → ProjectArchive (json) / Markdown-отчёт (md) / CSV-таблицы (csv — несколько секций с `--- section ---` разделителями). Соединения в экспорт НЕ включаются (флаг connectionsIncluded=false в архиве; предупреждение в UI).
- `GET /api/projects/[id]/handoff?format=md|json&parts=all|goal,document,changes,analyses,runs,findings,evidence,disputed,hypotheses,errors,limitations,placeholders,next-steps` → Research Handoff Report (структура разделов ниже).
- `GET /api/projects/[id]/graph-export?versionId=&format=json|md|txt` → узлы и связи (json) / текстовое представление (md/txt).
- `POST /api/import` body — ProjectArchive JSON → валидация формата (`format==='mmss-observatory-archive'`, archiveVersion===1, обязательные поля; понятные ошибки с путями полей) → создаёт новый проект с суффиксом «(импорт)», перенумеровывает id. → `{ project: ProjectDTO, warnings: string[] }`.

### Research Handoff Report — структура

`goal` (цель исследования — из описания проекта + автоматическая сводка), `document` (документ, версия, hash, источник, известная версия, статус полноты), `changes` (версии/ветки, diff-сводки), `analyses` (выполненные анализы: тип, backend, модель, дата, сводка), `runs` (запуски: роль, backend, модель, статус, вердикт, длительность; полный вход/выход только по запросу `parts=runs-full`), `findings` (находки с evidence), `evidence` (паспорта цепочек), `disputed` (спорные выводы), `hypotheses` (непроверенные гипотезы), `errors` (ошибки выполнения), `limitations` (ограничения методов), `placeholders` (заглушки — из фиксированного списка), `next-steps` (полезные следующие действия — вычисляемые: непокрытые разделы, оспоренные находки без повторной проверки, незавершённые ветви дерева).

## Каталог стартовых сценариев (сид, origin='seed')

Создаются при bootstrap. Корень каждого — тема, дети — механизмы. Разнообразные, небольшие, НЕ про книжный шкаф:

1. «Недоступный источник» (fragment: раздел 6.2)
   - «Обязательный источник недоступен — что вернёт скилл» (unexplored)
   - «Замена источника без разрешения» (unexplored)
2. «Повтор результата» (§6.5)
   - «Повторяющееся значение с неизвестной основой» (unexplored)
3. «Конфликт требований» (§16.2)
   - «Схема требует числовой score, измерений нет» (unexplored)
4. «Неизвестный исход» (§15.4/15.5)
   - «Unknown ≠ absent в отчёте о состоянии» (unexplored)
5. «Потеря ограничения при переносе в JSON» (§16.1/§10.3)
   - «Закрытая схема запрещает поле language» (unexplored)
   - «Ограничение из prose не попало в контракт» (unexplored)

Корневые узлы: status='explored' (тема описана в скилле), fragmentId привязать к первому предложению соответствующего раздела (искать по path префиксу).

## Каталог DEMO-данных (origin='demo', только по явной кнопке)

- 1 демо-сценарий «[DEMO] Демонстрация интерфейса» c 2 детьми.
- 3 демо-запуска: executor (вывод — синтетический JSON-ответ, status='completed', origin='demo'), evaluator (verdict='inconclusive'), один failed с честной ошибкой «DEMO: модель недоступна — имитация ошибки».
- 2 демо-находки: «[DEMO] Пример находки с полной цепочкой доказательств» (evidence chain заполнена), «[DEMO] Пример гипотезы без проверки».
Все с пометкой [DEMO] в title и origin='demo'. В реальные метрики не входят (исключаются фильтром origin).

## Роли и промпты (src/lib/role-prompts.ts, 1-b)

Системные промпты на английском (язык документа), задания могут быть RU/EN. Каждый промпт включает
соответствующий фрагмент(ы) скилла. Executor: system = полный текст активной версии скилла (или выбранный раздел + оглавление), user = задача. Вывод — один JSON-объект (§16.3). Explorer: система — «You are an explorer... propose N genuinely DIFFERENT failure mechanisms, not variations of one theme», вывод JSON `{mechanisms:[{title, description}]}`. Evaluator: даны критерий + результат исполнителя → JSON `{verdict, reasons[]}`. Challenger: дана находка/вердикт → попытка опровержения, JSON `{refuted: boolean, arguments[]}`. Editor: дан фрагмент + проблема → минимальная правка (diff-предложение, plain text). Interpreter: фрагмент → JSON `{interpretation, alternatives[], scope, limitations}`. Assistant: исследовательский помощник, RU-ответы, честность о границах знаний.

## Дизайн-система (кратко, детали в docs/DESIGN.md от главного агента)

Тёмная обсерватория по умолчанию (next-themes, class="dark", поддерживается светлая). Акценты: teal/emerald (primary), amber (warning), rose (error/conflict), lime/fuchsia/orange — слои. Запрещены indigo/blue как основные. Слои атласа: подчёркивание (цвет+стиль) + легенда + тултипы, не сплошная заливка. Все интерактивные элементы — с hover/focus состояниями, кастомный скроллбар, max-h-96 overflow для длинных списков. Статусные бейджи — компонент `StatusBadge`. Паспорт доказательности — `EvidencePassport`. Копирование — `CopyButton` с fallback-диалогом.

## Honest placeholder registry (PLACEHOLDER — то, что НЕ реализовано)

Единый список (используется в RegistryStudio и handoff-отчёте):
1. `ollama-pull` — загрузка моделей через UI (не реализовано; используйте `ollama pull <model>` локально).
2. `embeddings-index` — векторный индекс по всему документу через embedding-модель (подключение embedding-проб реализовано, индекс — нет; сходство повторов — лексическое LOCAL).
3. `github-publish` — публикация изменений в GitHub (требует отдельного разрешения и токена; не реализовано).
4. `scheduled-runs` — отложенные/повторяющиеся запуски по расписанию (не реализовано).
5. `streaming-chat` — потоковый вывод чата (не реализовано; ответы приходят целиком).
6. `auto-suggest-scenario-tree` — автогенерация полного дерева без участия пользователя (осознанно не реализовано: см. ТЗ п.7).

## Процесс работы агентов

1. Прочитать `/home/z/my-project/worklog.md` (записи предыдущих агентов).
2. Сделать работу строго в своих файлах.
3. Проверить через curl/lint (только свои файлы: `bunx eslint <files>`).
4. ДОписать секцию в worklog.md (шаблон ниже), НЕ перезаписывая существующее.

```markdown
---
Task ID: <id>
Agent: <имя>
Task: <задача>

Work Log:
- <шаг 1>
- ...

Stage Summary:
- <результаты/решения/артефакты>
```
