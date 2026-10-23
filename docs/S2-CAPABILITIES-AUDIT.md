# S2 — аудит фактических возможностей

**Срез:** 20 октября 2026 г. **Операция:** аудит существующего стека. Первоначальный read-only аудит не изменял приложение и данные.

## Метод и краткая картина

- **[Код]** Статически найденная реализация, не доказательство запуска.
- **[Выполнение]** Фактически выполненная операция.
- **[Документация/UI]** Заявление интерфейса/комментария.
- **[Вывод]** Ограниченное толкование.
- **[Не проверено]** Исполнение недоступно.

S2 — Next.js/SQLite приложение исследования инструкций. prisma/schema.prisma содержит Project, Document, DocumentVersion, Fragment, Analysis, Scenario, Run, Finding, Note, Connection, Assignment и ChatMessage. Разделы перечислены в src/lib/store.ts.

**[Выполнение]** Read-only агрегаты db/custom.db: 1 проект, 18 реальных запусков, 0 реальных находок, 0 находок с непустым evidence JSON, 1 реальная заметка, 12 сценариев с origin не demo. Тексты запусков не читались.

**[Код]** Run, локальные проверки JSON и verdict Evaluator существуют. Автоматическое создание Finding из ответа/вердикта не найдено; API создания Finding в просмотренных маршрутах не обнаружено. Embedding в S2 — проба, не индекс; индекс и семантический поиск — PLACEHOLDER.

**[Выполнение]** S2 использует ранее настроенный порт 3102, открытый в браузере. Первоначальная проверка localhost:3000/3001 касалась только этих портов и не определяет доступность S2.

## 1. Карта разделов

| Раздел | Назначение и результат | Реализация |
|---|---|---|
| Обзор | Проект, сводные показатели, шаги цикла; читает данные. | UI есть. |
| Instruction Atlas | Текст/версии/фрагменты, слои, интерпретации, заметки, сценарии, runs, findings, связи. | Analysis для интерпретации, Note для заметки. |
| Карта правил | Узлы, рёбра, фильтры, панель узла. | Вычисляется из локального Analysis и связанных данных; рёбра отдельно не хранятся. |
| Failure Roads | Карточки дорог решений и потенциальных отказов. | По roads-map.ts/roads-pits.ts подготовленная навигация, не динамический анализ проекта. |
| Scenario Tree | Создание/правка сценариев, status/pin/fragment, Executor, ветви Explorer. | Scenario сохраняются; Explorer создаёт дочерние Scenario. |
| Behavior Lab | Выбор роли/backend/model, запуск 1–10, просмотр/cancel/retry, Evaluator/Challenger/Editor, ручной verdict. | Run сохраняет input/output/checks/verdict; Finding автоматически не создаёт. |
| Evolution Studio | Версии, diff, экспериментальная правка, impact. | Новые DocumentVersion/Analysis; GitHub publish PLACEHOLDER. |
| Метрики | Карточки/графики/drill-down/CSV. | Вычисления с provenance; значения не проверялись. |
| Подключения | Ollama/FreeLLMAPI connection, тесты, модели, generation/embedding probe, назначения. | Connection/Assignment в SQLite; live запросов не было. |
| Экспорт и передача | JSON archive, Markdown, CSV, graph, Handoff md/json, импорт архива. | Код есть; реальный export/import не запускался. |
| Реестр статусов | LIVE/LOCAL/DEMO/PLACEHOLDER/STALE/ERROR, заглушки, DEMO manager. | Реестр в src/lib/types.ts. |
| Помощник | Проектный чат, optional fragment context. | ChatMessage; до 10 сообщений в prompt, история API до 200. |

Текст версии хранится в DocumentVersion.content; остальные исследовательские сущности — отдельные модели Prisma. UI-контекст сохраняется браузером отдельно.

## 2. Роли и провайдеры

