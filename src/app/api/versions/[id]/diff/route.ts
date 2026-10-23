import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { diffVersions } from '@/lib/diff'
import type { VersionDiffDTO } from '@/lib/types'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: Params) {
  const { id } = await params
  const otherId = new URL(req.url).searchParams.get('other')
  if (!otherId) {
    return NextResponse.json(
      { error: 'Укажите версию для сравнения (?other=<versionId>)' },
      { status: 400 }
    )
  }
  const b = await db.documentVersion.findUnique({ where: { id } })
  if (!b) {
    return NextResponse.json({ error: 'Версия не найдена' }, { status: 404 })
  }
  const a = await db.documentVersion.findUnique({ where: { id: otherId } })
  if (!a) {
    return NextResponse.json({ error: 'Версия для сравнения (other) не найдена' }, { status: 404 })
  }

  const diff = diffVersions(a.content, b.content)
  const dto: VersionDiffDTO = {
    aVersionId: a.id,
    bVersionId: b.id,
    aLabel: a.label,
    bLabel: b.label,
    aHash: a.contentHash,
    bHash: b.contentHash,
    identical: a.contentHash === b.contentHash,
    addedLines: diff.addedLines,
    removedLines: diff.removedLines,
    hunks: diff.hunks,
  }
  return NextResponse.json(dto)
}
