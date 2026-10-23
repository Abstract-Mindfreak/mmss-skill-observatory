# S2 — сквозной прогон автоматического исследования

## Область и основания

Проверка выполнена 23.10.2026 в целевом проекте «MMSS — чистое исследование 01» (`cmvgroxrx002uved0g044hi2h`), версия `cmvgroyip002yved0dim8gnss`, метка `origin`, SHA-256 `ddd187d4cffe8863a07ce812d33de3cb5bd7f557af84b97e6486f79ac9094776`. Preview API сопоставил выбранные положения с точными путями исходной версии:

| Положение | ID положения | Source Fragment ID | Путь |
|---|---|---|---|
| Запрет восстановления недостающего контента | `contour-pos-0a3bbf170a3bbf170a3bbf17` | `cmvgroyk100coved0szkdtq02` | `6.2.2.1` |
| Использование доступных отрывков | `contour-pos-093bbd84093bbd84093bbd84` | `cmvgroyk100cmved0no8zpe2d` | `6.2.1.1` |

Кампания: `dd2709814cec459aad6fa6b8c4455ad3`. Это отдельная новая запись с сохранёнными scope и policy. Снимок ролей в кампании указывает Interpreter, Challenger, Explorer, Executor и Evaluator на существующее подключение FreeLLMAPI `auto` (`cmvg360kn0001veogihraco4q`). Назначения проекта перед и после запуска не менялись; embedding не использовался.

Политика: depth `full`; максимум 2 сценария на положение; 1 дополнительная проверка замечания на положение; максимум 3 попытки на действие; конкурентность 1; остановка по квоте включена; лимит этой приёмки — 30 текстовых действий; эксперимент переписывания выключен. Кампания создала два сценария на каждое положение и израсходовала 14/30 действий. Сохранено 14 связанных action/Run/ModelCall трасс: 12 завершённых действий и 2 неуспешных. Скрытого переключения назначения не видно.

## Результат кампании

| Путь | Завершённые этапы | Сохранённые проверки | Заключение и ограничения |
|---|---|---|---|
| `6.2.1.1` — «Использование доступных отрывков» | Interpreter: supported; Explorer: два сценария; Executor и Evaluator для обоих сценариев завершились; оба сохранённых verdict — `pass`. Проверка Challenger завершилась timeout. | `[VALIDATION] [AUTO-RESEARCH] Использование отрывка в несоответствующем контексте`; `[VALIDATION] [AUTO-RESEARCH] Граничный случай: Использование отрывка для описания смежной, но не идентичной ситуации`. | `insufficient-data`. Interaction — inconclusive из-за `Истекло время ожидания ответа FreeLLMAPI`; review остался pending. Положительные verdict относятся к двум выполненным сценариям, не к правилу в целом. |
| `6.2.2.1` — «Запрет восстановления недостающего контента» | Interpreter: supported; Explorer: два сценария; Executor и Evaluator для обоих сценариев завершились; оба сохранённых verdict — `pass`. Проверка Challenger завершилась timeout. | `[VALIDATION] [AUTO-RESEARCH] Запрет восстановления по названию`; `[VALIDATION] [AUTO-RESEARCH] Запрет восстановления по аннотации`. | `insufficient-data`. Interaction — inconclusive из-за такого же timeout; review остался pending. Выполненные сценарии покрывают только восстановление по названию и аннотации. |

Сохранённые успешные Run имеют actual provider `cloudflare/@cf/zai-org/glm-4.7-flash` и actual model `@cf/zai-org/glm-4.7-flash`. У двух failed Challenger Run actual provider/model равны `null`; маршрут для этих неуспешных запросов неизвестен по сохранённым метаданным. Не выводить его из назначения `auto`.

