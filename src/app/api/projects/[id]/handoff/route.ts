// GET /api/projects/[id]/handoff?format=md|json&parts=all|<list>
// Research Handoff Report (owner: agent 1-c)
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  HANDOFF_PARTS,
  buildHandoffReport,
  parsePartsParam,
  projectSlug,
} from '@/lib/exporters'

const FORMATS = ['md', 'json'] as const

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const sp = new URL(req.url).searchParams
    const format = sp.get('format') ?? 'md'
    if (!FORMATS.includes(format as (typeof FORMATS)[number])) {
      return NextResponse.json(
        {
          error: 'Неизвестный формат отчёта',
          detail: `Поддерживаются: ${FORMATS.join(', ')}`,
        },
        { status: 400 }
      )
    }
    let parts: string[]
    try {
      // 'all' does NOT include runs-full: full inputs/outputs are opt-in only
      parts = parsePartsParam(
        sp.get('parts'),
        HANDOFF_PARTS,
        HANDOFF_PARTS.filter((p) => p !== 'runs-full')
      )
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 })
    }
    const project = await db.project.findUnique({ where: { id } })
    if (!project) {
      return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
    }
    const slug = projectSlug(project.name)
    const report = await buildHandoffReport(id, parts, format as 'md' | 'json', sp.get('includeFullSkillText') === '1')
    if (report === null) {
      return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
    }
    if (format === 'json') {
      return new NextResponse(JSON.stringify(report, null, 2), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${slug}-handoff.json"`,
        },
      })
    }
    return new NextResponse(report as string, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${slug}-handoff.md"`,
      },
    })
  } catch (e) {
    console.error('handoff route error', e)
    return NextResponse.json(
      { error: 'Ошибка формирования отчёта', detail: String(e) },
      { status: 500 }
    )
  }
}
