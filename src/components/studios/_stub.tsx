// Honest stub used while a studio is being implemented. Replaced by real studios.
'use client'

import { Construction } from 'lucide-react'
import { EmptyState } from '@/components/shared/states'
import { StatusBadge } from '@/components/shared/status-badges'

export function StudioStub({ title, what }: { title: string; what: string }) {
  return (
    <div className="space-y-4 py-8">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">{title}</h1>
        <StatusBadge status="PLACEHOLDER" />
      </div>
      <EmptyState
        icon={Construction}
        title="Раздел в разработке"
        hint={`Здесь будет: ${what}. Заглушка видна честно — фиктивного успеха интерфейс не показывает.`}
      />
    </div>
  )
}
