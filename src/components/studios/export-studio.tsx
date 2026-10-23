// Экспорт и передача: всё копируемо и скачиваемо (ТЗ п.14), Research Handoff
// Report, импорт архива проекта.
'use client'

import * as React from 'react'
import { Share2 } from 'lucide-react'
import { SectionHeader } from '@/components/shared/misc'
import { CopyCenter } from './export/copy-cards'
import { DownloadsCard } from './export/downloads-card'
import { HandoffCard } from './export/handoff-card'
import { ImportCard } from './export/import-card'

export default function ExportStudio() {
  return (
    <div className="space-y-6 py-2">
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            <Share2 className="size-5 text-primary" aria-hidden />
            Экспорт и передача
          </span>
        }
        description="Копирование фрагментов и результатов, скачивание отчётов и архива, Research Handoff Report для передачи исследования, импорт архива в другой экземпляр обсерватории."
      />

      <CopyCenter />

      <div className="grid gap-4 lg:grid-cols-2">
        <DownloadsCard />
        <ImportCard />
      </div>

      <HandoffCard />
    </div>
  )
}
