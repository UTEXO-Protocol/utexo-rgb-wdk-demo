// LogDrawer — persistent bottom drawer with filterable log entries.
//
// Two modes:
//   • Collapsed: shows the last 3 lines + a count + level tally.
//   • Expanded: full scroll, filter chips, copy-all, export-as-file.
//
// Reads from the global `LogStore`; subscribes via `useLogEntries`.

import React from 'react'
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import { Paths, File } from 'expo-file-system'
import type { LogEntry, LogLevel } from '../state/types'
import { logStore, useLogEntries } from '../state/LogStore'
import { safeStringify } from './JsonViewer'
import { colors } from './colors'

const LEVELS: LogLevel[] = ['action', 'success', 'error', 'info']

export function LogDrawer (): React.ReactElement {
  const entries = useLogEntries()
  const [open, setOpen] = React.useState(false)
  const [levelFilter, setLevelFilter] = React.useState<Set<LogLevel>>(new Set(LEVELS))
  const [text, setText] = React.useState('')

  const filtered = React.useMemo(() => {
    const lower = text.trim().toLowerCase()
    return entries.filter((e) => {
      if (!levelFilter.has(e.level)) return false
      if (!lower) return true
      return (
        e.method.toLowerCase().includes(lower) ||
        e.category.toLowerCase().includes(lower) ||
        e.message.toLowerCase().includes(lower)
      )
    })
  }, [entries, levelFilter, text])

  const tally = React.useMemo(() => tallyLevels(entries), [entries])
  const last3 = entries.slice(-3).reverse()

  const onCopyAll = React.useCallback(async () => {
    const blob = filtered.map(entryToLine).join('\n')
    await Clipboard.setStringAsync(blob)
  }, [filtered])

  const onExport = React.useCallback(async () => {
    const sessionId = logStore.getSessionId()
    const path = `rln-log-${sessionId}.jsonl`
    const file = new File(Paths.document, path)
    const jsonl = entries.map((e) => JSON.stringify(e)).join('\n')
    // NB: don't call `.delete()` — it throws a Swift exception that
    // escapes JS try/catch and SIGABRTs the bridge if the file
    // doesn't exist. Check `.exists` instead.
    try {
      if (file.exists) file.delete()
      file.create()
      file.write(jsonl)
    } catch {
      // last-resort: try a direct write — `.write` overwrites if the
      // file was created earlier in this session by the JSONL sink.
      try { file.write(jsonl) } catch { /* swallow */ }
    }
  }, [entries])

  const onClear = React.useCallback(() => { logStore.clear() }, [])

  return (
    <>
      <TouchableOpacity style={styles.bar} onPress={() => setOpen(true)} activeOpacity={0.8}>
        <View style={styles.barRow}>
          <Text style={styles.barLabel}>logs</Text>
          <Text style={styles.barCount}>{entries.length}</Text>
          <View style={{ flex: 1 }} />
          <TallyDot color={colors.success} n={tally.success} />
          <TallyDot color={colors.danger} n={tally.error} />
          <TallyDot color={colors.warning} n={tally.action} />
          <TallyDot color={colors.info} n={tally.info} />
        </View>
        {last3.length === 0 ? (
          <Text style={styles.barIdle}>(no entries yet — actions and test events will appear here)</Text>
        ) : (
          last3.map((e) => (
            <Text key={e.id} style={styles.barLine} numberOfLines={1}>{entryToLine(e)}</Text>
          ))
        )}
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" presentationStyle="overFullScreen" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={styles.modalContainer} edges={['top', 'left', 'right']}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Log — {entries.length} entries</Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={styles.headerBtn} onPress={onCopyAll}><Text style={styles.headerBtnText}>copy</Text></TouchableOpacity>
            <TouchableOpacity style={styles.headerBtn} onPress={onExport}><Text style={styles.headerBtnText}>export</Text></TouchableOpacity>
            <TouchableOpacity style={styles.headerBtn} onPress={onClear}><Text style={styles.headerBtnTextDanger}>clear</Text></TouchableOpacity>
            <TouchableOpacity style={styles.headerBtn} onPress={() => setOpen(false)}><Text style={styles.headerBtnText}>close</Text></TouchableOpacity>
          </View>

          <View style={styles.filterRow}>
            {LEVELS.map((lv) => {
              const active = levelFilter.has(lv)
              return (
                <TouchableOpacity
                  key={lv}
                  style={[styles.chip, active && { backgroundColor: levelColor(lv), borderColor: levelColor(lv) }]}
                  onPress={() => {
                    setLevelFilter((prev) => {
                      const next = new Set(prev)
                      if (next.has(lv)) next.delete(lv); else next.add(lv)
                      return next
                    })
                  }}
                >
                  <Text style={[styles.chipText, active && { color: '#000', fontWeight: '700' }]}>{lv}</Text>
                </TouchableOpacity>
              )
            })}
            <View style={{ flex: 1 }} />
          </View>

          <FlatList
            data={filtered.slice().reverse()}
            keyExtractor={(e) => String(e.id)}
            renderItem={({ item }) => <LogRow entry={item} />}
            initialNumToRender={50}
            removeClippedSubviews
            style={styles.list}
          />
        </SafeAreaView>
      </Modal>
    </>
  )
}