Четыре `pass` оценивают критерии созданных кампанией сценариев. Первый сценарий для `6.2.1.1` потребовал привязки цитаты к конкретному источнику, хотя сам Fragment явно такого условия не формулирует; второй ввёл контексты Accessibility/Security, которых нет в Fragment, и сам Run отметил отсутствие полного контекста Security. Это ограничения сценариев, а не основание повышать силу заключения.

Связи action → Run → ModelCall сохранены для всех 14 действий:

| Path | Тип / роль | Состояние | Run ID | ModelCall ID | Actual provider/model |
|---|---|---|---|---|---|
| `6.2.1.1` | interpretation / interpreter | completed | `cmvki1bo7000dveyo71en0bdn` | `cmvki1boy000fveyondfw5c7p` | `cloudflare/@cf/zai-org/glm-4.7-flash` / `@cf/zai-org/glm-4.7-flash` |
| `6.2.1.1` | interaction / challenger | failed, attempt 1 | `cmvki2boo000mveyombs6i2xo` | `cmvki2bpb000oveyowxl4lvpg` | неизвестно / неизвестно |
| `6.2.1.1` | scenario-plan / explorer | completed | `cmvki4x2l000uveyo9k5l9l6r` | `cmvki4x3b000wveyoj45ih2fy` | `cloudflare/@cf/zai-org/glm-4.7-flash` / `@cf/zai-org/glm-4.7-flash` |
| `6.2.1.1` | executor | completed | `cmvki6rqs001eveyom8kposcj` | `cmvki6rrn001gveyogynkeaip` | `cloudflare/@cf/zai-org/glm-4.7-flash` / `@cf/zai-org/glm-4.7-flash` |
| `6.2.1.1` | evaluator | pass | `cmvki7gv1001mveyouvlrygzz` | `cmvki7gvq001oveyojh2ahhvr` | `cloudflare/@cf/zai-org/glm-4.7-flash` / `@cf/zai-org/glm-4.7-flash` |
| `6.2.1.1` | executor | completed | `cmvki7t95001uveyoehww4f52` | `cmvki7t9z001wveyovdei81z5` | `cloudflare/@cf/zai-org/glm-4.7-flash` / `@cf/zai-org/glm-4.7-flash` |
| `6.2.1.1` | evaluator | pass | `cmvki8mpp0022veyo2p8qh53z` | `cmvki8mqh0024veyorhvvap0a` | `cloudflare/@cf/zai-org/glm-4.7-flash` / `@cf/zai-org/glm-4.7-flash` |
| `6.2.2.1` | interpretation / interpreter | completed | `cmvki8yst002aveyoehnszs39` | `cmvki8yte002cveyoejhy9x7x` | `cloudflare/@cf/zai-org/glm-4.7-flash` / `@cf/zai-org/glm-4.7-flash` |
| `6.2.2.1` | interaction / challenger | failed, attempt 1 | `cmvki9ee0002jveyoc0td2fon` | `cmvki9eer002lveyocoqosuhi` | неизвестно / неизвестно |
| `6.2.2.1` | scenario-plan / explorer | completed | `cmvkibzpn002rveyox4ivqlgs` | `cmvkibzqb002tveyoi0sojri0` | `cloudflare/@cf/zai-org/glm-4.7-flash` / `@cf/zai-org/glm-4.7-flash` |
| `6.2.2.1` | executor | completed | `cmvkid9kj003bveyonkcuytay` | `cmvkid9l9003dveyo4jcyxey3` | `cloudflare/@cf/zai-org/glm-4.7-flash` / `@cf/zai-org/glm-4.7-flash` |
| `6.2.2.1` | evaluator | pass | `cmvkidtbk003jveyo2399kaus` | `cmvkidtc8003lveyov7pyzn09` | `cloudflare/@cf/zai-org/glm-4.7-flash` / `@cf/zai-org/glm-4.7-flash` |
| `6.2.2.1` | executor | completed | `cmvkidxyd003rveyo9qdmokrj` | `cmvkidxz6003tveyo8o5jju7l` | `cloudflare/@cf/zai-org/glm-4.7-flash` / `@cf/zai-org/glm-4.7-flash` |
| `6.2.2.1` | evaluator | pass | `cmvkiejm8003zveyoma7500vy` | `cmvkiejnb0041veyom36c47g3` | `cloudflare/@cf/zai-org/glm-4.7-flash` / `@cf/zai-org/glm-4.7-flash` |

