# S2 — диагностика пропущенного retry и адресная регрессия

Дата: 2026-10-23. Реальные модельные и embedding-вызовы не выполнялись. <br>
Рабочая кампания: `cmvkwu1ey0001ve1krfjhwdo0` — прочитана без изменений. <br>
Изолированная fixture: `[локальный абсолютный путь скрыт]` (`[DIAGNOSTIC]`, синтетические данные).

## Причина в рабочем пути

В кампании настройка задавала `maxRetriesPerAction=3`, `maxAdditionalChecksPerPosition=1`, бюджет `30`, последовательность `1`, `stopOnQuota=true`, `stopOnTechnicalError=false`. Для второй позиции сначала завершились Interpreter и Challenger с `interactionStatus=concern`. Перед единственным `concern-review` оркестратор увеличил `additionalChecksUsed` до 1.

Сохранённый сбой:

| Объект | Сохранённые сведения |
|---|---|
| Action | `cmvkx3haa002yve1kpgdvfm62`, тип `concern-review`, Challenger, attempt 1, `failed` |
| Run | `cmvkx3has0033ve1kswbcmn1v`, `failed`, ошибка `Истекло время ожидания ответа FreeLLMAPI` |
| ModelCall | `cmvkx3hbl0035ve1kac5lfh0s`, `failed`, backend `freellmapi`, requested model `auto`; actual provider/model не сохранены; отдельного структурированного error code нет |
| Счётчики | 10 предыдущих действий + эта неуспешная попытка = 11/30 после timeout. Вывод по порядку сохранённых действий; промежуточный budget snapshot не записывался. Итог кампании — 16/30. |
| Item до review | `interactionStatus=concern`; единственная дополнительная проверка была выделена этому review. Отдельного сохранённого снимка промежуточного item после timeout нет. |
| Следующее действие | `scenario-plan`, `cmvkx62by0037ve1kla76gh8i`; concern-review attempt 2 отсутствует среди всех actions кампании. |

Retry классификатор в `research-campaign-core.ts` правильно распознавал эту локализованную ошибку как временный timeout. Потеря происходила раньше классификатора на следующем `advance`: ветвь `concern-review` проверяла `additionalChecksUsed >= maxAdditionalChecksPerPosition` и вызывала `skipStage`, не доходя до `executeAction`. Уже использованный лимит одной содержательной проверки ошибочно блокировал технический повтор этой проверки.

Результат позиции — `insufficient-data`, `reviewStatus=pending`: модельное замечание Challenger осталось непроверенным; автомат завершил остальные этапы, не получив результата review. Завершение очереди не означало подтверждение положения. Квота не срабатывала; техническая ошибка не останавливала всю кампанию по выбранной политике.

### Сервер и фактический путь

Рабочий маршрут `src/app/api/research-campaign/route.ts` вызывает `advanceResearchCampaign` из `research-campaign-engine.ts`. Изолированная проверка импортирует тот же route handler и engine с default `executeRun`. Mock заменяет только `globalThis.fetch` для точного FreeLLMAPI chat endpoint; `createRun`, сбор сообщений, выполнение, запись/завершение ModelCall, классификация, lease и бюджет идут штатно. Любой fetch вне локального тестового endpoint бросает ошибку, поэтому внешние запросы невозможны.

В момент проверки listener 3102 принадлежал Next dev worker PID `19496`; процесс `next dev --port 3102` стартовал 23.10.2026 в 14:47:30 локального времени. Кампания создана в 14:52:15, а timeout записан около 14:59–15:01. Файл классификатора timeout был изменён до старта сервера (08:24). Это подтверждает, что причина не объясняется отсутствием timeout-классификации и не требует гипотезы об устаревшем сервере. Папка проекта не является Git checkout, поэтому точный commit/build digest и хэш загруженного Next dev модуля установить нельзя; это остаётся ограничением атрибуции.

## Падающая регрессия и исправление

Расширен существующий `scripts/s2-isolated-research-ui-acceptance.mjs`; новый тестовый framework не добавлялся. Fixture создаёт только минимальный campaign item на стадии `concern-review`, с `interactionStatus=concern` и лимитом дополнительной проверки 1. Первый вызов штатного `advance` создаёт action/Run/ModelCall и проходит через настоящий `executeRun`. Транспортный mock бросает `DOMException` с `AbortError`; FreeLLMAPI клиент сам преобразует её в точное рабочее сообщение `Истекло время ожидания ответа FreeLLMAPI`. Так сохраняются failed Action, Run и ModelCall обычным кодом. После первой попытки `additionalChecksUsed=1`.

До исправления scheduler-level регрессия через тот же route/engine создала failed action с точной сохранённой строкой и входным состоянием из кампании; второй `advance` попал в guard, перескочил к `scenario-plan` и не создал attempt 2, поэтому assertion упал. Затем test seam был усилен до замены только provider fetch: post-fix проверка подтвердила маппинг AbortError в FreeLLMAPI timeout, штатную запись ModelCall и создание attempt 2. Доисправленную версию именно с fetch-only seam отдельно не запускали; дефект уже был локализован в общем stage guard, до вызова provider transport.

Исправление в `research-campaign-engine.ts`: если у текущего `concern-review` уже есть failed action, стадия повторно проходит через `executeAction` даже при исчерпанном лимите дополнительных содержательных проверок. Далее штатный classifier решает, retryable ли ошибка, а `executeAction` применяет лимит попыток, общий бюджет и защиту от остановленной кампании. Для первой попытки дополнительная проверка по-прежнему учитывается один раз; retries не расходуют повторно лимит содержательных checks.

