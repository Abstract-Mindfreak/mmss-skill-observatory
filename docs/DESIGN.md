# DESIGN.md — дизайн-система обсерватории (для фронтенд-агентов)

Обязателен к прочтению вместе с `docs/CONTRACTS.md`. Владелец shared-компонентов — главный агент:
менять их нельзя, можно только использовать. Если чего-то не хватает — написать в worklog.

## Тема

Тёмная обсерватория по умолчанию (`next-themes`, class="dark"), есть светлая. Использовать ТОЛЬКО
семантические токены: `bg-background text-foreground`, `bg-card`, `border-border`, `text-muted-foreground`,
`bg-muted`, `text-primary`, `bg-primary/10` для акцентных фонов. Прямые цвета (emerald-500 и т.п.) —
только для статусов/слоев через shared-компоненты. Запрещены indigo/blue как основные акценты.

Утилиты из globals.css: `.glow-teal` (мягкое свечение), `.glow-amber`, `.bg-grid` (сетка карты),
`.scroll-observatory` (кастомный скроллбар — вешать на все блоки с overflow), `.pulse-dot`.

## Типографика и отступы

- Заголовок студии — `SectionHeader` (title/description/actions/badges).
- Карточки: `Card`+`CardHeader`+`CardContent`, содержимое с `p-4`/`p-6`, зазоры `gap-3`/`gap-4`.
- Длинные списки: `max-h-96 overflow-y-auto scroll-observatory`.
- Моноширинный текст (хэши, id, пути фрагментов, JSON): `font-mono text-xs`.
- Даты: `new Date(x).toLocaleString('ru-RU')`.

## Shared-компоненты (`src/components/shared/`)

- `StatusBadge({status: ProvenanceStatus, className?, withHint?})` — LIVE/LOCAL/DEMO/PLACEHOLDER/STALE/ERROR с тултипом. Обязателен у каждого результата/функции.
- `RunStatusBadge({status: RunStatus, compact?})` — статус выполнения с пульсирующей точкой.
- `VerdictBadge({verdict, by?, modelVerdict?})` — вердикт pass/fail/inconclusive; `verdict=null` → «Вердикт не установлен».
- `ProvenanceTag({provenance: MetricProvenance})` — Измерено/Вычислено/Оценено моделью/Цель/Синтетическое/Данных нет.
- `OriginBadge({origin:'real'|'demo'})` — DEMO-пометка.
- `LoadingState`, `InlineSpinner`, `EmptyState({icon,title,hint,action})`, `ErrorState({error,onRetry,title})`, `SkeletonPanel`.
- `CopyButton({text | (() => string | Promise<string>), label?, size?, variant?})` — копирование с fallback-диалогом (Clipboard API запрещён → диалог с textarea и скачиванием). Использовать везде, где есть копируемый контент.
- `CopyBlock({title, text})` — строка с названием и кнопкой копирования.
- `EvidencePassport({evidence: EvidenceChain, defaultOpen?})` — паспорт вывода: цепочка шагов, пропуски, различение. Краткий режим свёрнут.
- `LayerChip({layer, basis?, size?})`, `LayerLegend({layers})`, `LayerMark({layer, active?, onClick?})`, `LAYER_VISUALS` — визуальная система 15 слоёв (цвет+стиль подчёркивания+иконка).
- `FragmentRef({fragment, text?})` — ссылка на фрагмент: клик открывает атлас. Использовать для всех связей с текстом.
- `OpenInAtlasButton({fragmentId, label?})`.
- `KV({k, v, mono?})` — строка «ключ-значение».
- `JsonView({data, maxHeight?})` — JSON с прокруткой.
- `MarkdownView({text})` — безопасный markdown (без внешних зависимостей).
- `SectionHeader`.

## Store (`src/lib/store.ts`)

`useStore` (zustand + persist UI-контекста):
- данные: `appState: AppStateDTO`, `sessionCloud`, `loading/loadError`; кэши `fragmentCards`, `graphCache`, `versionContent`.
- выбор: `studio`, `projectId`, `selectedFragmentId/VersionId/ScenarioId/RunId` + setters.
- `goToFragment(id, studio?)` — выбор фрагмента и переход (обычно в атлас).
- `loadFragmentCard(id, force?)`, `loadGraph(versionId, force?)`, `loadVersionContent(id, force?)` — кэшированные загрузки.
- `init()`, `refresh()` — обновление состояния; вызывать `refresh()` после мутаций (создание сценария, запуск, заметка…).
- селекторы-функции: `activeVersion(s)`, `activeVersionId(s)`, `assignmentFor(s, role)`, `isViewingActiveVersion(s)`.
  В компонентах: `const version = useStore(activeVersion)`.

Важно: `appState.fragments` — фрагменты АКТИВНОЙ версии проекта. Если пользователь смотрит другую версию
(`selectedVersionId`), данные фрагментов/анализа для неё нужно грузить самим (graph, content) — кэш в store.

## API-клиент (`src/lib/api-client.ts`)

`api.*` — все методы из CONTRACTS; ошибки — `ApiError` (у неё `message` на русском и `status`).
Файлы: `downloadFile(url, fallbackName)`, `exportUrl/handoffUrl/graphExportUrl(projectId, …)`.

Общий паттерн мутации:
```tsx
const [busy, setBusy] = React.useState(false)
try {
  setBusy(true)
  await api.createScenario(projectId, {...})
  await refresh()          // обновить appState
  toast({ title: 'Сценарий создан' })
} catch (e) {
  toast({ title: 'Не удалось', description: e instanceof Error ? e.message : '', variant: 'destructive' })
} finally { setBusy(false) }
```
Тосты: `useToast` из `@/hooks/use-toast` (radix Toaster уже подключен). НЕ использовать sonner.

## Честность (жёсткие правила)

- У каждого числового/визуального результата — ProvenanceTag/StatusBadge. 0 проверок → «нет данных», не 100%.
- Статус выполнения ≠ вердикт. Completed-запуск с verdict=fail — это нормально, показывать оба.
- Кнопки без функции — `disabled` + title с пояснением, либо StatusBadge PLACEHOLDER рядом.
- Ошибки моделей показывать как есть (русские строки с бэкенда), не подменять синтетикой.
- DEMO-данные — с `OriginBadge`, в реальных метриках не участвуют.
- Цвет — не единственный носитель смысла: подписи, иконки, тултипы обязательны.

## Раскладка

- Студия рендерится внутри `main` с `px-4 pt-4 pb-8`; верх — `SectionHeader`.
- Двухпанельные раскладки: `grid gap-4 lg:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)]` или `resizable-panels`.
- Мобильная адаптивность обязательна: `flex-col md:flex-row`, `hidden md:block`, полные ширины на xs.
- Тач-цели ≥ 40px: кнопки `size="sm"` минимум, списковые строки `py-2`.

## Что уже есть в `appState`

`project, documents (с версиями), activeVersion, fragments (активной версии), scenarios (с runCount,
lastRunStatus), runs (последние 200, с programChecks и input), findings (с evidence), notes, connections,
assignments, chatMessages, analyses (меты), sessionCloud, seeded`. Формы — в `src/lib/types.ts`.