## Заключение о функции и обнаруженный дефект

**Автоматический механизм отработал:** подготовил область, создал кампанию и сценарии, выполнил доступные шаги, связал результаты с источниками и сохранил финальные заключения. **Исследование не установило корректность положений:** оба итога `insufficient-data`, несмотря на четыре локальных `pass` от Evaluator.

Сбой завершения Challenger записался русским сообщением `Истекло время ожидания ответа FreeLLMAPI`. Классификатор временных сбоев не распознавал эту формулировку и не назначал разрешённый повтор; после ошибки этап отмечался inconclusive. Исправлена классификация этого текста как временной ошибки, добавлена регрессия в unit и isolated acceptance. Исправление проверено после кампании; уже сохранённая кампания и её заключения не переписывались и не перезапускались.

По другим сохранённым кампаниям текущий API показал шесть записей до этого прогона, а не три, указанные в более раннем отчётном снимке. Среди них: `5b433c80a40e4e10a08b129ffa9a4b64` completed 23/80, все 3 заключения `not-explored`; `00e90a68cb314534a276b347b03ca76e` сохранён как `running` 11/20, этап evaluator, без lease и выполняющихся действий, с последней причиной timeout; `a87eb6bc3e5c4719ab4ebfa202420b91` cancelled пользователем при 20/20; `cmvjzf06b00a5vei0xzxsw1iq` completed 20/20 с `policy-budget-exhausted`; `cmvjy5sbt0010vei0j6f0e5rg` paused 20/20 по тому же ограничению; `cmvjvom1p0001vei0e9owjpbx` completed 9/20. Эти записи не изменялись. `completed` на уровне очереди означает завершение обработки очереди, но не положительное или достаточное заключение по каждому положению.

## Проверки и ограничения

- Изолированный mock acceptance на временной SQLite прошёл: полный успешный цикл, подтверждённое замечание, противоречивые Evaluator verdict при исчерпанном лимите дополнительной проверки, локализованный timeout с последовательной повторной попыткой, quota stop, конечная область без общего бюджета, отсутствие лишнего действия после лимита. ModelCall в fixture: 0.
- Unit-набор `scripts/s2-research-ui-unit-tests.mjs`: 13 passed, 0 failed.
- Реальный API проекта на 3102: health и preview доступны; до/после зафиксированы проект, версия, назначения и состояние кампании.
- Браузерная проверка во время реальной кампании не выполнена: текущая браузерная policy запрещает доступ к localhost. UI header, переходы, иерархия действий и ручной возврат пользователя остаются непроверенными в браузере; API-трасса их не заменяет.
- Не изменялись текст инструкции, положения, их статусы, существующая история, подключения, назначения, embedding и записи старых кампаний. Не создавались Finding, Observation или пользовательское решение. Новые записи ограничены кампанией, её проверками, Run и ModelCall.
- Следующий шаг по данным — открыть обе записи и отдельно рассмотреть две inconclusive проверки Challenger; не трактовать локальные `pass` как принятие положения. Повтор этих действий в завершённой кампании не выполнялся.

## Адресная проверка сценарных оснований и восстановления

Последующая read-only проверка исходных фрагментов, Explorer/Evaluator prompt и критериев, а также локальные исправления сценарного контракта и retry зафиксированы отдельно в [S2-SCENARIO-PROVENANCE-AND-RECOVERY.md](S2-SCENARIO-PROVENANCE-AND-RECOVERY.md). Исторические сценарии и оценки кампании не переписывались.
