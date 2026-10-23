export type TextBackend = 'ollama' | 'freellmapi'

export interface TextBackendChoice {
  backend: TextBackend
  connectionId: string
  model: string
}

/** Explicit action choice wins; otherwise use this project's role assignment. */
export function resolveTextBackend(
  override: TextBackendChoice | null | undefined,
  assignment: TextBackendChoice | null | undefined
): TextBackendChoice | null {
  if (override?.connectionId && override.model) return override
  if (assignment?.connectionId && assignment.model) return assignment
  return null
}

/** Calls exactly the selected client. A provider error is allowed to propagate. */
export function callSelectedTextBackend<T>(
  backend: TextBackend,
  clients: { ollama: () => Promise<T>; freellmapi: () => Promise<T> }
): Promise<T> {
  return backend === 'freellmapi' ? clients.freellmapi() : clients.ollama()
}

export async function assignmentForRole(projectId: string, role: string) {
  const { db } = await import('@/lib/db')
  return db.assignment.findUnique({ where: { projectId_role: { projectId, role } } })
}
