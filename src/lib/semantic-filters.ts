const DIAGNOSTIC_MARKER = /\[(?:SMOKE|DIAGNOSTIC)\]/i

export function hasDiagnosticMarker(...values: unknown[]) {
  return values.some((value) => {
    if (typeof value === 'string') return DIAGNOSTIC_MARKER.test(value)
    if (value == null) return false
    try { return DIAGNOSTIC_MARKER.test(JSON.stringify(value)) }
    catch { return false }
  })
}

export function isDiagnosticObservation(source: {
  observation?: unknown; evidenceText?: unknown; run?: { input?: unknown; output?: unknown } | null
  note?: { body?: unknown; kind?: unknown; origin?: unknown } | null
}) {
  return hasDiagnosticMarker(
    source.observation,
    source.evidenceText,
    source.run?.input,
    source.run?.output,
    source.note?.body,
    source.note?.kind,
    source.note?.origin,
  )
}
