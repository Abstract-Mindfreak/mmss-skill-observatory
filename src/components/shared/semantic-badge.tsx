import type { ReactNode } from 'react'

const OBJECT_LABELS: Record<string, string> = {
  position: 'Положение', source: 'Источник', scenario: 'Сценарий', run: 'Run',
  evaluation: 'Оценка', observation: 'Наблюдение', discrepancy: 'Расхождение', campaign: 'Кампания',
}

const STATUS_LABELS: Record<string, string> = {
  running: 'Выполняется', 'in-progress': 'Выполняется', prepared: 'Ожидает запуска', pending: 'Ожидает', queued: 'В очереди',
  paused: 'Приостановлено', blocked: 'Заблокировано', failed: 'Техническая ошибка',
  'insufficient-data': 'Недостаточно данных', inconclusive: 'Недостаточно данных',
  'likely-revision': 'Вероятно требуется правка', 'no-issue-in-checked-cases': 'Проблем не обнаружено в выполненных проверках',
  proposed: 'Proposed · предложено', accepted: 'Accepted · принято пользователем', disputed: 'Disputed · оспорено пользователем',
  unverified: 'Unverified · не проверено', completed: 'Завершено', cancelled: 'Отменено', stopped: 'Остановлено',
  supported: 'Поддержано источником', concern: 'Есть замечание', compatible: 'Совместимо в выполненной проверке',
  pass: 'Pass · пройдено', fail: 'Fail · не пройдено', unexplored: 'Ещё не исследовалось',
}

export function ObjectTypeBadge({ kind, children }: { kind: string; children?: ReactNode }) {
  return <span className="semantic-badge semantic-object-badge" data-object-kind={kind}>{children ?? OBJECT_LABELS[kind] ?? kind}</span>
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className="semantic-badge semantic-status-badge" data-status={status}>{label ?? STATUS_LABELS[status] ?? status}</span>
}