| Роль | Где запускается и что отправляет | Сохранение и провайдеры |
|---|---|---|
| Executor | Behavior Lab, /api/runs. System содержит полный или relevant skill, user — задачу. Сохранённые запуски полного режима подтверждают передачу 47 295 символов; прежнее утверждение о пороге 24 000 было неверным. | Run, output/checks, отправленные сообщения и skill verification SHA-256/size. Общий runner поддерживает Ollama/FreeLLMAPI/session-cloud. |
| Explorer | Scenario Tree, /api/scenarios/[id]/suggest. Сценарий, fragment/section/relevant context, count; JSON mechanisms; не полный skill. | Создаёт дочерние Scenario, не Run. Поддерживает Ollama, FreeLLMAPI и session-cloud. |
| Evaluator | Behavior Lab, общий /api/runs. Критерий и output, без skill; JSON verdict/reasons. | Run/parentRunId/verdict, не Finding. Поддерживает FreeLLMAPI и Ollama. |
| Challenger | Behavior Lab. Finding title/description по findingId и задача; JSON refuted/arguments. | Run с findingId в input; Finding status не меняет. |
| Editor | Behavior Lab. Fragment и задача; plain text original/replacement/rationale. | Run output; правку не применяет. |
| Помощник | /api/projects/[id]/chat. System prompt, до 10 сообщений, вопрос и опциональный fragment; не полный skill. | User сохраняется до вызова, ответ после успеха; поддерживает FreeLLMAPI и Ollama. Фактические provider/model сохраняются в новых сообщениях Assistant. |
| Интерпретатор | Atlas, /api/versions/[id]/analyze-model, до 12 fragments. Текст фрагмента + focus; JSON interpretation/alternatives/scope/limitations. | Analysis(model-interpret); новые элементы хранят фактические provider/model. Поддерживает FreeLLMAPI и Ollama. |
| Embedding | Connections probe одного текста; отдельный Assignment role=embedding. | Ollama /api/embed (fallback /api/embeddings) или FreeLLMAPI /embeddings; выводит dimensions/8 чисел, вектор не сохраняет. |

**[Код]** /api/runs проверяет backend и connection.kind, маршрутизирует FreeLLMAPI в chatFreeLLM. Фактические provider/model сохраняются для новых текстовых Run всех ролей, новых ChatMessage Assistant и элементов Analysis Интерпретатора. Для старых записей метаданные не восстанавливаются. Отображение и Handoff различают тип подключения, название, запрошенную модель и фактические provider/model, если они известны.

FreeLLMAPI доступен для всех семи текстовых ролей. Embedding остаётся отдельным назначением; существующая локальная Ollama-модель не переназначалась.

## 3. Сущности, фрагменты и исследовательский цикл

| Сущность | Реальная форма |
|---|---|
| Проект/документ/версия | Project → Document → DocumentVersion с текстом/hash/source/parentVersionId. |
| Фрагмент | section/paragraph/sentence/list_item; path/order/строки/text; parentFragmentId нет. |
| Анализ/интерпретация | Analysis JSON; model-interpret items содержат fragmentId. |
| Сценарий/run | Scenario tree через parentId; Run через scenarioId/versionId/parentRunId. |
| Проверка/оценка | programChecks — JSON Run.input; verdict — поля Run. |
| Finding/гипотеза | Finding с optional IDs и evidence JSON; hypothesis — статус. Optional refs не FK. |
| Оспаривание/evidence | Finding status, Note objection, Challenger Run — разные записи; EvidenceChain JSON, refId строковый. |
| Правка/новая версия | Editor output — Run; версия создаётся отдельно. |

src/lib/parser.ts разбирает YAML front matter, заголовки Markdown 1–3, paragraphs, list items и предложения через `.?!`. path — вычисляемая метка, startLine/endLine — 1-based; не токенные offsets и не стабильные семантические ID. Иерархия восстанавливается по path/строкам.

Типы рёбер: defines, uses, restricts, refines, excepts, depends-on, repeats, conflicts, scenario-supported, disputed, missing-link. Basis: shared-term, section-reference, lexical-similarity, structure, scenario-link, finding-link, definition. Section/Scenario связи основаны на данных; modal layers, Jaccard repeats, shared terms/conflicts — эвристики, не доказательство противоречия. GraphEdge отдельно не хранится.

**Путь Run → Finding:** Executor сохраняет Run/output; завершение переводит unexplored Scenario в explored, но не run-verified. Evaluator создаёт отдельный Run/verdict. Пользователь может изменить verdict и создать Note. Finding требует отдельной записи и EvidenceChain. API/UI создания Finding и автоконверсия Run/verdict/Note не найдены. Challenger получает findingId, но не меняет статус. Это объясняет ноль findings/evidence при наличии запусков.

Atlas coverage — наличие Scenario→fragment/leaf привязки, не успешная проверка требования. Метрика scenario-coverage считает explored/run-verified. Алгоритм выбора следующего теста не обнаружен; Explorer предлагает ветви.

## 4. Экспорт, импорт и embedding

| Формат | Содержание и ограничения |
|---|---|
| Project Archive JSON | mmss-observatory-archive v1; полные версии, сценарии, Run input/output/checks/verdict, findings/evidence, notes, assignments, chat, analyses; connections исключены. Import создаёт новый проект, remap ID; fragments анализируются заново. |
| Research Handoff md/json | Цель, документ, изменения, analyses, краткие runs, opt-in runs-full, findings/evidence/disputed/hypotheses/errors/limitations/placeholders/next steps; demo исключены. Полный текст инструкции в runs-full по отдельному переключателю (по умолчанию исключён). Не архив, importer не принимает. |
| Markdown/CSV | Сводки; CSV в основном сценарии/runs/findings/notes, requested backend/model. Необратимы. |
| Graph export | Вычисленный снимок активной версии. |
| Run chat-ready | Очистка заменяет system skill body ссылкой при точной сверке; передаёт version/SHA-256/size/mode/status. При сомнении скрывает body, историю не меняет. |

