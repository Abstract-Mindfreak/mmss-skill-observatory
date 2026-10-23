# S2 Research workspace — implementation report

**Status (updated 2026-10-23):** implementation present; isolated browser start and navigation acceptance passed on a standalone test copy at port 3103. Loading/error/empty were shown; partial response semantics and confirmation-dialog focus restoration remain unverified. No real model/embedding calls or working-data mutations were performed. <br>
**Checked app:** `http://localhost:3102/` <br>
**Project:** `cmvgroxrx002uved0g044hi2h` — «MMSS — чистое исследование 01» <br>
**Version:** `cmvgroyip002yved0dim8gnss`, `origin`, SHA-256 begins `ddd187d4cffe`, 47,295 characters.

This report records Stage 2 implementation, distinct from the read-only baseline in `S2-CURRENT-RESEARCH-CLEAN-REPORT.md`. The original audit facts were not rewritten. Design decisions and validation state are in `S2-UI-REMODIFICATION-MMSS.json` and `S2-UI-REMODIFICATION-REVIEW.md`.

## Implemented

- Research is the default central workspace. It shows project/version, compact aggregate state, current campaign, saved campaigns, and links to Atlas, Behavior Lab, Scenarios, diagnostics, and export.
- New campaign setup uses «Область → Политика → Проверка и запуск». A bounded/filterable scope picker and policy preview precede an explicit start confirmation. Canceling setup creates no campaign. Draft inputs persist in this browser tab and restore when returning.
- Campaign details separate queue state, required check stages, automated conclusion, and user decision. Stop causes distinguish budget, provider quota, temporary upstream error, import reconciliation, application error, user pause/cancel, stale version, and unknown. Resume is disabled when current saved conditions do not permit it. Budget usage is retained across resume and explicit budget extension.
- Role assignment/requested model and saved actual provider/model/ModelCall are displayed as separate provenance. Unknown actual fields stay unknown.
- Campaign role assignment snapshots are preserved as historical routing metadata; connection configurations and secrets are not copied by that snapshot.
- Event notes are an opt-in display of factual saved actions/runs only. No generated explanation or hidden-reasoning reconstruction was added.
- Semantic search reports incompatible saved vectors without changing their persisted status.
- Existing manual studios and routes remain available. This is a reversible navigation default change, not a full migration of all technical Atlas tools into a new advanced mode.

## API contract summary

| Action | Handler | Observed contract |
|---|---|---|
| Preview/read | `GET /api/research-campaign` | Reads version-scoped preview and campaigns; does not create a campaign |
| Create | `POST /api/research-campaign` | Creates `prepared`; accepts validated idempotency key |
| Start/advance | Same POST with `action=start` / `advance` | Start is explicit; execution uses the existing campaign engine |
| Pause/resume/cancel | Same POST with matching action | Existing status/version/budget guards apply |
| Budget change | Same POST with `action=update-budget` | Explicit bounded increase; used count and history remain intact |
| Imported campaign resume | Same resume control | Unreconciled import is rejected (isolated response 409) |
| Semantic search | Existing search handler | Stale incompatibility is reported; stored vector status is read-only |

The campaign handler accepts an injected executor for isolated tests; no new execution endpoint or schema migration was added. Retry remains a separate existing Run flow, not a campaign-level hidden retry.

## Validation

