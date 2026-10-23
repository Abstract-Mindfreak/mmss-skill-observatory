// POST /api/import — import a ProjectArchive JSON (owner: agent 1-c)
// Body: the archive object itself, or a { archive: {...} } wrapper.
import { NextResponse } from 'next/server'
import { ArchiveValidationError, importProjectArchive } from '@/lib/importers'

function unwrap(body: unknown): unknown {
  if (
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    'archive' in body &&
    (body as Record<string, unknown>).archive &&
    typeof (body as Record<string, unknown>).archive === 'object' &&
    !('format' in body)
  ) {
    return (body as Record<string, unknown>).archive
  }
  return body
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Тело запроса не является корректным JSON' },
      { status: 400 }
    )
  }
  const archive = unwrap(body)
  try {
    const result = await importProjectArchive(archive)
    return NextResponse.json(result)
  } catch (e) {
    if (e instanceof ArchiveValidationError) {
      return NextResponse.json(
        { error: 'Архив не прошёл проверку формата', detail: e.message },
        { status: 400 }
      )
    }
    console.error('import route error', e)
    return NextResponse.json(
      { error: 'Не удалось импортировать архив', detail: String(e) },
      { status: 500 }
    )
  }
}
