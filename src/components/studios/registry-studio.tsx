// Реестр статусов: честная карта «что реально работает, что локально, что DEMO,
// что не реализовано» (ТЗ п.13) + менеджер DEMO-данных + разъяснение статусов.
'use client'

import * as React from 'react'
import { ClipboardList, Lock } from 'lucide-react'
import { SectionHeader } from '@/components/shared/misc'
import { DemoManager } from './registry/demo-manager'
import { FunctionsRegistry } from './registry/functions-registry'
import { PlaceholdersCard } from './registry/placeholders-card'
import { StatusExplainer } from './registry/status-explainer'

export default function RegistryStudio() {
  return (
    <div className="space-y-6 py-2">
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            <ClipboardList className="size-5 text-primary" aria-hidden />
            Реестр статусов
          </span>
        }
        description="Честная карта функций обсерватории: что выполняется реально (LIVE), что вычисляется локально (LOCAL), что синтетично (DEMO) и что не реализовано (PLACEHOLDER). Управление DEMO-данными — здесь же."
      />

      <FunctionsRegistry />

      <div className="grid gap-4 lg:grid-cols-2">
        <PlaceholdersCard />
        <div className="space-y-4">
          <DemoManager />
          <div className="flex items-start gap-2.5 rounded-md border p-3">
            <Lock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Экспорты не содержат подключений и секретов: адреса Ollama-подключений не попадают в архив, отчёты и
              Research Handoff Report. Секреты в приложении не хранятся.
            </p>
          </div>
        </div>
      </div>

      <StatusExplainer />
    </div>
  )
}
