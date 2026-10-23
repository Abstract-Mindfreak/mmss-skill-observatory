// Small formatting helpers and RU title maps for the Atlas (local to this studio).

import type {
  FindingSeverity,
  FindingStatus,
  FragmentKind,
  NoteKind,
  ScenarioStatus,
} from '@/lib/types'

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function pluralRu(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  if (b === 1) return one
  return many
}

export function formatDateRu(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU')
}

export const FRAGMENT_KIND_TITLES: Record<FragmentKind, string> = {
  section: 'Раздел',
  paragraph: 'Абзац',
  sentence: 'Предложение',
  list_item: 'Пункт списка',
}

export const NOTE_KIND_TITLES: Record<NoteKind, string> = {
  note: 'Заметка',
  interpretation: 'Интерпретация',
  objection: 'Возражение',
  'user-verdict': 'Вердикт пользователя',
  todo: 'Задача',
}

export const FINDING_SEVERITY_TITLES: Record<FindingSeverity, string> = {
  info: 'Информация',
  warning: 'Предупреждение',
  issue: 'Проблема',
}

export const FINDING_SEVERITY_CLASS: Record<FindingSeverity, string> = {
  info: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-500 dark:text-zinc-400',
  warning: 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-300',
  issue: 'border-rose-500/50 bg-rose-500/10 text-rose-600 dark:text-rose-400',
}

export const FINDING_STATUS_TITLES: Record<FindingStatus, string> = {
  hypothesis: 'Гипотеза',
  supported: 'Подтверждена',
  disputed: 'Оспорена',
  rejected: 'Отвергнута',
}

export const SCENARIO_STATUS_CLASS: Record<ScenarioStatus, string> = {
  unexplored: 'border-dashed border-zinc-500/40 text-zinc-500 dark:text-zinc-400',
  explored: 'border-teal-500/50 bg-teal-500/10 text-teal-600 dark:text-teal-300',
  synthetic: 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-300',
  'run-verified': 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  disputed: 'border-rose-500/50 bg-rose-500/10 text-rose-600 dark:text-rose-400',
  stopped: 'border-zinc-500/40 text-zinc-500 line-through',
}
