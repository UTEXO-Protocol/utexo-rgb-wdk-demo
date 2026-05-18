// E2ETab — autonomous test runner UI.
//
// Surface:
//   • Config row (peer base url, bitcoind creds) — defaulted from
//     UnlockGate values; user can override.
//   • "Run all" button → walks every test case in order.
//   • Per-category buttons → run just one category's cases.
//   • Result list: status icon, id, title, duration, expand to see
//     payload / error.
//   • Bottom: "report.json path on device" + share/export.
//
// The runner streams every step through the LogStore — the bottom
// LogDrawer is the live console. The report.json gets written to the
// app document dir for off-device pull (adb / simctl).

import React from 'react'
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Paths, File } from 'expo-file-system'
import type { LnExt } from '../ext/LnExt'
import { TestRunner } from '../testing/TestRunner'
import { ChainController } from '../testing/ChainController'
import { PeerClient } from '../testing/PeerClient'
import { TEST_CASES } from '../testing/testCases'
import type { RunnerSnapshot, TestStatus } from '../testing/types'
import { logEvent, logStore } from '../state/LogStore'
import { colors } from '../components/colors'

const HOST_LOOPBACK = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1'

const CATEGORIES = Array.from(new Set(TEST_CASES.map((c) => c.category)))

export function E2ETab ({ ext }: { ext: LnExt | null }): React.ReactElement {
  // ── Config — defaults match the regtest stack the UnlockGate uses ──
  const [peerBaseUrl, setPeerBaseUrl] = React.useState(`http://${HOST_LOOPBACK}:3001`)
  const [btcRpcHost, setBtcRpcHost] = React.useState(HOST_LOOPBACK)
  const [btcRpcPort, setBtcRpcPort] = React.useState('18443')
  const [btcRpcUser, setBtcRpcUser] = React.useState('user')
  const [btcRpcPass, setBtcRpcPass] = React.useState('password')
  const [peerHostForLn, setPeerHostForLn] = React.useState(HOST_LOOPBACK)
  const [peerLnPort, setPeerLnPort] = React.useState('9735')

  // ── Runner state ──
  const runnerRef = React.useRef<TestRunner | null>(null)
  const [snap, setSnap] = React.useState<RunnerSnapshot>({
    status: 'idle', currentId: null, results: [],
    startedAt: null, finishedAt: null, report: null
  })
  const [diag, setDiag] = React.useState<string | null>(null)

  const buildRunner = React.useCallback((): TestRunner | null => {
    if (!ext) {
      setDiag('Account not ready')
      return null
    }
    const chain = new ChainController({
      host: btcRpcHost,
      port: parseInt(btcRpcPort, 10),
      username: btcRpcUser,
      password: btcRpcPass
      // wallet name omitted on purpose — ChainController defaults to
      // 'miner' which is the wallet name regtest.sh creates. Passing
      // 'default' here was the cause of t11.fundDevice failing with
      // "Requested wallet does not exist or is not loaded".
    })
    const peer = new PeerClient({ baseUrl: peerBaseUrl })
    // Env-derived test-case state. Seeded through the runner's
    // `initialState` so it survives the per-run state reset.
    const initialState: Record<string, unknown> = {
      'env.peer_host': peerHostForLn,
      'env.peer_ln_port': peerLnPort,
      'env.indexer_url': `tcp://${HOST_LOOPBACK}:50001`,
      'env.proxy_endpoint': `rpc://${HOST_LOOPBACK}:3001/json-rpc`
    }
    const runner = new TestRunner(TEST_CASES, { ext, peer, chain, initialState })
    runnerRef.current = runner
    runner.subscribe(() => setSnap(runner.snapshot()))
    return runner
  }, [ext, btcRpcHost, btcRpcPort, btcRpcUser, btcRpcPass, peerBaseUrl, peerHostForLn, peerLnPort])

  const onRunAll = React.useCallback(async () => {
    if (snap.status === 'running') return
    setDiag(null)
    const runner = buildRunner()
    if (!runner) return
    logEvent('action', 'e2e', 'ui-run-all', 'starting full suite')
    try { await runner.run() } catch (e) {
      setDiag((e as Error).message)
      logEvent('error', 'e2e', 'ui-run-all', `runner threw: ${(e as Error).message}`)
    }
  }, [buildRunner, snap.status])

  const onRunCategory = React.useCallback(async (category: string) => {
    if (snap.status === 'running') return
    setDiag(null)
    const runner = buildRunner()
    if (!runner) return
    logEvent('action', 'e2e', 'ui-run-category', category)
    try { await runner.run(category) } catch (e) {
      setDiag((e as Error).message)
    }
  }, [buildRunner, snap.status])

  const onCopyReport = React.useCallback(async () => {
    if (!snap.report) return
    await Clipboard.setStringAsync(JSON.stringify(snap.report, null, 2))
  }, [snap.report])

  const onExportReport = React.useCallback(async () => {
    if (!snap.report) return
    const sessionId = logStore.getSessionId()
    const file = new File(Paths.document, `rln-e2e-report-${sessionId}.json`)
    // `.delete()` SIGABRTs the bridge if the file doesn't exist —
    // `.exists` gate is mandatory.
    try {
      if (file.exists) file.delete()
      file.create()
      file.write(JSON.stringify(snap.report, null, 2))
      setDiag(`exported to ${file.uri}`)
    } catch (e) {
      // Fallback: try writing without delete/create. `write` on an
      // existing file overwrites.
      try {
        file.write(JSON.stringify(snap.report, null, 2))
        setDiag(`exported to ${file.uri} (overwrite path)`)
      } catch (e2) {
        setDiag(`export failed: ${(e2 as Error).message}`)
      }
      void e
    }
  }, [snap.report])

  const running = snap.status === 'running'

  // Autonomous-launch hook: if the screen was opened via the
  // `utexo://rln-e2e/run` deep link, the shell flips a global flag
  // before mounting this tab. We auto-fire `Run all` once the ext
  // is ready and clear the flag so a manual tab switch doesn't
  // re-trigger.
  React.useEffect(() => {
    if (!ext) return
    const g = globalThis as unknown as { __rlnE2EAutoRun?: boolean }
    if (g.__rlnE2EAutoRun) {
      g.__rlnE2EAutoRun = false
      logEvent('info', 'e2e', 'autorun', 'deep-link autorun triggered')
      onRunAll()
    }
  }, [ext, onRunAll])

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <Text style={styles.title}>End-to-End Test Runner</Text>
      <Text style={styles.subtitle}>
        Walks {TEST_CASES.length} scenarios covering the full RLN surface. Counterparty + chain control
        are driven via HTTP/RPC against your regtest stack. Every step funnels through the log drawer.
      </Text>

      <Group title="Counterparty (peer RLN HTTP API)">
        <Row><Label>base url</Label><TextInput style={styles.input} value={peerBaseUrl} onChangeText={setPeerBaseUrl} autoCapitalize="none" /></Row>
        <Row><Label>LN host</Label><TextInput style={styles.input} value={peerHostForLn} onChangeText={setPeerHostForLn} autoCapitalize="none" /></Row>
        <Row><Label>LN port</Label><TextInput style={styles.input} value={peerLnPort} onChangeText={setPeerLnPort} keyboardType="numeric" /></Row>
      </Group>

      <Group title="bitcoind RPC (chain controller)">
        <Row><Label>host</Label><TextInput style={styles.input} value={btcRpcHost} onChangeText={setBtcRpcHost} autoCapitalize="none" /></Row>
        <Row><Label>port</Label><TextInput style={styles.input} value={btcRpcPort} onChangeText={setBtcRpcPort} keyboardType="numeric" /></Row>
        <Row><Label>user</Label><TextInput style={styles.input} value={btcRpcUser} onChangeText={setBtcRpcUser} autoCapitalize="none" /></Row>
        <Row><Label>pass</Label><TextInput style={styles.input} value={btcRpcPass} onChangeText={setBtcRpcPass} autoCapitalize="none" /></Row>
      </Group>

      <View style={styles.actionsRow}>
        <TouchableOpacity style={[styles.btnRun, (running || !ext) && styles.btnDisabled]} onPress={onRunAll} disabled={running || !ext}>
          {running ? <ActivityIndicator color="#000" /> : <Text style={styles.btnRunText}>Run all ({TEST_CASES.length})</Text>}
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionLabel}>Run a category</Text>
      <View style={styles.chipRow}>
        {CATEGORIES.map((cat) => (
          <TouchableOpacity key={cat} style={[styles.chip, running && styles.btnDisabled]} onPress={() => onRunCategory(cat)} disabled={running}>
            <Text style={styles.chipText}>{cat}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.statusBlock}>
        <Text style={styles.statusLine}>
          status: <Text style={{ color: statusColor(snap.status) }}>{snap.status}</Text>
          {snap.currentId ? <Text style={styles.currentTag}>{'  '}→ {snap.currentId}</Text> : null}
        </Text>
        {snap.report && (
          <>
            <Text style={styles.statusLine}>
              {snap.report.passed}/{snap.report.total} passed · {snap.report.expectedFail} expected-fail · {snap.report.unexpectedPass} unexpected-pass · {snap.report.skipped} skipped · {snap.report.failed} failed
            </Text>
            <View style={styles.exportRow}>
              <TouchableOpacity style={styles.exportBtn} onPress={onCopyReport}><Text style={styles.exportText}>copy report</Text></TouchableOpacity>
              <TouchableOpacity style={styles.exportBtn} onPress={onExportReport}><Text style={styles.exportText}>export</Text></TouchableOpacity>
            </View>
          </>
        )}
        {diag && <Text style={styles.diag}>{diag}</Text>}
      </View>

      {snap.results.length > 0 && (
        <View style={styles.resultsBlock}>
          <Text style={styles.sectionLabel}>Results ({snap.results.length})</Text>
          {snap.results.map((r) => <ResultRow key={r.id} result={r} />)}
        </View>
      )}
    </ScrollView>
  )
}