function LogRow ({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = React.useState(false)
  return (
    <TouchableOpacity onPress={() => setExpanded((v) => !v)} activeOpacity={0.7} style={styles.row}>
      <View style={styles.rowHead}>
        <View style={[styles.dot, { backgroundColor: levelColor(entry.level) }]} />
        <Text style={styles.rowTs}>{entry.ts.slice(11, 23)}</Text>
        <Text style={styles.rowCategory}>{entry.category}</Text>
        <Text style={styles.rowMethod}>{entry.method}</Text>
        {entry.testCaseId && <Text style={styles.rowTest}>[{entry.testCaseId}]</Text>}
      </View>
      <Text style={styles.rowMessage}>{entry.message}</Text>
      {expanded && entry.payload !== undefined && (
        <Text style={styles.rowPayload} selectable>{safeStringify(entry.payload).slice(0, 1500)}</Text>
      )}
    </TouchableOpacity>
  )
}

function TallyDot ({ color, n }: { color: string; n: number }) {
  if (n === 0) return null
  return (
    <View style={[styles.tally, { borderColor: color }]}>
      <Text style={[styles.tallyText, { color }]}>{n}</Text>
    </View>
  )
}

function entryToLine (e: LogEntry): string {
  return `[${e.ts.slice(11, 19)}] [${e.level.toUpperCase()}] ${e.category}.${e.method}: ${e.message}`
}

function tallyLevels (entries: LogEntry[]): Record<LogLevel, number> {
  const t: Record<LogLevel, number> = { action: 0, success: 0, error: 0, info: 0 }
  for (const e of entries) t[e.level] += 1
  return t
}

function levelColor (lv: LogLevel): string {
  switch (lv) {
    case 'success': return colors.success
    case 'error':   return colors.danger
    case 'action':  return colors.warning
    case 'info':    return colors.info
  }
}

const styles = StyleSheet.create({
  bar:        { backgroundColor: colors.cardElevated, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 12, paddingVertical: 8 },
  barRow:     { flexDirection: 'row', alignItems: 'center' },
  barLabel:   { color: colors.text, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginRight: 8 },
  barCount:   { color: colors.textSecondary, fontSize: 12 },
  barIdle:    { color: colors.textTertiary, fontSize: 11, marginTop: 4, fontStyle: 'italic' },
  barLine:    { color: colors.textSecondary, fontSize: 11, fontFamily: 'Menlo', marginTop: 2 },
  tally:      { borderWidth: 1, borderRadius: 10, paddingHorizontal: 6, marginLeft: 4, paddingVertical: 1 },
  tallyText:  { fontSize: 10, fontWeight: '700' },

  modalContainer: { flex: 1, backgroundColor: colors.background },
  modalHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8 },
  modalTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  headerBtn:  { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4, backgroundColor: colors.cardElevated },
  headerBtnText: { color: colors.text, fontSize: 12 },
  headerBtnTextDanger: { color: colors.danger, fontSize: 12 },

  filterRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  chip:       { borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
  chipText:   { color: colors.textSecondary, fontSize: 11 },

  list:       { flex: 1, paddingHorizontal: 8 },
  row:        { paddingHorizontal: 6, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  rowHead:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot:        { width: 6, height: 6, borderRadius: 3 },
  rowTs:      { color: colors.textTertiary, fontSize: 10, fontFamily: 'Menlo' },
  rowCategory:{ color: colors.info, fontSize: 11, fontFamily: 'Menlo' },
  rowMethod:  { color: colors.text, fontSize: 11, fontFamily: 'Menlo', fontWeight: '600' },
  rowTest:    { color: colors.warning, fontSize: 10, fontFamily: 'Menlo' },
  rowMessage: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  rowPayload: { color: colors.textTertiary, fontSize: 10, fontFamily: 'Menlo', marginTop: 4, backgroundColor: colors.cardElevated, padding: 6, borderRadius: 4 }
})
