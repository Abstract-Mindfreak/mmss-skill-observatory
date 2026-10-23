import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toFragmentDTO } from '@/lib/serialize'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const version = await db.documentVersion.findUnique({ where: { id }, select: { id: true } })
  if (!version) return NextResponse.json({ error: 'Версия не найдена' }, { status: 404 })
  const fragments = await db.fragment.findMany({ where: { versionId: id }, orderBy: { order: 'asc' } })
  return NextResponse.json(fragments.map(toFragmentDTO))
}