- Browser at port 3102: verified Research home, project/version summary, new setup scope → policy → preview, closing/restoring the draft, existing campaign state lanes, source link, and Run → Behavior Lab. In the latest read-only inspection, the saved campaign detail exposed existing Run/Scenario/Fragment links, saved actual provider/model and ModelCall IDs; the Research list showed three saved campaigns. The working project remained read-only; no campaign was created or started. Mobile viewport 390×844 exposed navigation and had no document horizontal overflow; full keyboard-only and screen-reader path remains unverified.
- Read-only API calls: health, Research State, campaign preview, full Project Archive, and Handoff returned HTTP 200. Full archive contained 1 project, 1 document/version, 1,555 fragment refs, 10 scenarios, 51 Runs, 134 ModelCalls, 88 semantic positions, 29 relations, 1 observation, 0 Findings, 1 Note, 0 ChatMessages, and 3 campaigns. Saved campaign states remained: completed 20/20, paused 20/20 with policy budget exhausted, completed 9/20. No import was performed.
- Isolated temporary SQLite with `[DIAGNOSTIC]` synthetic data and a mock executor: API acceptance created exactly one prepared campaign for an idempotent create, explicitly started it, completed one mock action, and confirmed a repeated API start did not create a duplicate. Other cases cover sequential timeout retry, pause/resume/cancel, quota/budget stop separation, import reconciliation, decision history and read-only stale search. For this follow-up a fresh SQLite fixture was prepared at `[локальный абсолютный путь скрыт]` with its app copy at `[локальный абсолютный путь скрыт]`, but the temporary Next.js server on 3103 failed to resolve Next modules through the `node_modules` junction and did not render the UI. No campaign was started through the UI; no working records were changed.
- `npx tsc --noEmit`: passed.
- `node --test scripts/s2-research-ui-unit-tests.mjs src/lib/semantic-search.test.mjs`: 16 passed, 0 failed.
- `scripts/s2-isolated-research-ui-acceptance.mjs` on a temporary database: passed.
- Target ESLint: one existing `react-hooks/set-state-in-effect` finding at `src/components/shell/app-shell.tsx:240`; running the same lint rule against the pre-change backup reproduces it at line 238. No new finding remains in the target files after correction.
- HTTP checks: `/api/health`, `/api/semantic/research-state`, and `/api/research-campaign` returned 200. Archive/Handoff returned 200.

## Not verified / limits

- No real text-model or embedding request was run. No working campaign was started, resumed, paused, or canceled.
- Browser verification still does not cover UI start click/payload/progress/double-click, observation/discrepancy return with preserved query/filter/version, all keyboard-only navigation, dialog focus restoration, or isolated loading/error/partial/empty branches. Prior API mock idempotency checks do not substitute for these browser checks. The latest isolated browser attempt was blocked by the temporary harness dependency path; the diagnostic server was stopped, and port 3102 was not restarted.
- Archive round-trip was performed after the latest changes on isolated temporary SQLite: campaign policy/role snapshot, action/source references, Run/ModelCall linkage and message provenance, decision/event history, blocked imported continuation, and no imported vectors/rebuild required. No import was run against the working database.
- The saved opt-in display contains factual events only. Explanatory policy notes and opt-in note export are not implemented.
- Not all technical Atlas panels were moved into a dedicated advanced mode. Original manual studios remain first-class navigation targets.
- Prisma schema was unchanged; no Prisma validation/client generation was required.
- Project state and counts matched the baseline snapshot during this check. This does not rule out independent changes outside the inspection window.

## Earlier incomplete UI acceptance snapshot (2026-10-23; superseded below)

| Area | Status | Evidence |
|---|---|---|
| Existing result → linked record/source → return | partially checked | Existing campaign and saved links were inspected read-only. No new navigation round-trip or context-retention check was performed. |
| Fresh isolated UI start, exact scope/policy payload, one campaign, progress | unverified | SQLite fixture exists, but temp Next UI failed to build through the dependency junction. |
| Double-click protection in browser | unverified | API mock idempotency was checked earlier; UI behavior was not. No application defect confirmed. |
| Tab/Shift+Tab, Enter/Space, visible focus, dialog close/return focus, no trap | unverified | Not exercised in this follow-up. |
| Isolated loading/error/partial/empty and draft retention | unverified | Not reproduced in browser. |
| Narrow screen on the complete main flow | partially checked | Previous 390×844 overflow check passed; end-to-end flow at that width remains unverified. |
| Working data safety | checked for this pass | Read-only browser inspection only; no start, decision, import, or model call. |

The table above records the state before the test stand was repaired. Campaign role assignment snapshots are preserved; this refers to saved role-routing metadata only and does not imply that connections or secrets were transferred.

## Isolated browser acceptance follow-up (2026-10-23)

The previous junction-based test server did not build because Windows/Turbopack could not resolve modules under the `node_modules` junction (`./D:/.../node_modules/.pnpm/...`, missing fallback build manifest). The blocker was environmental. A separate standalone S2 copy at `[локальный абсолютный путь скрыт]` with its own dependencies, `.next`, and SQLite started successfully on 3103 using `pnpm dev --hostname 127.0.0.1 --port 3103`. The lockfile was used frozen/offline; working package files were untouched. Its launcher is `run-s2-ui-browser-acceptance.ps1` and refuses a second process on 3103.

