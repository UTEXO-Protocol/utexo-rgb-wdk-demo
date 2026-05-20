// Drop-in replacement for src/rln/state/LogStore in Node.
//
// The RN LogStore is a zustand-backed pub/sub keyed off the LogDrawer UI.
// Node has no UI — we just need `logEvent` to print structured lines so
// failures surface in the terminal. Keeping the same signature means the
// shared testing modules (PeerClient, TestRunner) work unchanged.

export type LogLevel = 'info' | 'success' | 'error' | 'action' | 'warn' | 'debug'

const LEVEL_TAG: Record<LogLevel, string> = {
  info: 'INFO',
  success: 'OK  ',
  error: 'ERR ',
  action: 'ACT ',
  warn: 'WARN',
  debug: 'DBG '
}

export function logEvent (
  level: LogLevel,
  category: string,
  action: string,
  detail: string,
  payload?: unknown,
  // Accepted but ignored — RN side uses this to group log entries by test
  // case in the UI; on Node the timeline is the terminal stream.
  _testCaseId?: string
): void {
  const tag = LEVEL_TAG[level] ?? level.toUpperCase()
  const head = `[${tag}] ${category}/${action}: ${detail}`
  if (payload === undefined) console.log(head)
  else {
    // Compact payload preview so terminal output stays readable. Full
    // payload still ends up in the per-test report JSON.
    let preview: string
    try {
      preview = JSON.stringify(payload)
      if (preview.length > 240) preview = preview.slice(0, 237) + '…'
    } catch { preview = String(payload) }
    console.log(head, preview)
  }
}

// Session id generated at module load; TestRunner embeds it in the
// report so concurrent runs can be told apart.
const SESSION_ID = `node-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`

// Stub matching the RN LogStore shape so the shared TestRunner ports
// unchanged. We don't retain history on Node — terminal output is the
// stream.
export const logStore = {
  snapshot: () => [] as unknown[],
  subscribe: (_: unknown) => () => undefined,
  clear: () => undefined,
  getSessionId: () => SESSION_ID
}

/**
 * Mirrors the RN-side helper that wraps a single invocation with
 * structured action/success/error events. Identical signature so
 * the shared `TestRunner` ports unchanged.
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
  logEvent('action', opts.category, opts.method, opts.message ?? 'invoke', opts.input)
  try {
    const result = await opts.run()
    const durationMs = Date.now() - startedAt
    logEvent('success', opts.category, opts.method, `ok (${durationMs}ms)`, result)
    return { status: 'ok', result, durationMs }
  } catch (e: unknown) {
    const durationMs = Date.now() - startedAt
    const error = e instanceof Error ? e.message : String(e)
    logEvent('error', opts.category, opts.method, `fail (${durationMs}ms): ${error}`)
    return { status: 'err', error, durationMs }
  }
}
