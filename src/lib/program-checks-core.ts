export function findNonFiniteJsonLiteral(text: string): string | null {
  const outsideStrings = text.replace(/"(?:\\.|[^"\\])*"/g, '""')
  return outsideStrings.match(/(?<![\w])(-?Infinity|NaN)(?![\w])/)?.[1] ?? null
}

/** Local scanner for duplicate keys inside JSON object literals. */
export function findDuplicateJsonKeys(text: string): string[] {
  const duplicates: string[] = []
  const keySets: Set<string>[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '{') { keySets.push(new Set()); i++; continue }
    if (ch === '}') { keySets.pop(); i++; continue }
    if (ch === '"') {
      let j = i + 1, key = '', closed = false
      while (j < text.length) {
        const c = text[j]
        if (c === '\\' && j + 1 < text.length) { key += text.slice(j, j + 2); j += 2; continue }
        if (c === '"') { closed = true; break }
        key += c; j++
      }
      if (!closed) break
      let k = j + 1
      while (k < text.length && /\s/.test(text[k])) k++
      if (text[k] === ':' && keySets.length > 0) {
        const set = keySets[keySets.length - 1]
        if (set.has(key)) { if (!duplicates.includes(key)) duplicates.push(key) }
        else set.add(key)
      }
      i = j + 1; continue
    }
    i++
  }
  return duplicates
}

export function inspectDuplicateKeys(text: string, syntaxValid: boolean) {
  if (!syntaxValid) return { passed: false, status: 'unverified' as const, duplicates: [], detail: 'Проверка дубликатов не завершена: JSON повреждён, результат неопределён' }
  const duplicates = findDuplicateJsonKeys(text)
  if (duplicates.length) return { passed: false, status: 'failed' as const, duplicates, detail: `Локальная проверка (эвристика): повторяющиеся ключи — ${duplicates.join(', ')}` }
  return { passed: true, status: 'passed' as const, duplicates, detail: 'Локальная проверка: повторяющихся ключей в объектах не найдено' }
}