The test API is guarded by exact isolated `DATABASE_URL` matching and `S2_UI_ACCEPTANCE_MOCK=1`. The mock executor is injected in server process code, not accepted from a browser request. A preload guard rejects every non-loopback fetch and prints only the hostname. The fixture was `[DIAGNOSTIC] UI acceptance — fresh`, version `fixture-1`; it had one proposed position, one source fragment, synthetic scenario/Run/Observation/discrepancy and mock-only role assignments. Initial counts were campaigns=0, ModelCalls=0, vectors=0.

| Browser check | Result |
|---|---|
| Setup preview and explicit start | One start request sent only after confirmation. Persisted scope was the one synthetic position. Policy: `interactions`, max actions 20, scenarios/position 2, extra checks 1, retries 3, concurrency 1, stopOnQuota true, stopOnTechnicalError false, rewrite experiment false. |
| Campaign count / double click / progress | Exactly one campaign `404f127e9dd34408a9ae2ff90b83ba80`; double click did not create a duplicate POST. It completed two mock actions and showed the result screen. Final DB counts: 2 campaign actions, 3 Runs including the fixture DEMO Run, 0 ModelCalls, 0 vectors. |
| Source and related-record navigation | Synthetic Observation and discrepancy opened in their corresponding codemap tabs; Fragment opened exact source; Run opened Behavior Lab. Each return restored the same campaign. Diagnostic observation inclusion was disclosed in the UI. |
| Keyboard / viewport | Tab, Shift+Tab, Enter, Space, visible focus and technical disclosure tested; no trap observed. 390×844 showed stacked cards and mobile navigation. Canceling the native confirmation and focus restoration were not verified. |
| Loading/error/empty | Loading delay was visible; error state showed reason and Retry; empty state stated there were no campaigns and that setup saves only after explicit confirmation. |
| Partial | Not verified: the fixture has one position, so truncating it to one did not create partial data. UI has no distinct partial marker demonstrated by this fixture. |

### Defects discovered in this pass

1. Campaign-related Observation/discrepancy links previously opened generic Atlas and dropped the selected record and return target. A small shared target/return state now selects the correct codemap tab/record and returns to the same campaign.
2. Queue recovery for a previously queued Run bypassed injected `runExecutor` and called `executeRun` directly. The engine now uses the injected executor on recovery. The isolated regression test verified exactly one mock invocation, one action, and zero ModelCalls.

### Final local checks and limits

- `pnpm exec tsc --noEmit`: passed.
- `node scripts/s2-isolated-research-ui-acceptance.mjs <repo> <isolated-db>`: passed; recovery case uses the injected mock executor.
- Target ESLint on the changed source/test files: four findings remain in `src/components/studios/atlas-studio.tsx` at the version ref render assignment and three older state-setting effects. Those lines were not changed for this task; an exact pre-change copy of `atlas-studio.tsx` is unavailable, so a file-level lint baseline comparison cannot be established. No broader lint repair was attempted.
- Working S2 retained PID 26568 on 3102; `/api/health` returned 200 before and after. Test server PID 11868 on 3103 used only `[локальный абсолютный путь скрыт]` and was stopped after acceptance.
- Screenshots and diagnostic data remain under the isolated temp directory; nothing there was deleted. Real model/embedding calls, working campaigns, and working database were untouched.

## Rollback

Click «Обзор» in the existing navigation for an immediate, persistent return to the former workspace. A complete pre-change snapshot of the 10 modified existing files is under `.launcher/backups/research-ui-stage2-before-2026-10-23`. For a source rollback, restore that snapshot and, if the browser has persisted `studio: research`, set only that field to `overview` in `localStorage` key `observatory-ui` before reloading. The S2 server remains on port 3102; no restart or working-data rollback was needed.

## Follow-up r6: palette semantics and campaign action budget (2026-10-23)

Reference inspection was read-only and limited to `[локальный абсолютный путь скрыт]`: theme/palette provider, CSS tokens, persisted preference, and shared semantic badges. S2 now offers five accent palettes (`Бирюзовая`, `Изумрудная`, `Янтарная`, `Фиолетовая`, `Океанская`) independently from its existing light/dark choice. Selection is stored in browser local storage and applied through CSS variables. Object-type accents are separate from status badges; both retain text labels so meaning does not rely on color alone.

Campaign action budget accepts positive safe integers above 20 or explicit unlimited (`null`). Existing saved `20` policies remain bounded. Unlimited mode leaves scope, per-position scenario count, additional checks, retry ceiling, concurrency, quota/error stop rules, pause, and cancel in place. Budget changes remain explicit, journaled, preserve the used count, and do not resume a campaign. Archive import defaults old missing fields to 20; round-trip preserves finite/unlimited values and history.

