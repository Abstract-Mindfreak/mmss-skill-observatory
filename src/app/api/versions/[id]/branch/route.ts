import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sha256Hex } from '@/lib/serialize'
import { buildFragmentsForVersion } from '@/lib/parser'
import { runLocalAnalysis } from '@/lib/analysis'
import { loadVersionDTO } from '@/lib/import-doc'

type Params = { params: Promise<{ id: string }> }

const FRAGMENT_BATCH = 200

export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  const parent = await db.documentVersion.findUnique({ where: { id } })
  if (!parent) {
    return NextResponse.json({ error: 'Родительская версия не найдена' }, { status: 404 })
  }

  const content = typeof body?.content === 'string' ? body.content : ''
  if (!content.trim()) {
    return NextResponse.json(
      { error: 'Передайте содержимое новой версии (content)' },
      { status: 400 }
    )
  }
  const contentHash = sha256Hex(content)
  if (contentHash === parent.contentHash) {
    return NextResponse.json(
      { error: 'Содержимое идентично родительской версии' },
      { status: 400 }
    )
  }

  const childCount = await db.documentVersion.count({
    where: { parentVersionId: parent.id },
  })
  const label =
    typeof body?.label === 'string' && body.label.trim()
      ? body.label.trim()
      : `experiment-${childCount + 1}`
  const note =
    typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null

  const version = await db.documentVersion.create({
    data: {
      documentId: parent.documentId,
      projectId: parent.projectId,
      label,
      kind: 'experimental',
      source: 'branch',
      sourceUrl: null,
      knownVersion: parent.knownVersion,
      completeness: 'full',
      content,
      contentHash,
      parentVersionId: parent.id,
      note,
      isActive: false,
    },
  })

  const payloads = buildFragmentsForVersion(version.id, content)
  for (let i = 0; i < payloads.length; i += FRAGMENT_BATCH) {
    await db.fragment.createMany({ data: payloads.slice(i, i + FRAGMENT_BATCH) })
  }
  await runLocalAnalysis(version.id)

  return NextResponse.json(await loadVersionDTO(version), { status: 201 })
}
