'use client'

import * as React from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api-client'
import type { FragmentDTO } from '@/lib/types'

export function TaskMaterialFragmentPicker({
  versionId, value, onChange, label, required = false,
}: { versionId: string | null; value: string | null; onChange: (id: string | null, fragment: FragmentDTO | null) => void; label: string; required?: boolean }) {
  const [items, setItems] = React.useState<FragmentDTO[]>([])
  React.useEffect(() => {
    let active = true
    if (!versionId) return
    api.versionFragments(versionId).then((result) => { if (active) setItems(result) }).catch(() => { if (active) setItems([]) })
    return () => { active = false }
  }, [versionId])
  return <div className="space-y-1">
    <Label className="text-xs">{label}{required ? ' · обязательно' : ''}</Label>
    <Select value={value ?? 'none'} onValueChange={(id) => {
      const fragment = items.find((item) => item.id === id) ?? null
      onChange(id === 'none' ? null : id, fragment)
    }} disabled={!versionId}>
      <SelectTrigger size="sm"><SelectValue placeholder="Выберите фрагмент" /></SelectTrigger>
      <SelectContent><SelectItem value="none">{required ? 'Выберите фрагмент' : 'Не добавлять материал'}</SelectItem>
        {items.map((item) => <SelectItem key={item.id} value={item.id}>{item.id} · {item.path} · {item.title ?? item.kind}</SelectItem>)}
      </SelectContent>
    </Select>
    {value && <div className="max-h-36 overflow-auto rounded border p-2 text-[10px]"><p className="font-mono">{value} · версия {versionId}</p><pre className="whitespace-pre-wrap">{items.find((item) => item.id === value)?.text ?? 'Фрагмент загружается или недоступен'}</pre></div>}
  </div>
}