function ResultRow ({ result }: { result: ReturnType<TestRunner['snapshot']>['results'][number] }) {
  const [expanded, setExpanded] = React.useState(false)
  return (
    <TouchableOpacity style={styles.row} onPress={() => setExpanded((v) => !v)} activeOpacity={0.7}>
      <View style={styles.rowHead}>
        <Text style={[styles.rowIcon, { color: statusColor(result.status) }]}>{statusIcon(result.status)}</Text>
        <Text style={styles.rowId}>{result.id}</Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.rowDur}>{result.durationMs}ms</Text>
      </View>
      <Text style={styles.rowTitle}>{result.title}</Text>
      {result.blockedBy && <Text style={styles.rowBlocked}>blocked: {result.blockedBy}</Text>}
      {result.error && !expanded && <Text style={styles.rowErr} numberOfLines={1}>{result.error}</Text>}
      {expanded && (
        <View style={styles.expand}>
          {result.error && <Text style={styles.rowErr}>{result.error}</Text>}
          {result.payload !== undefined && (
            <Text style={styles.rowPayload} selectable>{safe(result.payload)}</Text>
          )}
        </View>
      )}
    </TouchableOpacity>
  )
}

function safe (v: unknown): string {
  try { return JSON.stringify(v, null, 2).slice(0, 1500) } catch { return String(v) }
}

