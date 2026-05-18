// MethodCard — one card per RLN/WDK method.
//
// Driven by a `MethodSpec`: input form, Run/Reset/Copy buttons,
// last-status icon, latency, and a `JsonViewer` for the result.
// Every invocation flows through `runWithLogging` so the LogDrawer +
// JSONL sink see it.

import React from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import type { LnExt } from '../ext/LnExt'
import type { MethodSpec } from '../state/types'
import { runWithLogging } from '../state/LogStore'
import { sessionStore, useMethodSnapshot } from '../state/SessionStore'
import { Field } from './Field'
import { JsonViewer, safeStringify } from './JsonViewer'
import { colors } from './colors'

interface Props {
  ext: LnExt | null
  spec: MethodSpec
}

export function MethodCard ({ ext, spec }: Props): React.ReactElement {
  const snap = useMethodSnapshot(spec.id)
  // Local field state — initialised from defaults + last input. Kept
  // separate from `sessionStore.lastInput` because typing into a field
  // shouldn't trigger global re-renders on every keystroke.
  const [values, setValues] = React.useState<Record<string, unknown>>(() => {
    const start: Record<string, unknown> = {}
    for (const f of spec.fields) start[f.name] = f.default ?? ''
    if (snap.lastInput && typeof snap.lastInput === 'object') {
      Object.assign(start, snap.lastInput as Record<string, unknown>)
    }
    return start
  })

  const running = snap.lastStatus === 'running'
  const disabled = running || !ext

  const setField = React.useCallback((name: string, next: unknown) => {
    setValues((prev) => ({ ...prev, [name]: next }))
  }, [])

  const onReset = React.useCallback(() => {
    const fresh: Record<string, unknown> = {}
    for (const f of spec.fields) fresh[f.name] = f.default ?? ''
    setValues(fresh)
  }, [spec])

  const onCopyInput = React.useCallback(async () => {
    await Clipboard.setStringAsync(safeStringify(values))
  }, [values])

  const onRun = React.useCallback(async () => {
    if (!ext) return
    // Materialise the arg list from the form values.
    let args: unknown[]
    try {
      args = spec.buildArgs ? spec.buildArgs(values) : [normaliseValues(spec, values)]
    } catch (e) {
      sessionStore.patch(spec.id, { lastStatus: 'err', lastError: (e as Error).message, lastRunAt: new Date().toISOString() })
      return
    }
    sessionStore.patch(spec.id, { lastStatus: 'running', lastInput: values, lastError: undefined, lastResult: undefined })
    const out = await runWithLogging({
      category: spec.category,
      method: spec.extMethod,
      message: spec.title,
      input: args.length === 1 ? args[0] : args,
      run: async () => {
        const fn = (ext as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[spec.extMethod]
        if (typeof fn !== 'function') throw new Error(`ext.${spec.extMethod} is not a function`)
        return fn(...args)
      }
    })
    if (out.status === 'ok') {
      sessionStore.patch(spec.id, {
        lastStatus: 'ok',
        lastResult: out.result,
        lastError: undefined,
        lastDurationMs: out.durationMs,
        lastRunAt: new Date().toISOString()
      })
    } else {
      sessionStore.patch(spec.id, {
        lastStatus: 'err',
        lastResult: undefined,
        lastError: out.error,
        lastDurationMs: out.durationMs,
        lastRunAt: new Date().toISOString()
      })
    }
  }, [ext, spec, values])

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <StatusDot status={snap.lastStatus ?? null} />
        <Text style={styles.title}>{spec.title}</Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.methodTag}>{spec.extMethod}</Text>
      </View>
      {spec.blockedBy ? (
        <Text style={styles.blocked}>⚠ blocked upstream ({spec.blockedBy})</Text>
      ) : null}
      {spec.note ? <Text style={styles.note}>{spec.note}</Text> : null}
      {spec.description ? <Text style={styles.description}>{spec.description}</Text> : null}

      {spec.fields.length > 0 && (
        <View style={styles.form}>
          {spec.fields.map((f) => (
            <Field key={f.name} spec={f} value={values[f.name]} onChange={(v) => setField(f.name, v)} disabled={disabled} />
          ))}
        </View>
      )}

      <View style={styles.actions}>
        <TouchableOpacity style={[styles.btn, styles.btnRun, disabled && styles.btnDisabled]} onPress={onRun} disabled={disabled}>
          {running ? <ActivityIndicator color="#000" /> : <Text style={styles.btnRunText}>Run</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnGhost} onPress={onReset} disabled={disabled}>
          <Text style={styles.btnGhostText}>Reset</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnGhost} onPress={onCopyInput}>
          <Text style={styles.btnGhostText}>Copy input</Text>
        </TouchableOpacity>
        {typeof snap.lastDurationMs === 'number' && (
          <Text style={styles.latency}>{snap.lastDurationMs}ms</Text>
        )}
      </View>

      {snap.lastError ? (
        <View style={styles.errBox}>
          <Text style={styles.errText}>{snap.lastError}</Text>
        </View>
      ) : null}

      {snap.lastResult !== undefined ? (
        <JsonViewer label="result" value={snap.lastResult} defaultExpanded={false} />
      ) : null}
    </View>
  )
}

function StatusDot ({ status }: { status: 'ok' | 'err' | 'running' | null }) {
  const color =
    status === 'ok' ? colors.success :
    status === 'err' ? colors.danger :
    status === 'running' ? colors.warning :
    colors.textTertiary
  return <View style={[styles.dot, { backgroundColor: color }]} />
}

/**
 * Map raw form values to a request shape. Numbers stay numbers,
 * `json` fields are parsed, `select`/`string`/`boolean` pass through,
 * empty strings become `undefined` so they don't override server
 * defaults. Returned object retains only fields the user touched.
 */
function normaliseValues (spec: MethodSpec, values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of spec.fields) {
    const v = values[f.name]
    if (v === undefined || v === null || v === '') continue
    if (f.type === 'json' && typeof v === 'string') {
      try { out[f.name] = JSON.parse(v) } catch { out[f.name] = v }
      continue
    }
    if (f.type === 'number' && typeof v === 'string') {
      const n = Number(v)
      if (!Number.isNaN(n)) out[f.name] = n
      continue
    }
    out[f.name] = v
  }
  return out
}

const styles = StyleSheet.create({
  card:       { backgroundColor: colors.card, borderRadius: 8, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.borderSubtle },
  header:     { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  dot:        { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  title:      { color: colors.text, fontSize: 15, fontWeight: '600' },
  methodTag:  { color: colors.textTertiary, fontSize: 10, fontFamily: 'Menlo' },
  blocked:    { color: colors.blocked, fontSize: 11, marginTop: 4, fontStyle: 'italic' },
  note:       { color: colors.info, fontSize: 11, marginTop: 4 },
  description:{ color: colors.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 17 },
  form:       { marginTop: 8 },
  actions:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  btn:        { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, alignItems: 'center', justifyContent: 'center', minWidth: 64 },
  btnRun:     { backgroundColor: colors.primary },
  btnDisabled:{ opacity: 0.4 },
  btnRunText: { color: '#000', fontWeight: '700' },
  btnGhost:   { paddingHorizontal: 10, paddingVertical: 8 },
  btnGhostText: { color: colors.textSecondary, fontSize: 12 },
  latency:    { color: colors.textTertiary, fontSize: 11, marginLeft: 'auto' },
  errBox:     { backgroundColor: '#3a1414', borderColor: colors.danger, borderWidth: 1, borderRadius: 6, padding: 8, marginTop: 8 },
  errText:    { color: colors.error, fontFamily: 'Menlo', fontSize: 11 }
})
