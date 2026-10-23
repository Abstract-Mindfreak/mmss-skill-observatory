type RegistryGlobal = { __s2ModelOperations?: Map<string, AbortController> }
const globalRegistry = globalThis as typeof globalThis & RegistryGlobal
const registry = globalRegistry.__s2ModelOperations ?? new Map<string, AbortController>()
globalRegistry.__s2ModelOperations = registry

export function registerModelOperation(id: string, controller: AbortController) { registry.set(id, controller) }
export function unregisterModelOperation(id: string) { registry.delete(id) }
export function activeModelOperationIds() { return [...registry.keys()] }
export function cancelModelOperation(id: string) {
  const controller = registry.get(id)
  if (!controller) return false
  controller.abort()
  return true
}
