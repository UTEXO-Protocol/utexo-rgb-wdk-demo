// Shared types for the RLN testing surface.
//
// Keep this module dep-free (no React, no RN imports) — it's loaded
// both by UI components and by the headless TestRunner.

export type LogLevel = 'action' | 'success' | 'error' | 'info'

/**
 * One structured event. Every method invocation, test step, and
 * autonomous-run signal produces at least one of these.
 *
 * Written to two sinks:
 *   1. The in-app `LogStore` ring buffer (UI display).
 *   2. The on-disk JSONL file (export / E2E pull).
 *
 * Stable fields only — anything UI-only goes through the JSON `payload`.
 */
export interface LogEntry {
  /** Monotonic id within a session — used as React key + de-dup. */
  id: number
  /** ISO 8601 timestamp (millisecond precision). */
  ts: string
  level: LogLevel
  /** Coarse category — usually the tab name (`btc`, `channels`, `e2e`). */
  category: string
  /** Method or operation name (`getAddress`, `openChannel`, `t-12.asset-issue`). */
  method: string
  /** Short human-readable summary. */
  message: string
  /** Optional structured payload — request, response, error stack, etc. */
  payload?: unknown
  /** Optional E2E test-case id when emitted from `TestRunner`. */
  testCaseId?: string
  /** Optional UID for the session (set once at boot). */
  sessionId?: string
}

/**
 * Per-method UX state — the last input the user entered (for replay)
 * and the last result we got back (for the result panel). Held by
 * `SessionStore` keyed by method id (e.g. `"btc.sendTransaction"`).
 */
export interface MethodSnapshot {
  lastInput?: Record<string, unknown> | string | null
  lastResult?: unknown
  lastError?: string
  lastStatus?: 'ok' | 'err' | 'running' | null
  lastDurationMs?: number
  lastRunAt?: string
}

/**
 * Field spec for a `MethodCard` input form. Used to schema-drive the
 * UI — no per-method bespoke JSX needed.
 */
export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'json'        // arbitrary JSON blob; rendered as multi-line text
  | 'select'      // enum; `options` required

export interface FieldSpec {
  name: string
  type: FieldType
  /** Default value if the user hasn't touched the field. */
  default?: unknown
  /** Whether this field must be filled before `Run` is enabled. */
  required?: boolean
  /** Short caption shown above the input. */
  label?: string
  /** Helper text shown below the input. */
  hint?: string
  /** For `select` fields. */
  options?: string[]
  /** Cap textarea height — defaults to 1 line. */
  multiline?: boolean
}

/**
 * Full spec for one MethodCard. Either `args` (positional list of raw
 * args to forward to the ext method) or `fields` (form-driven; the
 * card builds a request object from the field values).
 */
export interface MethodSpec {
  /** Unique within a category: `"btc.sendTransaction"`. */
  id: string
  /** Display title — short imperative phrase. */
  title: string
  /** Optional subtitle / description rendered above the form. */
  description?: string
  /** Method name on the LnExt proxy (the actual call). */
  extMethod: string
  /** Category for log filtering — usually matches the tab. */
  category: string
  /** Form fields driving the input. */
  fields: FieldSpec[]
  /**
   * Optional translator: turns the raw {field → value} map into the
   * actual argument list passed to the ext method. Default behaviour
   * if absent: pass the field map as a single object argument.
   */
  buildArgs?: (values: Record<string, unknown>) => unknown[]
  /**
   * Optional iter-2 blocker tag — when set, the card renders a
   * "blocked upstream" badge and the autonomous runner expects-fail
   * for tests using it.
   */
  blockedBy?: 'iter-2-B1' | 'iter-2-B2' | 'iter-2-B3'
  /** Optional note rendered as a small caption under the title. */
  note?: string
}
