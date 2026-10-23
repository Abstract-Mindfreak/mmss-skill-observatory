// GET /api/projects/[id]/export?format=json|md|csv&parts=all|<list>
// ProjectArchive / Markdown report / CSV tables (owner: agent 1-c)
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  ARCHIVE_PARTS,
  buildCsvExport,
  buildMarkdownReport,
  buildProjectArchive,
  parsePartsParam,
  projectSlug,
} from '@/lib/exporters'

const FORMATS = ['json', 'md', 'csv'] as const

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const sp = new URL(req.url).searchParams
    const format = sp.get('format') ?? 'json'
    if (!FORMATS.includes(format as (typeof FORMATS)[number])) {
      return NextResponse.json(
        {
          error: 'Неизвестный формат экспорта',
          detail: `Поддерживаются: ${FORMATS.join(', ')}`,
        },
        { status: 400 }
      )
    }
    let parts: string[]
    try {
      parts = parsePartsParam(sp.get('parts'), ARCHIVE_PARTS)
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 })
    }
    const project = await db.project.findUnique({ where: { id } })
    if (!project) {
      return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
    }
    const slug = projectSlug(project.name)

    if (format === 'json') {
      const archive = await buildProjectArchive(id, parts)
      if (!archive) {
        return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
      }
      return new NextResponse(JSON.stringify(archive, null, 2), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${slug}-archive.json"`,
        },
      })
    }
    if (format === 'md') {
      const md = await buildMarkdownReport(id, parts)
      if (md === null) {
        return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
      }
      return new NextResponse(md, {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="${slug}-archive.md"`,
        },
      })
    }
    const csv = await buildCsvExport(id, parts)
    if (csv === null) {
      return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
    }
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${slug}-archive.csv"`,
      },
    })
  } catch (e) {
    console.error('export route error', e)
    return NextResponse.json(
      { error: 'Ошибка экспорта', detail: String(e) },
      { status: 500 }
    )
  }
}