## Результат изолированной приёмки

После исправления та же регрессия проходит через API route handler в новой временной SQLite. Для проверки границы между попытками был создан новый экземпляр handler (без in-memory состояния), а два параллельных вызова `advance` выполнялись при lease конкуренции. Default `executeRun` создал ModelCall для обеих попыток.

| Проверка | Результат |
|---|---|
| Timeout attempt 1 → повтор после создания нового handler | Attempt 2 создан и сохранён; первая и вторая попытки принадлежат одному `concern-review` |
| Результат attempt 2 | Mock provider response прошёл через FreeLLMAPI parser и штатный `executeRun`; успешные Run и ModelCall сохранены, item перешёл к `scenario-plan` |
| Бюджет | 2 действия для 2 попыток; в отдельном fixture лимит 1 останавливает кампанию с `policy-budget-exhausted`, не создавая attempt 2 сверх бюджета |
| Параллельный advance | Один обработчик получил lease, второй вернул `waiting`; action count остался 2, дубль не создан |
| Три timeout | Сохранены attempts 1, 2, 3; четвёртого действия нет; review завершён как `not-confirmed`, поток перешёл дальше |
| Поздний Run | Адресная concern-review fixture: после failed Action первый Run завершился поздно; следующий штатный advance переиспользовал его, завершил attempt 1 и не создал второй action/транспортный вызов |
| Cancel / quota | Существующие acceptance проверки сохраняют отмену без retry и 429 как `provider-quota`; campaign не запускает повторы при этих состояниях |
| Транспорт | Mock-ом заменён только provider fetch. Всего 7 intercepted chat transport calls и 7 штатных ModelCall для целевых retry fixtures; внешних сетевых вызовов — 0. Обычная ModelCall provenance, включая failed timeout и actual route диагностического ответа, сохранена. Отдельные прежние runExecutor fixtures остаются transport-free и scoped assertions подтверждают у них отсутствие ModelCall. |

Таким образом, прежние тесты проходили потому, что timeout проверялся на стадии `interpretation`, где нет лимита `maxAdditionalChecksPerPosition`. Они покрывали классификатор и планирование retry внутри `executeAction`, но не проверяли вход в `executeAction` с исчерпанным лимитом стадии `concern-review`.

## Адресный разбор `criterionBasis` по `6.2.1.1`

Переданный source Fragment `6.2.1.1` гласит: “Use accessible excerpts only within their actual scope.” В одном сохранённом сценарии передано:

- objective: «Обеспечить, что отрывки не используются, когда требуемый материал недоступен.»
- input: ситуация, где требуемый материал недоступен;
- expected behavior: «Отрывок не используется.»;
- criterion: «Отрывок не применяется.»;
- source: только Fragment `6.2.1.1`.

Evaluator вернул `criterionBasis=supported`, `verdict=pass`; объяснение утверждает, что reasoning опирается на исходный материал о scope отрывков. CampaignCheck сохранён как `completed`. Однако источник ограничивает использование доступных отрывков их фактической областью; он не задаёт отдельно универсальное правило «не использовать отрывок, если требуемый материал недоступен». Это добавленное тестом условие нельзя считать независимо доказанным лишь по полю `criterionBasis`.

**Классификация: случай B — граница защиты.** Система принимает модельное заявление `supported` и использует его для завершения CampaignCheck; независимой логической проверки критерия к исходному Fragment нет. Два других сценария `6.2.2.1` проверяют прямо сформулированные запреты на восстановление из названия/миниатюры и аннотации/имени репозитория.

Этот спорный pass не изменил итог первой позиции на подтверждение: итог сохранён как `insufficient-data`, поскольку взаимодействие оставалось `concern`, а Challenger review не подтвердил замечание. Пользовательский статус позиции остался `proposed`. Отдельный детерминированный regression assertion на семантическое следование без формализованного правила был бы выдумыванием новой нормы; новый модельный «суд» запрещён заданием, поэтому семантический дефект зафиксирован как ограничение, а не маскируется тестом.

## Проверки после исправления

- `pnpm exec tsc --noEmit` — passed.
- `node scripts/s2-research-ui-unit-tests.mjs` — 13 passed, 0 failed.
- `node scripts/s2-isolated-research-ui-acceptance.mjs [локальный абсолютный путь скрыт] [локальный абсолютный путь скрыт].db` — passed. До исправления scheduler-only regression упала на ожидании attempt 2; финальная fixture затем использовала только provider transport mock на default route/executeRun и прошла retry, конкурентность, бюджет, три попытки, поздний Run в concern-review, отмену и quota. Финальная fixture сохранила 7 ModelCall, выполнила 7 перехваченных transport calls и 0 внешних сетевых вызовов.
- `pnpm exec eslint src/lib/research-campaign-engine.ts scripts/s2-isolated-research-ui-acceptance.mjs` — passed.
- `http://localhost:3102/api/health` — `{ok:true}`. Рабочий сервер не перезапускался и не останавливался; Next dev использует сохранённую папку проекта.
- Рабочая кампания и база не менялись. Новые кампании и рабочие model calls не создавались.

**Не проверено:** реальный FreeLLMAPI retry намеренно не повторялся. Изолированная проверка подтвердила штатное создание/сохранение attempt 2 и переходы после него, но не гарантирует поведение сетевого провайдера. Семантическая корректность `criterionBasis=supported` остаётся модельной оценкой без независимого verifier.
