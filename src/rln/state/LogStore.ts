// Central log store for the RLN testing UI.
//
// Ring-buffered (max 2000 entries) so a long autonomous run doesn't
// blow up memory. Every entry also flows to the on-disk JSONL sink
// (registered by `RgbLightningScreen` at mount time) so logs survive
// app restarts and can be pulled off-device via `adb` / `simctl`.

import React from 'react'
import type { LogEntry, LogLevel } from './types'

const MAX_ENTRIES = 2000

type LogSink = (entry: LogEntry) => void

type Listener = () => void

class Store {
  private entries: LogEntry[] = []
  private listeners = new Set<Listener>()
  private sinks: LogSink[] = []
  private counter = 0
  private sessionId: string

  constructor () {
    // 11-char base36 id from time + 3 random digits is plenty for
    // log correlation across one session; no crypto needed.
    this.sessionId = Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e3).toString(36)
  }

  getSessionId (): string { return this.sessionId }

  getAll (): LogEntry[] { return this.entries }

  /**
   * Subscribe to "any change". Returns the unsubscribe fn.
   * The React hook in this module wraps this for `useSyncExternalStore`.
   */
  subscribe (l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  /**
   * Register a JSONL-file sink (or any other side-channel). Returns
   * an unregister fn. Sinks are called synchronously on every log
   * write — fast & non-blocking only please.
   */
  addSink (s: LogSink): () => void {
    this.sinks.push(s)
    return () => {
      const i = this.sinks.indexOf(s)
      if (i >= 0) this.sinks.splice(i, 1)
    }
  }

  log (level: LogLevel, category: string, method: string, message: string, payload?: unknown, testCaseId?: string): LogEntry {
    const entry: LogEntry = {
      id: ++this.counter,
      ts: new Date().toISOString(),
      level,
      category,
      method,
      message,
      payload,
      testCaseId,
      sessionId: this.sessionId
    }
    // Replace the array reference rather than mutating in place — React's
    // `useSyncExternalStore` compares snapshots by identity, so a
    // mutated-in-place array would never re-render UI subscribers.
    // The trade is one extra concat per log entry; with MAX_ENTRIES=2000
    // this is sub-millisecond and well below the cost of the re-render
    // itself.
    const next = this.entries.length >= MAX_ENTRIES
      ? this.entries.slice(Math.floor(MAX_ENTRIES * 0.1)).concat(entry)
      : this.entries.concat(entry)
    this.entries = next
    for (const s of this.sinks) {
      try { s(entry) } catch { /* a broken sink mustn't kill logging */ }
    }
    for (const l of this.listeners) l()
    return entry
  }

  /** Truncate the in-memory buffer (UI-side reset). Sinks are unaffected. */
  clear () {
    this.entries = []
    for (const l of this.listeners) l()
  }
}

const store = new Store()

/**
 * Process-wide log handle. Exported for non-React callers (TestRunner,
 * FileSink registration in App effect, etc.). React UI should prefer
 * the `useLogStore` hook below — it triggers re-render on writes.
 */
export const logStore = store

/**
 * Convenience: structured log writer. The TestRunner and ext-call
 * wrappers all funnel through this.
 */
export function logEvent (
  level: LogLevel,
  category: string,
  method: string,
  message: string,
  payload?: unknown,
  testCaseId?: string
): LogEntry {
  return store.log(level, category, method, message, payload, testCaseId)
}

/**
 * React hook returning the current entries array. Re-renders the
 * subscriber every time a new entry lands.
 */
export function useLogEntries (): LogEntry[] {
  return React.useSyncExternalStore(
    React.useCallback((cb) => store.subscribe(cb), []),
    () => store.getAll(),
    () => store.getAll()
  )
}

/**
 * Helper wrapping a single ext-method invocation with structured
 * logging, latency capture, and error normalisation. Used by
 * `MethodCard` and the autonomous `TestRunner`.
 *
 * Returns `{ status: 'ok', result, durationMs }` on success or
 * `{ status: 'err', error, durationMs }` on failure — never throws.
 */
export async function runWithLogging<T> (opts: {
  category: string
  method: string
  message?: string
  input?: unknown
  testCaseId?: string
  run: () => Promise<T> | T
}): Promise<
  | { status: 'ok'; result: T; durationMs: number }
  | { status: 'err'; error: string; durationMs: number }
> {
  const startedAt = Date.now()
  logEvent('action', opts.category, opts.method, opts.message ?? 'invoke', opts.input, opts.testCaseId)
  try {
    const result = await opts.run()
    const durationMs = Date.now() - startedAt
    logEvent('success', opts.category, opts.method, `ok (${durationMs}ms)`, result, opts.testCaseId)
    return { status: 'ok', result, durationMs }
  } catch (e: unknown) {
    const durationMs = Date.now() - startedAt
    const error = e instanceof Error ? e.message : String(e)
    logEvent('error', opts.category, opts.method, `fail (${durationMs}ms): ${error}`, { input: opts.input, error }, opts.testCaseId)
    return { status: 'err', error, durationMs }
  }
}
