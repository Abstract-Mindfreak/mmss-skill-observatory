import { NextResponse } from 'next/server'
import { loadDocumentDTO } from '@/lib/import-doc'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  const dto = await loadDocumentDTO(id)
  if (!dto) {
    return NextResponse.json({ error: 'Документ не найден' }, { status: 404 })
  }
  return NextResponse.json(dto)
}
