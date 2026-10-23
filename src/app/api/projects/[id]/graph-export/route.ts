// GET /api/projects/[id]/graph-export?versionId=&format=json|md|txt
// Self-contained graph export built from the stored local analysis (owner: agent 1-c)
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildGraphExport, projectSlug } from '@/lib/exporters'

const FORMATS = ['json', 'md', 'txt'] as const

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const sp = new URL(req.url).searchParams
    const versionId = sp.get('versionId') ?? undefined
    const format = sp.get('format') ?? 'json'
    if (!FORMATS.includes(format as (typeof FORMATS)[number])) {
      return NextResponse.json(
        {
          error: 'Неизвестный формат экспорта графа',
          detail: `Поддерживаются: ${FORMATS.join(', ')}`,
        },
        { status: 400 }
      )
    }
    const project = await db.project.findUnique({ where: { id } })
    if (!project) {
      return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
    }
    const result = await buildGraphExport(id, versionId, format as 'json' | 'md' | 'txt')
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const slug = projectSlug(project.name)
    if (format === 'json') {
      return new NextResponse(JSON.stringify(result.data, null, 2), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${slug}-graph.json"`,
        },
      })
    }
    const contentType = format === 'md' ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8'
    return new NextResponse(result.text ?? '', {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${slug}-graph.${format}"`,
      },
    })
  } catch (e) {
    console.error('graph-export route error', e)
    return NextResponse.json(
      { error: 'Ошибка экспорта графа', detail: String(e) },
      { status: 500 }
    )
  }
}
