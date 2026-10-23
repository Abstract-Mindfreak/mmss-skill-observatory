// Разъяснение статусов: провенанс (LIVE/LOCAL/DEMO/PLACEHOLDER/STALE/ERROR),
// статусы выполнения запусков и вердикты — «статус выполнения ≠ вердикт проверки».
'use client'

import * as React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RunStatusBadge, StatusBadge, VerdictBadge } from '@/components/shared/status-badges'

const PROVENANCE_DOCS: { status: 'LIVE' | 'LOCAL' | 'DEMO' | 'PLACEHOLDER' | 'STALE' | 'ERROR'; text: string }[] = [
  { status: 'LIVE', text: 'реальное выполнение через подключённый сервис (модель, GitHub)' },
  { status: 'LOCAL', text: 'реальное локальное вычисление или проверка, без модели' },
  { status: 'DEMO', text: 'синтетические данные для демонстрации интерфейса; в реальные метрики не входят' },
  { status: 'PLACEHOLDER', text: 'функция не реализована — видна на месте использования и в реестре' },
  { status: 'STALE', text: 'результат относится к предыдущей версии входных данных' },
  { status: 'ERROR', text: 'выполнение завершилось ошибкой' },
]

const RUN_STATUS_DOCS: { status: 'planned' | 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'; text: string }[] = [
  { status: 'planned', text: 'создан, но ещё не ставился в очередь' },
  { status: 'queued', text: 'ожидает выполнения' },
  { status: 'running', text: 'запрос к модели выполняется' },
  { status: 'completed', text: 'выполнение завершилось (вердикт — отдельно)' },
  { status: 'cancelled', text: 'отменён пользователем' },
  { status: 'failed', text: 'ошибка выполнения (не вердикт «не пройдено»)' },
]

export function StatusExplainer() {
  return (
    <Card>
      <CardHeader className="gap-2 pb-3">
        <CardTitle className="text-sm">Статусы выполнения и вердикты</CardTitle>
        <CardDescription>
          Три независимые шкалы: происхождение результата, статус выполнения запуска и вердикт проверки.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Провенанс результата</p>
          {PROVENANCE_DOCS.map((d) => (
            <div key={d.status} className="flex items-start gap-2">
              <StatusBadge status={d.status} withHint={false} />
              <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted-foreground">{d.text}</span>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Статус выполнения запуска</p>
          <div className="flex flex-wrap gap-2">
            {RUN_STATUS_DOCS.map((d) => (
              <RunStatusBadge key={d.status} status={d.status} />
            ))}
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-muted-foreground">
            {RUN_STATUS_DOCS.map((d) => (
              <li key={d.status}>
                <span className="font-medium text-foreground/80">{d.status}</span> — {d.text}
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Вердикт проверки</p>
          <div className="flex flex-wrap items-center gap-2">
            <VerdictBadge verdict="pass" by="model" />
            <VerdictBadge verdict="fail" by="model" />
            <VerdictBadge verdict="inconclusive" by="model" />
            <VerdictBadge verdict={null} />
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            pass — критерий выполнен; fail — обнаружен дефект; inconclusive — данных недостаточно; «вердикт не
            установлен» — проверка не проводилась или ответ модели не разобран.
          </p>
        </div>
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
          <p className="text-xs leading-relaxed">
            <span className="font-medium">Статус выполнения ≠ вердикт проверки.</span> Завершённая проверка (completed)
            может обнаружить дефект (fail); ошибка выполнения (failed) — это не вердикт «не пройдено», а потеря
            результата. Вердикт выставляет модель (evaluator), программа (локальные проверки) или пользователь —
            источник указан у каждого вердикта.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
