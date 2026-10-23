// App shell: top bar (project/version context, connection status, theme),
// sidebar (studio navigation), sticky status footer.
'use client'

import * as React from 'react'
import {
  BarChart3,
  Activity,
  Bot,
  BookOpen,
  ClipboardList,
  Compass,
  FlaskConical,
  GitBranch,
  GitCompare,
  ListTree,
  Menu,
  Moon,
  Paintbrush,
  Network,
  Plug,
  Search,
  RefreshCw,
  Route,
  Share2,
  Sun,
  Telescope,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { STUDIO_TITLES, useStore, type StudioId } from '@/lib/store'
import { api } from '@/lib/api-client'
import type { ProjectDTO } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ACCENT_PALETTE_LABELS, ACCENT_PALETTES, useAccentPalette, type AccentPalette } from './theme-provider'

const NAV: { id: StudioId; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { id: 'research', icon: Search, hint: 'Текущие кампании, подготовка нового исследования и результаты' },
  { id: 'processes', icon: Activity, hint: 'Единый список активных, ожидающих и завершённых операций' },
  { id: 'overview', icon: Compass, hint: 'Проект, документ, готовность разделов' },
  { id: 'atlas', icon: BookOpen, hint: 'Текст инструкции с визуальными слоями' },
  { id: 'graph', icon: Network, hint: 'Интерактивный граф правил и связей' },
  { id: 'roads', icon: Route, hint: 'Дороги решений и потенциальных отказов' },
  { id: 'scenario', icon: ListTree, hint: 'Многомасштабное дерево ситуаций' },
  { id: 'lab', icon: FlaskConical, hint: 'Роли, запуски моделей, вердикты' },
  { id: 'evolution', icon: GitCompare, hint: 'Версии, правки и их последствия' },
  { id: 'metrics', icon: BarChart3, hint: 'Метрики с паспортом каждого показателя' },
  { id: 'connections', icon: Plug, hint: 'Ollama и облачный бэкенд сессии' },
  { id: 'export', icon: Share2, hint: 'Копирование, экспорт, импорт, handoff' },
  { id: 'registry', icon: ClipboardList, hint: 'Статусы функций и DEMO-данные' },
  { id: 'assistant', icon: Bot, hint: 'Исследовательский диалог по документу' },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col">
      {/* Observatory backdrop: faint grid + glow, decorative only */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-grid opacity-70"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-72 app-shell-glow"
      />
      <TopBar />
      <div className="flex flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 px-4 pb-8 pt-4 md:px-6 lg:px-8">{children}</main>
      </div>
      <StatusBar />
    </div>
  )
}

