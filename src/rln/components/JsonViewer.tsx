// JsonViewer — collapsible pretty-printed JSON with per-row copy.
//
// Avoids react-native-json-tree (extra dep) by doing the simplest
// thing that works: pretty-stringify, render in a monospace block,
// add a single "Copy" button. Big payloads are clamped (max 2000
// chars rendered) but the full string still copies.

import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { colors } from './colors'

const RENDER_CLAMP = 2000

interface Props {
  value: unknown
  /** Label shown above the JSON (e.g. "result", "input"). */
  label?: string
  /** Force the viewer to render expanded by default. */
  defaultExpanded?: boolean
}

export function JsonViewer ({ value, label, defaultExpanded = true }: Props): React.ReactElement {
  const [expanded, setExpanded] = React.useState(defaultExpanded)
  const text = React.useMemo(() => safeStringify(value), [value])
  const clipped = text.length > RENDER_CLAMP
  const display = clipped ? text.slice(0, RENDER_CLAMP) + '\n…[truncated; full payload in clipboard on copy]' : text

  const onCopy = React.useCallback(async () => {
    await Clipboard.setStringAsync(text)
  }, [text])

  return (
    <View style={styles.box}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setExpanded((v) => !v)}>
          <Text style={styles.label}>{(label ?? 'result') + ' ' + (expanded ? '▾' : '▸')}</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={onCopy} style={styles.copy}>
          <Text style={styles.copyText}>copy</Text>
        </TouchableOpacity>
      </View>
      {expanded && (
        <View style={styles.body}>
          <Text style={styles.code} selectable>{display}</Text>
          {clipped && <Text style={styles.clippedHint}>+{text.length - RENDER_CLAMP} chars truncated</Text>}
        </View>
      )}
    </View>
  )
}

/**
 * `JSON.stringify` that doesn't blow up on circular refs or BigInts.
 * BigInts serialised as decimal strings; cycles replaced with `[~]`.
 */
export function safeStringify (value: unknown, indent = 2): string {
  const seen = new WeakSet<object>()
  const replacer = (_k: string, v: unknown) => {
    if (typeof v === 'bigint') return v.toString()
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v as object)) return '[~]'
      seen.add(v as object)
    }
    return v
  }
  try {
    return JSON.stringify(value, replacer, indent) ?? String(value)
  } catch (e) {
    return `[unstringifiable: ${(e as Error).message}]`
  }
}

const styles = StyleSheet.create({
  box:    { borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: 6, marginTop: 6 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, backgroundColor: colors.cardElevated, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  label:  { color: colors.textSecondary, fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  copy:   { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.background },
  copyText: { color: colors.primary, fontSize: 11, fontWeight: '600' },
  body:   { paddingHorizontal: 8, paddingVertical: 8 },
  code:   { color: colors.text, fontFamily: 'Menlo', fontSize: 11, lineHeight: 16 },
  clippedHint: { color: colors.textTertiary, fontSize: 10, fontStyle: 'italic', marginTop: 4 }
})
