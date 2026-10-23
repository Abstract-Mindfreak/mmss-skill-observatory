// Реестр функций обсерватории: честный статус каждой функции + строки PLACEHOLDER
// из PLACEHOLDER_REGISTRY (types.ts) с «чего не хватает» и «обходным путём».
'use client'

import * as React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/shared/status-badges'
import { useStore } from '@/lib/store'
import { PLACEHOLDER_REGISTRY, type ProvenanceStatus } from '@/lib/types'

interface FunctionRow {
  id: string
  title: string
  where: string
  statuses: ProvenanceStatus[]
  comment: string
}

/** Базовый список — статичен; динамические дополнения (облако/Ollama) добавляются в компоненте. */
function baseFunctions(): FunctionRow[] {
  return [
    {
      id: 'local-analysis',
      title: 'Локальный структурный анализ',
      where: 'Атлас · Обзор · Evolution',
      statuses: ['LOCAL'],
      comment: 'Разбор текста на фрагменты, слои с основаниями, термины, повторы, кандидаты конфликтов — детерминированно, без модели.',
    },
    {
      id: 'graph',
      title: 'Карта правил (граф связей)',
      where: 'Карта правил',
      statuses: ['LOCAL'],
      comment: 'Терминологические связи — не логические зависимости; полный список ограничений метода — в паспорте графа.',
    },
    {
      id: 'fragment-cards',
      title: 'Карточки фрагментов',
      where: 'Атлас',
      statuses: ['LOCAL'],
      comment: 'Слои с основаниями, интерпретации, заметки, сценарии, запуски, находки, рёбра графа — собираются из сохранённых данных.',
    },
    {
      id: 'interpretations',
      title: 'Интерпретации фрагментов моделью',
      where: 'Атлас · Лаборатория',
      statuses: ['LIVE'],
      comment: 'Через назначенную модель: session-cloud в этой сессии / Ollama локально. Оценка модели, не факт о документе.',
    },
    {
      id: 'runs',
      title: 'Запуски ролей',
      where: 'Лаборатория',
      statuses: ['LIVE'],
      comment: 'Реальные запросы к назначенной модели; статус выполнения ≠ вердикт проверки.',
    },
    {
      id: 'program-checks',
      title: 'Программные проверки вывода',
      where: 'Лаборатория',
      statuses: ['LOCAL'],
      comment: 'JSON-синтаксис, дубликаты ключей, NaN/Infinity — локально, без модели.',
    },
    {
      id: 'scenarios',
      title: 'Дерево сценариев',
      where: 'Дерево сценариев',
      statuses: ['LOCAL', 'LIVE'],
      comment: 'Данные сценария — LOCAL (сохранены локально); исследование сценария запуском — LIVE.',
    },
    {
      id: 'scenario-suggest',
      title: 'Подсказки механизмов отказа (Explorer)',
      where: 'Дерево сценариев',
      statuses: ['LIVE'],
      comment: 'Модель предлагает различающиеся механизмы; созданные ветви помечаются origin=model.',
    },
    {
      id: 'metrics',
      title: 'Метрики',
      where: 'Метрики',
      statuses: ['LOCAL'],
      comment: 'Вычисляются детерминированно по сохранённым данным (provenance: computed/measured); DEMO-данные исключены.',
    },
    {
      id: 'versions-diff',
      title: 'Версии, diff, оценка последствий правки',
      where: 'Evolution',
      statuses: ['LOCAL'],
      comment: 'Word-level diff, слой-дельты, сценарии к перезапуску; оценка последствий не сохраняет ничего.',
    },
    {
      id: 'notes',
      title: 'Заметки',
      where: 'Атлас',
      statuses: ['LOCAL'],
      comment: 'Привязка к фрагментам и версиям; заметки попадают в экспорт — проверяйте чувствительные данные.',
    },
    {
      id: 'export',
      title: 'Экспорт (MD/JSON/CSV, граф, handoff)',
      where: 'Экспорт и передача',
      statuses: ['LOCAL'],
      comment: 'Формируется на сервере из сохранённых данных; подключения и секреты не включаются.',
    },
    {
      id: 'import',
      title: 'Импорт архива проекта',
      where: 'Экспорт и передача',
      statuses: ['LOCAL'],
      comment: 'Валидация формата с указательными путями ошибок; создаётся новый проект с суффиксом «(импорт)».',
    },
    {
      id: 'remote-check',
      title: 'Сверка с репозиторием (GitHub)',
      where: 'Обзор',
      statuses: ['LIVE'],
      comment: 'При доступном GitHub: sha256-сравнение вложения с raw-файлом репозитория; базовая версия не изменяется.',
    },
    {
      id: 'ollama',
      title: 'Подключения Ollama',
      where: 'Подключения',
      statuses: ['LIVE'],
      comment: 'При подключении: проверка /api/tags, список моделей через /api/show, пробы генерации и embedding.',
    },
    {
      id: 'session-cloud',
      title: 'Облачный бэкенд сессии',
      where: 'Подключения · Лаборатория · Помощник',
      statuses: ['LIVE'],
      comment: 'Только внутри сессии разработки; при локальном запуске проекта используйте Ollama.',
    },
    {
      id: 'chat',
      title: 'Чат с помощником',
      where: 'Помощник',
      statuses: ['LIVE'],
      comment: 'Один из инструментов, не замена атласу и лаборатории; контекст — выбранный фрагмент.',
    },
    {
      id: 'demo-data',
      title: 'DEMO-данные',
      where: 'Реестр',
      statuses: ['DEMO'],
      comment: 'Синтетические данные для демонстрации интерфейса; помечены origin=demo и не входят в реальные метрики.',
    },
  ]
}

