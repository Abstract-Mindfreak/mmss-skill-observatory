// Обзор: живая исследовательская карта проекта — метаданные документа,
// честная готовность разделов, быстрый старт по ключевому маршруту.
'use client'

import * as React from 'react'
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  CircleDashed,
  Database,
  FileText,
  GitCompare,
  ListTree,
  Network,
  Plug,
  Route,
  FlaskConical,
  BarChart3,
  Bot,
  ClipboardList,
  Share2,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { KV, SectionHeader } from '@/components/shared/misc'
import { StatusBadge } from '@/components/shared/status-badges'
import { EmptyState, ErrorState, InlineSpinner } from '@/components/shared/states'
import { CopyButton } from '@/components/shared/copy'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api-client'
import type { RemoteCheckResult } from '@/lib/types'
import type { StudioId } from '@/lib/store'

const READINESS: { id: StudioId; icon: React.ComponentType<{ className?: string }>; what: string; status: 'LOCAL' | 'LIVE' }[] = [
  { id: 'atlas', icon: BookOpen, what: 'Полный текст со слоями, карточки фрагментов, заметки', status: 'LOCAL' },
  { id: 'graph', icon: Network, what: 'Граф правил с типизированными связями и фильтрами', status: 'LOCAL' },
  { id: 'roads', icon: Route, what: 'Дороги решений с разветвлениями и картой «ям»', status: 'LOCAL' },
  { id: 'scenario', icon: ListTree, what: 'Дерево ситуаций с ростом через Explorer', status: 'LOCAL' },
  { id: 'lab', icon: FlaskConical, what: 'Запуски ролей на реальных моделях, вердикты', status: 'LIVE' },
  { id: 'evolution', icon: GitCompare, what: 'Ветки версий, diff, оценка последствий правки', status: 'LOCAL' },
  { id: 'metrics', icon: BarChart3, what: 'Метрики с определением, методом и ограничениями', status: 'LOCAL' },
  { id: 'connections', icon: Plug, what: 'Ollama: адрес, модели, пробы, назначения ролей', status: 'LIVE' },
  { id: 'export', icon: Share2, what: 'Копирование, экспорт MD/JSON/CSV, handoff, импорт', status: 'LOCAL' },
  { id: 'registry', icon: ClipboardList, what: 'Реестр статусов, DEMO-данные, список заглушек', status: 'LOCAL' },
  { id: 'assistant', icon: Bot, what: 'Диалог с контекстом выбранного фрагмента', status: 'LIVE' },
]

const GOLDEN_PATH: { step: string; studio: StudioId }[] = [
  { step: 'Открыть прикреплённый SKILL.md — он уже загружен как базовый документ', studio: 'overview' },
  { step: 'Изучить структуру и версии документа', studio: 'overview' },
  { step: 'Выбрать фрагмент в атласе', studio: 'atlas' },
  { step: 'Посмотреть связи и толкования фрагмента', studio: 'atlas' },
  { step: 'Создать связанный сценарий', studio: 'scenario' },
  { step: 'Выполнить реальный анализ (модель или локальный) — либо увидеть явное ограничение', studio: 'lab' },
  { step: 'Сохранить результат (заметка/находка)', studio: 'lab' },
  { step: 'Изменить фразу в экспериментальной версии', studio: 'evolution' },
  { step: 'Увидеть, какие результаты устарели', studio: 'evolution' },
  { step: 'Сравнить версии и результаты', studio: 'evolution' },
  { step: 'Экспортировать всё или выбранную часть', studio: 'export' },
]

