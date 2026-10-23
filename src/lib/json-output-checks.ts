export interface JsonOutputScopeResult {
  rawValid: boolean
  rawError: string
  normalizedValid: boolean
  normalizedError: string
  normalizedText: string
}

export function normalizeFencedJson(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?\s*```$/)
  return match ? match[1].trim() : trimmed
}

export function inspectJsonOutputScopes(text: string): JsonOutputScopeResult {
  let rawValid = false
  let rawError = ''
  try { JSON.parse(text); rawValid = true }
  catch (error) { rawError = error instanceof Error ? error.message : String(error) }

  const normalizedText = normalizeFencedJson(text)
  let normalizedValid = false
  let normalizedError = ''
  try { JSON.parse(normalizedText); normalizedValid = true }
  catch (error) { normalizedError = error instanceof Error ? error.message : String(error) }
  return { rawValid, rawError, normalizedValid, normalizedError, normalizedText }
}
