export interface IndexState { status: string; model: string; formatVersion: number; textHash: string }

export function isIndexEntryCurrent(entry: IndexState | null, model: string, formatVersion: number, textHash: string): boolean {
  return Boolean(entry && entry.status === 'ready' && entry.model === model && entry.formatVersion === formatVersion && entry.textHash === textHash)
}

export function isIndexEntryCompatible(entry: IndexState & { dimensions: number }, model: string, formatVersion: number, textHash: string, dimensions: number, vectorLength: number | null): boolean {
  return entry.status === 'ready' && entry.model === model && entry.formatVersion === formatVersion
    && entry.textHash === textHash && vectorLength !== null && entry.dimensions === dimensions && vectorLength === dimensions
}

export function cosineSimilarity(a: number[], b: number[]): number | null {
  if (!a.length || a.length !== b.length || !a.every(Number.isFinite) || !b.every(Number.isFinite)) return null
  let dot = 0, aa = 0, bb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i] }
  if (!aa || !bb) return null
  return dot / Math.sqrt(aa * bb)
}

export function parseVector(value: string): number[] | null {
  try {
    const raw: unknown = JSON.parse(value)
    return Array.isArray(raw) && raw.every((n) => typeof n === 'number' && Number.isFinite(n)) ? raw : null
  } catch { return null }
}