export default function OverviewStudio() {
  const appState = useStore((s) => s.appState)
  const setStudio = useStore((s) => s.setStudio)
  const sessionCloud = useStore((s) => s.sessionCloud)
  const refresh = useStore((s) => s.refresh)
  const [remote, setRemote] = React.useState<RemoteCheckResult | null>(null)
  const [remoteBusy, setRemoteBusy] = React.useState(false)
  const [remoteError, setRemoteError] = React.useState<string | null>(null)

  const project = appState?.project
  const version = appState?.activeVersion
  const document = appState?.documents.find((d) => version && d.versions.some((v) => v.id === version.id))
  const realScenarios = appState?.scenarios.filter((s) => s.origin !== 'demo').length ?? 0
  const realRuns = appState?.runs.filter((r) => r.origin === 'real').length ?? 0
  const realFindings = appState?.findings.filter((f) => f.origin === 'real').length ?? 0
  const demoFindings = appState?.findings.filter((f) => f.origin === 'demo').length ?? 0
  const ollamaOk = appState?.connections.filter((c) => c.status === 'ok').length ?? 0
  const hasLocalAnalysis = version?.hasLocalAnalysis ?? false

  const checkRemote = async () => {
    if (!version) return
    setRemoteBusy(true)
    setRemoteError(null)
    try {
      setRemote(await api.checkRemote(version.id))
    } catch (e) {
      setRemoteError(e instanceof Error ? e.message : 'Ошибка проверки')
    } finally {
      setRemoteBusy(false)
    }
  }

  if (!project || !version) {
    return (
      <EmptyState
        title="Нет активного проекта"
        hint="Создайте проект или импортируйте архив в разделе «Экспорт и передача»."
        action={
          <Button size="sm" onClick={() => setStudio('export')}>
            Перейти к импорту
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-6 py-2">
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" aria-hidden />
            {project.name}
          </span>
        }
        description={project.description ?? undefined}
        badges={
          project.origin === 'seed' ? (
            <Badge variant="secondary" className="text-[10px]">
              стартовый проект из вложения
            </Badge>
          ) : project.origin === 'import' ? (
            <Badge variant="outline" className="text-[10px]">
              импортированный
            </Badge>
          ) : undefined
        }
        actions={
          <>
            <Button size="sm" className="gap-1.5" onClick={() => setStudio('atlas')}>
              <BookOpen className="size-4" aria-hidden />
              Открыть атлас
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setStudio('connections')}>
              <Plug className="size-4" aria-hidden />
              Подключения
            </Button>
          </>
        }
      />

      {/* Document passport */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
            <FileText className="size-4 text-primary" aria-hidden />
            Исследуемый документ
            <StatusBadge status={hasLocalAnalysis ? 'LOCAL' : 'PLACEHOLDER'} />
            {!hasLocalAnalysis && (
              <span className="text-xs font-normal text-muted-foreground">локальный анализ не выполнялся</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-x-8 gap-y-1 md:grid-cols-2">
          <KV k="Файл" v={document?.title ?? '—'} />
          <KV k="Известная версия" v={<span className="font-mono">{version.knownVersion ?? 'не указана'}</span>} />
          <KV
            k="Источник"
            v={
              version.sourceUrl ? (
                <a href={version.sourceUrl} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
                  {version.source === 'attachment' ? 'вложение (сверено с GitHub)' : version.source} ↗
                </a>
              ) : (
                version.source
              )
            }
          />
          <KV k="Статус полноты текста" v={version.completeness === 'full' ? 'полный текст' : version.completeness === 'partial' ? 'частично' : 'неизвестно'} />
          <KV k="Хэш содержимого (sha256)" v={<span className="font-mono text-xs">{version.contentHash.slice(0, 24)}…</span>} />
          <KV k="Размер" v={`${version.contentLength.toLocaleString('ru-RU')} симв. · ${version.lineCount} строк · ${version.fragmentCount} фрагментов`} />
          <KV k="Импорт" v={new Date(version.importDate).toLocaleString('ru-RU')} />
          <KV
            k="Версий документа"
            v={
              <span className="inline-flex items-center gap-1">
                {appState.documents.reduce((acc, d) => acc + d.versions.length, 0)}
                {version.kind === 'experimental' && <Badge variant="outline" className="text-[9px]">вы смотрите экспериментальную ветку</Badge>}
              </span>
            }
          />
        </CardContent>
      </Card>

      {/* Remote check */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <BadgeCheck className="size-4 text-primary" aria-hidden />
            Сверка с репозиторием
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Приложение сверяет хэш вложения с{' '}
            <span className="font-mono text-[11px]">raw.githubusercontent.com/…/mmss-principle-synthesis/SKILL.md</span>.
            Проверка не изменяет базовую версию — при различии будет показан diff-отчёт и отдельная возможность
            импорта удалённой версии.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void checkRemote()} disabled={remoteBusy}>
              {remoteBusy ? <InlineSpinner label="Проверка…" /> : 'Проверить репозиторий'}
            </Button>
            {remote && (
              <>
                <StatusBadge status={remote.reachable ? (remote.identical ? 'LOCAL' : 'STALE') : 'ERROR'} />
                <span className="text-xs text-muted-foreground">
                  {remote.reachable
                    ? remote.identical
                      ? 'Вложение и репозиторий идентичны (хэши совпадают)'
                      : 'Содержимое репозитория отличается от базовой версии'
                    : `Недоступно: ${remote.error}`}
                </span>
                <CopyButton text={JSON.stringify(remote, null, 2)} label="JSON" size="sm" variant="ghost" />
              </>
            )}
            {remoteError && <ErrorState error={remoteError} className="flex-1" title="Проверка не удалась" />}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Honest readiness */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Готовность разделов</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {READINESS.map((r) => {
              const Icon = r.icon
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setStudio(r.id)}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-xs">{r.what}</span>
                  <StatusBadge status={r.status} withHint={false} />
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              )
            })}
          </CardContent>
        </Card>

        {/* Quick stats */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Database className="size-4 text-primary" aria-hidden />
              Состояние исследования
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Stat label="Сценарии" value={realScenarios} onClick={() => setStudio('scenario')} />
            <Stat label="Запуски (реальные)" value={realRuns} onClick={() => setStudio('lab')} />
            <Stat
              label="Находки"
              value={realFindings}
              extra={demoFindings > 0 ? `+${demoFindings} DEMO` : undefined}
              onClick={() => setStudio('registry')}
            />
            <Stat label="Заметки" value={appState?.notes.filter((n) => n.origin === 'real').length ?? 0} onClick={() => setStudio('atlas')} />
            <div className="col-span-2 space-y-1 rounded-md border p-3">
              <KV
                k="Ollama"
                v={
                  ollamaOk > 0 ? (
                    <span className="text-emerald-500">подключено: {ollamaOk}</span>
                  ) : (
                    <span className="text-muted-foreground">нет активных подключений — локальный запуск: раздел «Подключения»</span>
                  )
                }
              />
              <KV
                k="Облачный бэкенд сессии"
                v={
                  sessionCloud?.available ? (
                    <span className="text-emerald-500">доступен (только внутри этой сессии)</span>
                  ) : (
                    <span className="text-muted-foreground">недоступен</span>
                  )
                }
              />
              <KV
                k="Локальный анализ версии"
                v={
                  hasLocalAnalysis ? (
                    <span className="text-teal-500">выполнен (эвристический, со ограничениями)</span>
                  ) : (
                    <span className="text-muted-foreground">не выполнялся</span>
                  )
                }
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Golden path */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Route className="size-4 text-primary" aria-hidden />
            Ключевой маршрут исследования
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-1">
            {GOLDEN_PATH.map((g, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => setStudio(g.studio)}
                  className="group flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full border bg-card text-[10px] font-mono text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-xs">{g.step}</span>
                  {i === 0 || i === 1 ? (
                    <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" aria-hidden />
                  ) : (
                    <CircleDashed className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                  )}
                </button>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value, extra, onClick }: { label: string; value: number; extra?: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-0.5 rounded-md border bg-card/60 p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      <span className="font-mono text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-[11px] text-muted-foreground">
        {label}
        {extra && <span className="ml-1 text-amber-500">({extra})</span>}
      </span>
    </button>
  )
}