function TopBar() {
  const { palette, setPalette } = useAccentPalette()
  const appState = useStore((s) => s.appState)
  const projectId = useStore((s) => s.projectId)
  const setProject = useStore((s) => s.setProject)
  const setStudio = useStore((s) => s.setStudio)
  const selectProcess = useStore((s) => s.selectProcess)
  const selectedVersionId = useStore((s) => s.selectedVersionId)
  const selectVersion = useStore((s) => s.selectVersion)
  const refresh = useStore((s) => s.refresh)
  const sessionCloud = useStore((s) => s.sessionCloud)
  const [projects, setProjects] = React.useState<ProjectDTO[]>([])
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false)
  const [processPulse, setProcessPulse] = React.useState<{ active: number; waiting: number; attention: number; names: string[]; selectedId: string | null; generatedAt: string | null; stale: boolean }>({ active: 0, waiting: 0, attention: 0, names: [], selectedId: null, generatedAt: null, stale: false })

  React.useEffect(() => {
    api
      .projects()
      .then(setProjects)
      .catch(() => setProjects([]))
  }, [appState?.project?.id])

  React.useEffect(() => {
    let alive = true
    const update = async () => {
      try {
        const result = await api.processes(appState?.project?.id ?? projectId ?? undefined)
        if (!alive) return
        const active = result.processes.filter((process) => process.status === 'active')
        const waiting = result.processes.filter((process) => ['waiting', 'prepared'].includes(process.status))
        const attention = result.processes.filter((process) => process.status === 'needs-reconciliation')
        const featured = active[0] ?? attention[0] ?? waiting[0]
        const visibleProcesses = active.length ? active.slice(0, 2) : featured ? [featured] : []
        setProcessPulse({ active: active.length, waiting: waiting.length, attention: attention.length, names: visibleProcesses.map((process) => `${process.title} · ${process.stage}`), selectedId: featured?.id ?? null, generatedAt: result.generatedAt, stale: false })
      } catch {
        if (alive) setProcessPulse((current) => ({ ...current, stale: true }))
      }
    }
    void update()
    const timer = window.setInterval(() => void update(), 5000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [appState?.project?.id, projectId])

  const currentVersionId = React.useMemo(() => {
    if (selectedVersionId) return selectedVersionId
    return appState?.activeVersion?.id ?? ''
  }, [selectedVersionId, appState?.activeVersion?.id])
  const featuredProcessName = processPulse.names[0]?.split(' · ')[0]

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex min-h-14 flex-wrap items-center gap-2 px-3 py-2 md:h-14 md:flex-nowrap md:px-4 md:py-0">
        {/* Mobile nav */}
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Открыть навигацию">
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SheetTitle className="sr-only">Навигация по разделам</SheetTitle>
            <NavList onNavigate={() => setMobileNavOpen(false)} />
          </SheetContent>
        </Sheet>

        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg border bg-card glow-teal">
            <Telescope className="size-4 text-primary" aria-hidden />
          </span>
          <div className="hidden sm:block">
            <p className="text-sm font-semibold leading-tight tracking-tight">MMSS Skill Observatory</p>
            <p className="text-[10px] leading-tight text-muted-foreground">
              Instruction Atlas · Behavior Lab · Evolution Studio
            </p>
          </div>
        </div>

        <div className="order-3 flex basis-full min-w-0 flex-1 items-center justify-center gap-2 md:order-none md:basis-auto md:justify-end">
          {/* Project selector */}
          <Select
            value={appState?.project?.id ?? ''}
            onValueChange={(v) => void setProject(v)}
            disabled={projects.length <= 1}
          >
            <SelectTrigger className="h-8 w-[calc(50%-0.25rem)] min-w-0 text-[10px] sm:text-xs md:w-56" aria-label="Исследовательский проект">
              <SelectValue placeholder="Проект" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  {p.name.length > 40 ? p.name.slice(0, 40) + '…' : p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Version selector */}
          <Select
            value={currentVersionId}
            onValueChange={(v) => selectVersion(v)}
            disabled={!appState || appState.documents.every((d) => d.versions.length === 0)}
          >
            <SelectTrigger className="h-8 w-[calc(50%-0.25rem)] min-w-0 text-[10px] sm:text-xs md:w-60" aria-label="Версия документа">
              <SelectValue placeholder="Версия" />
            </SelectTrigger>
            <SelectContent>
              {appState?.documents.map((doc) => (
                <SelectGroup key={doc.id}>
                  <SelectLabel className="text-[10px]">{doc.title}</SelectLabel>
                  {doc.versions.map((v) => (
                    <SelectItem key={v.id} value={v.id} className="text-xs">
                      <span className="flex items-center gap-1.5">
                        {v.label}
                        {v.isActive && (
                          <Badge className="h-4 bg-primary/15 px-1 text-[9px] text-primary" variant="secondary">
                            активная
                          </Badge>
                        )}
                        {v.kind === 'experimental' && (
                          <Badge variant="outline" className="h-4 px-1 text-[9px] text-fuchsia-500">
                            ветка
                          </Badge>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 max-w-32 px-2 text-[10px] sm:max-w-48 sm:text-xs" aria-label="Открыть процессы и очередь" onClick={() => { selectProcess(processPulse.selectedId); setStudio('processes') }}>
                  <Activity className="mr-1 size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{processPulse.stale ? 'Очередь · связь потеряна' : processPulse.active ? `${processPulse.active} активно · ${featuredProcessName ?? 'процесс'}${processPulse.waiting ? ` · ждут ${processPulse.waiting}` : ''}` : processPulse.attention ? `Сверить ${processPulse.attention} · ${featuredProcessName ?? 'процесс'}` : processPulse.waiting ? `Ждут ${processPulse.waiting} · ${featuredProcessName ?? 'процесс'}` : 'Нет активных процессов'}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-80 text-xs">
                {processPulse.stale ? `Не удалось обновить. Показано последнее состояние${processPulse.generatedAt ? ` от ${new Date(processPulse.generatedAt).toLocaleTimeString()}` : ''}.` : processPulse.names.length ? processPulse.names.join(' · ') : processPulse.attention ? 'Некоторые записи требуют сверки; возраст сам по себе не считается доказательством остановки.' : 'Наблюдение не запускает и не возобновляет работу.'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {/* Session cloud status */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    'hidden items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium md:inline-flex',
                    sessionCloud?.available
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'border-zinc-500/40 bg-zinc-500/10 text-zinc-500'
                  )}
                >
                  <span
                    className={cn(
                      'size-1.5 rounded-full',
                      sessionCloud?.available ? 'bg-emerald-400 pulse-dot' : 'bg-zinc-400'
                    )}
                    aria-hidden
                  />
                  {sessionCloud?.available ? 'Облако сессии' : 'Облако недоступно'}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-72 text-xs">
                {sessionCloud?.available
                  ? 'Облачный LLM-бэкенд доступен внутри этой сессии разработки. Для локального запуска используйте Ollama (раздел «Подключения»).'
                  : (sessionCloud?.note ?? 'Облачный бэкенд недоступен. Локальный запуск — через Ollama.')}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

            <Button
            variant="ghost"
            size="icon"
            className="hidden size-8 sm:inline-flex"
            aria-label="Обновить данные"
            onClick={() => void refresh()}
          >
            <RefreshCw className="size-4" />
          </Button>
          <Select value={palette} onValueChange={(value) => setPalette(value as AccentPalette)}>
            <SelectTrigger className="h-8 w-[88px] min-w-0 px-1.5 text-[9px] sm:w-[118px] sm:px-2 sm:text-[10px]" aria-label="Акцентная палитра">
              <Paintbrush className="mr-1 size-3 shrink-0" aria-hidden />
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {ACCENT_PALETTES.map((item) => <SelectItem key={item} value={item} className="text-xs">{ACCENT_PALETTE_LABELS[item]}</SelectItem>)}
            </SelectContent>
          </Select>
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  const isDark = mounted && theme === 'dark'
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label={isDark ? 'Светлая тема' : 'Тёмная тема'}
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  )
}

function Sidebar() {
  return (
    <aside className="sticky top-14 hidden max-h-[calc(100vh-3.5rem)] w-60 shrink-0 self-start flex-col overflow-y-auto border-r bg-card/30 lg:flex scroll-observatory">
      <NavList />
    </aside>
  )
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const studio = useStore((s) => s.studio)
  const setStudio = useStore((s) => s.setStudio)
  return (
    <nav aria-label="Разделы обсерватории" className="flex flex-col gap-0.5 p-2">
      {NAV.map((item) => {
        const Icon = item.icon
        const active = studio === item.id
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setStudio(item.id)
              onNavigate?.()
            }}
            aria-current={active ? 'page' : undefined}
            title={item.hint}
            className={cn(
              'group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
              active
                ? 'bg-primary/12 text-foreground glow-teal'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Icon className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} aria-hidden />
            <span className="truncate">{STUDIO_TITLES[item.id]}</span>
          </button>
        )
      })}
    </nav>
  )
}

function StatusBar() {
  const appState = useStore((s) => s.appState)
  const version = appState?.activeVersion
  const realRuns = appState?.runs.filter((r) => r.origin === 'real').length ?? 0
  const demoRuns = appState?.runs.filter((r) => r.origin === 'demo').length ?? 0
  return (
    <footer className="mt-auto border-t bg-card/40 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-[10px] text-muted-foreground">
        <span className="font-mono">MMSS Skill Observatory</span>
        {version && (
          <>
            <span>
              документ: <span className="font-mono">{version.knownVersion ?? '—'}</span>
            </span>
            <span className="hidden font-mono sm:inline">sha256:{version.contentHash.slice(0, 8)}…</span>
            <span>
              фрагментов: <span className="font-mono">{version.fragmentCount}</span>
            </span>
          </>
        )}
        <span>
          запусков: <span className="font-mono">{realRuns}</span>
          {demoRuns > 0 && <span className="text-amber-500"> (+{demoRuns} DEMO)</span>}
        </span>
        <span className="ml-auto hidden md:inline">
          данные хранятся локально (SQLite) · экспорт доступен в разделе «Экспорт и передача»
        </span>
      </div>
    </footer>
  )
}
