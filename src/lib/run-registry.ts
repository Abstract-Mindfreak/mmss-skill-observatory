// ============================================================
// MMSS Skill Observatory — in-memory registry of active run
// AbortControllers. Owned by agent 1-b.
// Module-level Map cached on globalThis so it survives Next.js
// hot reloads in development.
// ============================================================

interface RunRegistryGlobal {
  __mmssRunRegistry?: Map<string, AbortController>
}

const g = globalThis as unknown as RunRegistryGlobal

const registry: Map<string, AbortController> = g.__mmssRunRegistry ?? new Map()
g.__mmssRunRegistry = registry

export function registerRun(runId: string, controller: AbortController): void {
  registry.set(runId, controller)
}

export function unregisterRun(runId: string): void {
  registry.delete(runId)
}

export function getRunController(runId: string): AbortController | undefined {
  return registry.get(runId)
}

/** Abort a running run. Returns true if a live controller was found and aborted. */
export function cancelRun(runId: string): boolean {
  const controller = registry.get(runId)
  if (!controller) return false
  controller.abort()
  registry.delete(runId)
  return true
}

export function activeRunIds(): string[] {
  return Array.from(registry.keys())
}
