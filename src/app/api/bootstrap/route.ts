import { NextResponse } from 'next/server'
import { ensureSeed } from '@/lib/seed'
import { buildAppState } from '@/lib/import-doc'

export async function POST() {
  try {
    const projectId = await ensureSeed()
    const state = await buildAppState(projectId)
    return NextResponse.json(state)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { error: 'Не удалось выполнить начальную загрузку проекта', detail },
      { status: 500 }
    )
  }
}