function statusIcon (s: TestStatus): string {
  switch (s) {
    case 'pass': return '✓'
    case 'fail': return '✗'
    case 'skip': return '⊘'
    case 'running': return '⋯'
    case 'expected-fail': return '↯'
    case 'pending':
    default: return '·'
  }
}

function statusColor (s: TestStatus | 'idle' | 'running' | 'done'): string {
  switch (s) {
    case 'pass': case 'done':           return colors.success
    case 'fail':                         return colors.danger
    case 'skip':                         return colors.textTertiary
    case 'expected-fail':                return colors.blocked
    case 'running':                      return colors.warning
    case 'idle':                         return colors.textSecondary
    default:                              return colors.textSecondary
  }
}

function Group ({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.group}><Text style={styles.groupTitle}>{title}</Text>{children}</View>
}
function Row ({ children }: { children: React.ReactNode }) { return <View style={styles.fieldRow}>{children}</View> }
function Label ({ children }: { children: React.ReactNode }) { return <Text style={styles.label}>{children}</Text> }

const styles = StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: colors.background },
  content: { padding: 12, paddingBottom: 32 },
  title:   { color: colors.text, fontSize: 18, fontWeight: '700' },
  subtitle:{ color: colors.textSecondary, fontSize: 12, marginTop: 4, marginBottom: 12, lineHeight: 17 },

  group:   { backgroundColor: colors.card, borderRadius: 8, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.borderSubtle },
  groupTitle: { color: colors.textSecondary, fontSize: 11, textTransform: 'uppercase', fontWeight: '700', marginBottom: 8 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  label:   { color: colors.textSecondary, fontSize: 12, width: 70 },
  input:   { flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardElevated, color: colors.text, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, fontFamily: 'Menlo', fontSize: 12 },

  actionsRow: { marginTop: 4, marginBottom: 14 },
  btnRun:    { backgroundColor: colors.primary, padding: 14, borderRadius: 8, alignItems: 'center' },
  btnDisabled: { opacity: 0.5 },
  btnRunText: { color: '#000', fontWeight: '700', fontSize: 15 },

  sectionLabel: { color: colors.textSecondary, fontSize: 11, textTransform: 'uppercase', fontWeight: '700', marginTop: 8, marginBottom: 6 },
  chipRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  chip:     { backgroundColor: colors.cardElevated, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  chipText: { color: colors.text, fontSize: 11 },

  statusBlock: { backgroundColor: colors.card, borderRadius: 8, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.borderSubtle },
  statusLine: { color: colors.text, fontSize: 12, fontFamily: 'Menlo', marginBottom: 4 },
  currentTag: { color: colors.warning },
  diag:    { color: colors.error, fontSize: 11, marginTop: 6 },
  exportRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  exportBtn: { backgroundColor: colors.cardElevated, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4 },
  exportText: { color: colors.text, fontSize: 11 },

  resultsBlock: { marginTop: 6 },
  row:      { backgroundColor: colors.card, borderRadius: 6, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: colors.borderSubtle },
  rowHead:  { flexDirection: 'row', alignItems: 'center' },
  rowIcon:  { fontSize: 14, fontWeight: '700', marginRight: 6, width: 14, textAlign: 'center' },
  rowId:    { color: colors.textSecondary, fontSize: 11, fontFamily: 'Menlo' },
  rowDur:   { color: colors.textTertiary, fontSize: 10, fontFamily: 'Menlo' },
  rowTitle: { color: colors.text, fontSize: 12, marginTop: 2 },
  rowBlocked: { color: colors.blocked, fontSize: 10, fontStyle: 'italic', marginTop: 2 },
  rowErr:   { color: colors.error, fontSize: 11, fontFamily: 'Menlo', marginTop: 4 },
  rowPayload: { color: colors.textTertiary, fontSize: 10, fontFamily: 'Menlo', marginTop: 4, backgroundColor: colors.cardElevated, padding: 6, borderRadius: 4 },
  expand: { marginTop: 6 }
})
