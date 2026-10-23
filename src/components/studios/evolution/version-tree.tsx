// Дерево версий документа: хронологические карточки со связями родитель→ветка,
// действиями над версиями и честными подтверждениями для необратимых операций.
'use client'

import * as React from 'react'
import {
  CheckCircle2,
  CornerDownRight,
  GitCompare,
  GitBranch,
  History,
  MoreHorizontal,
  Pencil,
  Play,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InlineSpinner } from '@/components/shared/states'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'
import type { DocumentDTO, DocumentVersionDTO } from '@/lib/types'
import { cn } from '@/lib/utils'

const KIND_TITLES: Record<string, string> = {
  original: 'оригинал',
  experimental: 'эксперимент',
}

const SOURCE_TITLES: Record<string, string> = {
  attachment: 'вложение',
  paste: 'вставка текста',
  upload: 'загрузка файла',
  branch: 'ветвление',
}

function kindBadge(v: DocumentVersionDTO) {
  if (v.label.startsWith('restore-from-')) {
    return (
      <Badge variant="outline" className="border-fuchsia-500/40 bg-fuchsia-500/10 text-[10px] text-fuchsia-600 dark:text-fuchsia-300">
        восстановленная
      </Badge>
    )
  }
  const t = KIND_TITLES[v.kind]
  if (!t) return null
  return (
    <Badge variant={v.kind === 'experimental' ? 'secondary' : 'outline'} className="text-[10px]">
      {t}
    </Badge>
  )
}

interface VersionNodeData {
  version: DocumentVersionDTO
  children: VersionNodeData[]
}