Project Archive сохраняет полные Run.input/sentMessages, не очищается и не становится неполным. Handoff redaction применяется к копии отчёта и переиспользует очистку карточки запуска; она сохраняет ссылку на контекст, SHA-256, размер, режим и результат сверки и не меняет историю. Полные пользовательские запросы и ответы остаются в отчёте. Внешний Handoff JSON не импортируется: importer требует archive format/version.

Embedding S2: проба выдаёт размерность и первые 8 чисел, vector не сохраняется; vector table отсутствует. PLACEHOLDER_REGISTRY явно отмечает фрагментный индекс как отсутствующий. Повторы в src/lib/analysis.ts вычисляются Jaccard stemmed tokens — лексический, не embedding поиск.

## 5. Соседний mmss-meta-crystal

Ограниченно просмотрены rag-v3, combinatorial-genesis, python_engine/anchoring_v3; аудио CLAP/SigLIP исключены.

Код содержит canonical parameter records с technical_name, типом, допустимыми значениями, scope/source. searchV3 делает lexical recall, option matching, relation alignment, затем composite ranking из embedding cosine + lexical + option similarity + relation bias + exact matches; topK 1–200 и concept coverage. Это смешанный retrieval. Есть manifest/binary float vectors/hash cache, query/concept embedding calls; свежесть файлов/Ollama не проверена.

Anchoring без LLM — каскад: L0 exact Select option, technical_name+число, дробь, число/unit/quantity_kind; Range clamp/snap. L1 direction/degree lexicons, relation hints/current value; ordinal Select positions, nominal aliases/exact match. L2 embedding anchors с threshold; Select выбирает лучший option, Range — softmax-взвешенную позицию, затем clamp/snap/direction. Следовательно range не выбирается только embedding. Anchors/axes дополняют путь; stub отключает axes. API build/status/propose существует, но endpoint не доказывает успешную сборку.

| Часть | Оценка переиспользования |
|---|---|
| API всего проекта | Не напрямую: собственные БД/runtime/домен. |
| Формат records/provenance | Адаптировать для собственной схемы S2. |
| Composite top-K и manifest/vector cache | Переносимы после S2 index и собственной метрики/rebuild policy. |
| L0/L1/L2 | Образец для типизированных значений, не готовый поиск инструкций. |
| Audio axes/anchors | Не переносить без обоснования доменной семантики. |

**[Вывод]** Готовый API/модуль без существенной адаптации не подтверждён; применимы отдельные механизмы.

## 6. Разрывы и следующие действия

- **Существует:** общий FreeLLMAPI runner/Assignment, отдельное embedding назначение.
- **Неполно:** Run не становится Finding; Explorer создаёт Scenario, не Run; evidence refs не FK.
- **Отсутствует:** S2 vector index/search; импорт внешнего отчёта; Finding creation flow; export-only sanitization.
- **Неизвестно:** фактические headers исторических запросов (метаданные не восстанавливаются); текущее состояние vector/anchor файлов соседа.

Оставшиеся направления: 1) пользовательское создание Finding из Run/Evaluator с evidence gaps; 2) отдельный валидируемый внешний JSON importer; 3) определить поиск до разработки S2 vector index.

## Проверки

| Проверка | Результат |
|---|---|
| Статический разбор ключевой схемы/UI/routes/runner/export/import | Выполнен в указанном объёме, не построчный аудит. |
| Read-only counts db/custom.db | 1 project, 18 real runs, 0 real findings, 0 findings with evidence, 1 real note, 12 non-demo scenarios. |
| Порт приложения | 3102 — проверен локально; первоначальная проба 3000/3001 не характеризует доступность S2. |
| Локальная проверка изменений | TypeScript noEmit; ручные малые примеры JSON без LLM. |
| Модельные вызовы, реальные import/export | Не выполнялись. |

## Точечное уточнение после настройки S2

FreeLLMAPI доступен во всех семи текстовых ролях через общий адаптер; role-specific prompt/context не расширялись до полного skill автоматически. Embedding осталось отдельным назначением с прежней локальной Ollama-моделью. Фактический provider/model сохраняется в новых Run, Assistant ChatMessage, Analysis items и сгенерированных Explorer Scenario; прежние записи не дополнены вымышленными значениями. Handoff по умолчанию очищает текст инструкции только в экспортируемой копии; восстановительный Project Archive остаётся полным. В SQLite добавлены nullable-поля метаданных ChatMessage/Scenario и nullable название подключения для ChatMessage; имеющиеся строки и содержимое не менялись.
