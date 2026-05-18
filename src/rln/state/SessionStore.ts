// Per-method "last input / last result" memory so MethodCards retain
// their state across tab switches and re-renders. Process-wide, in
// memory only — not persisted to disk.

import React from 'react'
import type { MethodSnapshot } from './types'

type Listener = (id: string) => void

// Sentinel returned when a method hasn't been invoked yet. Frozen so a
// caller can't accidentally mutate it; the same instance is reused
// across calls so `useSyncExternalStore` sees a stable reference and
// doesn't trigger React's "maximum update depth" guard. (Returning
// `?? {}` from `get()` would mint a new object every read and put us
// into an infinite render loop.)
const EMPTY_SNAPSHOT: MethodSnapshot = Object.freeze({}) as MethodSnapshot

class Store {
  private byId = new Map<string, MethodSnapshot>()
  private listeners = new Set<Listener>()

  get (id: string): MethodSnapshot {
    return this.byId.get(id) ?? EMPTY_SNAPSHOT
  }

  patch (id: string, partial: MethodSnapshot): void {
    const next = { ...this.byId.get(id), ...partial }
    this.byId.set(id, next)
    for (const l of this.listeners) l(id)
  }

  subscribe (id: string, l: () => void): () => void {
    const wrapped: Listener = (changedId) => { if (changedId === id) l() }
    this.listeners.add(wrapped)
    return () => this.listeners.delete(wrapped)
  }

  clear (): void {
    this.byId.clear()
  }
}

export const sessionStore = new Store()

/**
 * React hook reading the snapshot for one method id. Re-renders on
 * any patch for that id (not others).
 */
export function useMethodSnapshot (id: string): MethodSnapshot {
  return React.useSyncExternalStore(
    React.useCallback((cb) => sessionStore.subscribe(id, cb), [id]),
    () => sessionStore.get(id),
    () => sessionStore.get(id)
  )
}