function buildTree(versions: DocumentVersionDTO[]): VersionNodeData[] {
  const byId = new Map<string, VersionNodeData>(versions.map((v) => [v.id, { version: v, children: [] }]))
  const roots: VersionNodeData[] = []
  for (const v of versions) {
    const node = byId.get(v.id)!
    const parent = v.parentVersionId ? byId.get(v.parentVersionId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

export function VersionTree({
  documents,
  selectedId,
  activeId,
  compareA,
  onSelect,
  onCompareWith,
  onCompareTo,
  onVersionCreated,
}: {
  documents: DocumentDTO[]
  selectedId: string | null
  activeId: string | null
  compareA: string | null
  onSelect: (id: string) => void
  onCompareWith: (id: string) => void
  onCompareTo: (id: string) => void
  onVersionCreated: (id: string) => void
}) {
  const refresh = useStore((s) => s.refresh)
  const loadVersionContent = useStore((s) => s.loadVersionContent)
  const selectVersion = useStore((s) => s.selectVersion)
  const { toast } = useToast()

  const [renameTarget, setRenameTarget] = React.useState<DocumentVersionDTO | null>(null)
  const [renameLabel, setRenameLabel] = React.useState('')
  const [renameNote, setRenameNote] = React.useState('')
  const [renameBusy, setRenameBusy] = React.useState(false)
  const [activateTarget, setActivateTarget] = React.useState<DocumentVersionDTO | null>(null)
  const [activateBusy, setActivateBusy] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<DocumentVersionDTO | null>(null)
  const [deleteBusy, setDeleteBusy] = React.useState(false)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const allVersions = React.useMemo(
    () => documents.flatMap((d) => d.versions),
    [documents]
  )
  const versionById = React.useMemo(
    () => new Map(allVersions.map((v) => [v.id, v])),
    [allVersions]
  )

  // ---- actions ----

  const makeActive = async (v: DocumentVersionDTO) => {
    setActivateBusy(true)
    try {
      await api.updateVersion(v.id, { isActive: true })
      await refresh()
      toast({ title: `Версия «${v.label}» стала активной`, description: 'Результаты, привязанные к прежней версии, отмечаются устаревшими (STALE) в интерфейсе' })
    } catch (e) {
      toast({ title: 'Не удалось сменить активную версию', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setActivateBusy(false)
      setActivateTarget(null)
    }
  }

  const restoreAsBranch = async (v: DocumentVersionDTO) => {
    // Родителем новой ветки назначается АКТИВНАЯ версия: бэкенд отклоняет ветку,
    // идентичную родителю (а ветвление от самой восстанавливаемой версии всегда идентично).
    const parentId = activeId ?? v.id
    setBusyId(v.id)
    try {
      const content = await loadVersionContent(v.id)
      if (content === null) throw new Error('Не удалось загрузить содержимое версии')
      const res = (await api.branchVersion(parentId, {
        label: `restore-from-${v.label}`,
        content,
        note: `Восстановлено из версии «${v.label}» (${new Date().toLocaleString('ru-RU')})`,
      })) as { id?: string }
      await refresh()
      if (res?.id) {
        selectVersion(res.id)
        onVersionCreated(res.id)
      }
      toast({ title: `Создана ветка restore-from-${v.label}`, description: 'Содержимое скопировано из выбранной версии; базовая версия не изменена' })
    } catch (e) {
      toast({ title: 'Восстановление не удалось', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const rename = async () => {
    if (!renameTarget) return
    setRenameBusy(true)
    try {
      await api.updateVersion(renameTarget.id, { label: renameLabel.trim(), note: renameNote.trim() || undefined })
      await refresh()
      toast({ title: 'Версия переименована' })
      setRenameTarget(null)
    } catch (e) {
      toast({ title: 'Не удалось переименовать', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setRenameBusy(false)
    }
  }

  const remove = async (v: DocumentVersionDTO) => {
    setDeleteBusy(true)
    try {
      await api.deleteVersion(v.id)
      await refresh()
      if (selectedId === v.id) selectVersion(null)
      toast({ title: `Версия «${v.label}» удалена`, description: 'Вместе с ней удалены её фрагменты и анализы' })
    } catch (e) {
      // 400 от бэкенда: только экспериментальные версии можно удалять — показываем как есть
      toast({ title: 'Удаление отклонено', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setDeleteBusy(false)
      setDeleteTarget(null)
    }
  }

  if (allVersions.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          У проекта пока нет версий документа — импортируйте Markdown ниже.
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      {documents.map((doc) => {
        const versions = [...doc.versions].sort((a, b) => {
          if (a.kind === 'original' && b.kind !== 'original') return -1
          if (b.kind === 'original' && a.kind !== 'original') return 1
          return a.importDate.localeCompare(b.importDate)
        })
        const tree = buildTree(versions)
        return (
          <section key={doc.id} aria-label={`Версии документа ${doc.title}`} className="space-y-3">
            <div className="flex items-center gap-2">
              <History className="size-4 text-primary" aria-hidden />
              <h2 className="truncate text-sm font-semibold">{doc.title}</h2>
              <Badge variant="outline" className="text-[10px]">
                {versions.length} верс.
              </Badge>
            </div>
            <ul className="space-y-2">
              {tree.map((node) => (
                <li key={node.version.id}>
                  <VersionNode
                    node={node}
                    versionById={versionById}
                    selectedId={selectedId}
                    activeId={activeId}
                    compareA={compareA}
                    busyId={busyId}
                    onSelect={onSelect}
                    onCompareWith={onCompareWith}
                    onCompareTo={onCompareTo}
                    onActivate={setActivateTarget}
                    onRestore={restoreAsBranch}
                    onRename={(v) => {
                      setRenameTarget(v)
                      setRenameLabel(v.label)
                      setRenameNote(v.note ?? '')
                    }}
                    onDelete={setDeleteTarget}
                  />
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      {/* ---- rename dialog ---- */}
      <Dialog open={renameTarget !== null} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Переименовать версию</DialogTitle>
            <DialogDescription>
              Метка и заметка видны в дереве версий и в отчётах. Содержимое не меняется.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ver-label">Метка</Label>
              <Input id="ver-label" value={renameLabel} onChange={(e) => setRenameLabel(e.target.value)} className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ver-note">Заметка</Label>
              <Input id="ver-note" value={renameNote} onChange={(e) => setRenameNote(e.target.value)} placeholder="для чего эта версия" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRenameTarget(null)}>
              Отмена
            </Button>
            <Button size="sm" onClick={() => void rename()} disabled={renameBusy || renameLabel.trim().length === 0}>
              {renameBusy ? <InlineSpinner label="Сохранение…" /> : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- activate confirm ---- */}
      <AlertDialog open={activateTarget !== null} onOpenChange={(o) => !o && setActivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Сделать «{activateTarget?.label}» активной версией?</AlertDialogTitle>
            <AlertDialogDescription>
              Активная версия используется всеми запусками; результаты, привязанные к прежней версии, получат
              статус устаревших в интерфейсе. Содержимое версий не изменяется.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => activateTarget && void makeActive(activateTarget)} disabled={activateBusy}>
              {activateBusy ? 'Смена…' : 'Сделать активной'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- delete confirm (experimental only) ---- */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить экспериментальную ветку «{deleteTarget?.label}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Будут удалены фрагменты и анализы этой версии. Запуски сохраняют привязку по id, но перестанут
              находить версию. Действие необратимо. Удалить можно только экспериментальные ветки —
              базовые версии защищены.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={() => deleteTarget && void remove(deleteTarget)}
              disabled={deleteBusy}
            >
              {deleteBusy ? 'Удаление…' : 'Удалить ветку'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function VersionNode({
  node,
  versionById,
  ...rest
}: {
  node: VersionNodeData
} & VersionCardProps) {
  const { children } = node
  return (
    <>
      <VersionCard version={node.version} versionById={versionById} {...rest} />
      {children.length > 0 && (
        <ul className="ml-6 mt-2 space-y-2 border-l pl-4">
          {children.map((c) => (
            <li key={c.version.id} className="relative">
              <CornerDownRight
                className="absolute -left-4 top-4 size-3 text-muted-foreground/70"
                aria-hidden
              />
              <VersionNode node={c} versionById={versionById} {...rest} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

interface VersionCardProps {
  versionById: Map<string, DocumentVersionDTO>
  selectedId: string | null
  activeId: string | null
  compareA: string | null
  busyId: string | null
  onSelect: (id: string) => void
  onCompareWith: (id: string) => void
  onCompareTo: (id: string) => void
  onActivate: (v: DocumentVersionDTO) => void
  onRestore: (v: DocumentVersionDTO) => void
  onRename: (v: DocumentVersionDTO) => void
  onDelete: (v: DocumentVersionDTO) => void
}

function VersionCard({ version: v, versionById, selectedId, activeId, compareA, busyId, onSelect, onCompareWith, onCompareTo, onActivate, onRestore, onRename, onDelete }: VersionCardProps & { version: DocumentVersionDTO }) {
  const busy = busyId === v.id
  const parent = v.parentVersionId ? versionById.get(v.parentVersionId) : undefined
  const selected = selectedId === v.id
  const canCompare = compareA !== null && compareA !== v.id

  return (
    <Card
      className={cn(
        'py-0 transition-colors',
        selected && 'border-primary/50 bg-primary/5',
        !selected && 'hover:border-primary/30'
      )}
    >
      <CardContent className="flex items-start gap-2 p-4">
        <button type="button" onClick={() => onSelect(v.id)} className="min-w-0 flex-1 text-left" aria-label={`Выбрать версию ${v.label}`}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-sm font-semibold">{v.label}</span>
            {kindBadge(v)}
            {v.isActive && activeId === v.id && (
              <Badge variant="outline" className="border-teal-500/50 bg-teal-500/10 text-[10px] text-teal-600 dark:text-teal-300">
                <CheckCircle2 className="size-3" aria-hidden />
                активная
              </Badge>
            )}
            {selected && (
              <Badge variant="secondary" className="text-[10px]">
                открыта
              </Badge>
            )}
            {busy && <InlineSpinner label="восстановление…" />}
          </div>
          <div className="mt-2 grid gap-x-6 gap-y-0.5 text-[11px] sm:grid-cols-2">
            <Meta k="Источник" v={SOURCE_TITLES[v.source] ?? v.source} />
            <Meta k="Известная версия" v={v.knownVersion ?? '—'} mono />
            <Meta k="Импорт" v={new Date(v.importDate).toLocaleString('ru-RU')} />
            <Meta k="Фрагментов" v={String(v.fragmentCount)} mono />
            <Meta k="Хэш (sha256)" v={`${v.contentHash.slice(0, 10)}…`} mono />
            {parent && <Meta k="Родитель" v={parent.label} mono />}
          </div>
          {v.note && <p className="mt-1.5 line-clamp-2 text-[11px] text-muted-foreground">{v.note}</p>}
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {canCompare && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={() => onCompareTo(v.id)}
              title={`Сравнить с «${versionById.get(compareA!)?.label ?? compareA}»`}
            >
              <GitCompare className="size-3.5" aria-hidden />
              Сравнить
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="size-7" aria-label={`Действия с версией ${v.label}`}>
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onClick={() => onActivate(v)} disabled={v.isActive || busy}>
                <Play className="size-3.5" aria-hidden />
                Сделать активной…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void onRestore(v)}
                disabled={busy || v.id === activeId}
                title={
                  v.id === activeId
                    ? 'Эта версия уже активна — восстанавливать нечего'
                    : undefined
                }
              >
                <GitBranch className="size-3.5" aria-hidden />
                Восстановить как ветку
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onRename(v)} disabled={busy}>
                <Pencil className="size-3.5" aria-hidden />
                Переименовать…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onCompareWith(v.id)}
                disabled={allVersionsCount(versionById) < 2}
              >
                <GitCompare className="size-3.5" aria-hidden />
                Сравнить с…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-rose-600 focus:text-rose-600 dark:text-rose-400 dark:focus:text-rose-400"
                disabled={v.kind !== 'experimental' || busy}
                title={v.kind !== 'experimental' ? 'Удалять можно только экспериментальные ветки' : undefined}
                onClick={() => onDelete(v)}
              >
                <Trash2 className="size-3.5" aria-hidden />
                Удалить…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  )
}

function allVersionsCount(versionById: Map<string, DocumentVersionDTO>) {
  return versionById.size
}

function Meta({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <p className="flex items-baseline gap-1.5">
      <span className="shrink-0 text-muted-foreground">{k}:</span>
      <span className={cn('min-w-0 truncate', mono && 'font-mono')}>{v}</span>
    </p>
  )
}