Browser check on working S2 :3102 verified palette selection persists after reload (then restored the original teal selection), budget input 21, unlimited-mode preview, and that preview does not start work. The setup remains a browser-local draft; no campaign was created or modified. The isolated mock acceptance verified unlimited and finite policy transitions, history, and execution at action 21; archive/flow round-trip passed. No real model or embedding requests ran.

Final checks: `pnpm exec tsc --noEmit` passed; `node scripts/s2-research-ui-unit-tests.mjs` passed 13/13; `node --test src/lib/semantic-search.test.mjs` passed 3/3. Targeted ESLint has only the previously documented `src/components/shell/app-shell.tsx:252` `react-hooks/set-state-in-effect` finding; the new theme provider and other changed targets are clean. Full contrast inspection across every palette, narrow-screen budget editing, and exhaustive campaign stop-limit cases were not verified in browser. Working health on :3102 returned 200.




## r7 — темы и центр процессов (2026-10-23)

### Изменения

- Светлая/тёмная тема остаётся отдельной настройкой от пяти акцентных палитр: бирюзовая, изумрудная, янтарная, фиолетовая и океанская. Общие CSS tokens задают оттенённые нейтральные поверхности оболочки, боковой панели, header, карточек, вложенных поверхностей, полей, границ и focus; статусные ошибки/предупреждения/успех остаются семантическими.
- Добавлен раздел «Процессы и очередь» и индикатор header. Очередь — проекция фактических campaign/action/Run/ModelCall и Analysis-связей; фиктивный Run для независимых операций не создаётся. По умолчанию API ограничивает список текущим проектом, all-projects явно показывает принадлежность.
- Кампании поддерживают действия, разрешённые их состоянием (pause/stop/continue/restart/reconcile); отдельный Run — stop/reconcile/retry; direct ModelCall — stop/reconcile. Restart создаёт новую кампанию со ссылкой на предшественника. Поздний ответ не переписывает отменённый Run/ModelCall. Принудительная сверка просит основание и записывает неизвестный/прерванный итог, не completed.
- Статусы без управляющего API и contour/embedding-шаги без индивидуального cancel явно остаются «Только просмотр». Архив очереди — только localStorage текущего браузера; это не удаляет исследовательские записи.

### Проверки и ограничения

- `pnpm exec tsc --noEmit`: passed; `pnpm exec prisma validate`: passed.
- `node --test scripts/s2-research-ui-unit-tests.mjs src/lib/semantic-search.test.mjs`: 16 passed, 0 failed.
- `node scripts/s2-isolated-process-center-acceptance.mjs <repo> [локальный абсолютный путь скрыт].db`: passed на `[DIAGNOSTIC]` SQLite; проверены hierarchy, project isolation, pause/resume без дублей, restart link, отмена Run/ModelCall и защита late result, stale reconciliation, contour stop. Внешние model/embedding-вызовы не выполнялись.
- Target ESLint на изменённых TypeScript-файлах оставляет одно finding: `react-hooks/set-state-in-effect` в `src/components/shell/app-shell.tsx:292` (ThemeToggle, ранее существовавший паттерн). Новых target findings после исправления двух process-center и одного research эффекта нет. CSS ESLint конфигурацией не проверяется.
- Историческая браузерная проверка S2 покрыла dark teal, dark emerald и light emerald, сохранение палитры после reload, вид очереди/деталей и узкий viewport без горизонтального overflow. В этой приёмке браузерный доступ к localhost был запрещён browser URL policy, поэтому UI-клики mutation controls не проверены в браузере; API acceptance не заменяет эту проверку. Изоляция процессов проверена mock-тестом.
- Read-only API на завершающем снимке: `/api/health` — 200. В целевом проекте очередь вернула 0 записей; all-projects список вернул 76. При последней проверке передачи предыдущий процесс S2 уже был остановлен (listener на 3102 отсутствовал, launcher status подтвердил stopped). Через launcher перезапущен только S2; текущий PID 2544 обслуживает 3102, `/api/health` возвращает 200. Рабочие кампании, назначения и история не изменялись.
- Не проверены все 10 сочетаний темы/палитры, все UI mutation controls в браузере, и остановка отдельного embedding index item (у него нет отдельного cancel controller). Реальных текстовых/embedding вызовов не было.