export function FunctionsRegistry() {
  const appState = useStore((s) => s.appState)
  const sessionCloud = useStore((s) => s.sessionCloud)

  const rows = React.useMemo<FunctionRow[]>(() => {
    const base = baseFunctions()
    const patch = (id: string, comment: string) => {
      const row = base.find((r) => r.id === id)
      if (row) row.comment = `${row.comment} ${comment}`
    }
    patch(
      'session-cloud',
      sessionCloud == null ? '' : sessionCloud.available ? 'Сейчас: доступен в этой сессии.' : `Сейчас: недоступен — ${sessionCloud.note}.`
    )
    const conns = appState?.connections ?? []
    const ok = conns.filter((c) => c.status === 'ok').length
    const err = conns.filter((c) => c.status === 'error').length
    if (conns.length > 0) {
      patch('ollama', `Сейчас: подключений ${conns.length}, из них отвечает ${ok}, с ошибкой ${err}.`)
    } else {
      patch('ollama', 'Сейчас: подключений нет — добавьте в кабинете подключений.')
    }
    const placeholders: FunctionRow[] = PLACEHOLDER_REGISTRY.map((p) => ({
      id: p.id,
      title: p.title,
      where: '—',
      statuses: ['PLACEHOLDER'],
      comment: `Чего не хватает: ${p.missing}. Обходной путь: ${p.workaround}.`,
    }))
    return [...base, ...placeholders]
  }, [appState, sessionCloud])

  return (
    <Card>
      <CardHeader className="gap-2 pb-3">
        <CardTitle className="text-sm">Функции и статусы</CardTitle>
        <CardDescription>
          Все функции обсерватории с честным статусом. LIVE — реальное выполнение через сервис; LOCAL — локальное
          вычисление; PLACEHOLDER — функция не реализована (с обходным путём).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="rounded-md border bg-card/60 p-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-xs font-medium">{r.title}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{r.id}</span>
              <span className="ml-auto flex items-center gap-1">
                {r.statuses.map((s) => (
                  <StatusBadge key={s} status={s} withHint={false} />
                ))}
              </span>
            </div>
            <div className="mt-1 flex flex-col gap-0.5 sm:flex-row sm:gap-2">
              <span className="shrink-0 text-[11px] text-muted-foreground">Где: {r.where}</span>
              <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted-foreground">{r.comment}</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
