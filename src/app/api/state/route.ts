import { NextResponse } from 'next/server'
import { buildAppState } from '@/lib/import-doc'

export async function GET(req: Request) {
  try {
    const projectId = new URL(req.url).searchParams.get('projectId')
    const state = await buildAppState(projectId)
    return NextResponse.json(state)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { error: 'Не удалось собрать состояние приложения', detail },
      { status: 500 }
    )
  }
}
