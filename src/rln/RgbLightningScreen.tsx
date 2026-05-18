// RgbLightningScreen — new tabbed surface for RLN testing.
//
// Shell layout:
//   [ TabBar ]
//   [ active tab (scrollable cards) ]
//   [ LogDrawer (persistent bottom strip / expandable modal) ]
//
// The unlock gate fires once at mount; once `ext.unlock(...)` succeeds
// we flip to the tabbed UI. Per the user, lifecycle (unlock/shutdown/
// signer attach) is out of scope — we keep the existing flow exactly.

import React from 'react'
import { Linking, StyleSheet, Text, View } from 'react-native'
import { useExt } from './ext/useExt'
import { UnlockGate } from './UnlockGate'
import { TabBar, TabSpec } from './TabBar'
import { LogDrawer } from './components/LogDrawer'
import { logEvent, logStore } from './state/LogStore'
import { Paths, File } from 'expo-file-system'
import type { LogEntry } from './state/types'
import { NodeTab, NODE_TAB_SPECS } from './tabs/NodeTab'
import { BtcTab, BTC_TAB_SPECS } from './tabs/BtcTab'
import { PeersChannelsTab, PEERS_CHANNELS_TAB_SPECS } from './tabs/PeersChannelsTab'
import { InvoicesTab, INVOICES_TAB_SPECS } from './tabs/InvoicesTab'
import { PaymentsTab, PAYMENTS_TAB_SPECS } from './tabs/PaymentsTab'
import { HodlTab, HODL_TAB_SPECS } from './tabs/HodlTab'
import { AssetsTab, ASSETS_TAB_SPECS } from './tabs/AssetsTab'
import { RgbTransfersTab, RGB_TRANSFERS_TAB_SPECS } from './tabs/RgbTransfersTab'
import { SignTab, SIGN_TAB_SPECS } from './tabs/SignTab'
import { E2ETab } from './tabs/E2ETab'
import { colors } from './components/colors'

const TABS: TabSpec[] = [
  { id: 'node',     label: 'Node',     badge: NODE_TAB_SPECS.length },
  { id: 'btc',      label: 'BTC',      badge: BTC_TAB_SPECS.length },
  { id: 'channels', label: 'Channels', badge: PEERS_CHANNELS_TAB_SPECS.length },
  { id: 'invoices', label: 'Invoices', badge: INVOICES_TAB_SPECS.length },
  { id: 'payments', label: 'Payments', badge: PAYMENTS_TAB_SPECS.length },
  { id: 'hodl',     label: 'HODL',     badge: HODL_TAB_SPECS.length },
  { id: 'assets',   label: 'Assets',   badge: ASSETS_TAB_SPECS.length },
  { id: 'rgb',      label: 'RGB',      badge: RGB_TRANSFERS_TAB_SPECS.length },
  { id: 'sign',     label: 'Sign',     badge: SIGN_TAB_SPECS.length },
  { id: 'e2e',      label: 'E2E',      badge: '⚡' }
]

export function RgbLightningScreen (): React.ReactElement {
  const { ext, ready, address, isLoading, error } = useExt()
  const [unlocked, setUnlocked] = React.useState(false)
  const [active, setActive] = React.useState<string>('node')

  // Register the on-disk JSONL sink once at mount. Every log entry from
  // here on flows to <documentDir>/rln-log-<sessionId>.jsonl so external
  // tooling (adb / simctl) can pull the trace.
  React.useEffect(() => {
    const sessionId = logStore.getSessionId()
    const path = `rln-log-${sessionId}.jsonl`
    const file = new File(Paths.document, path)
    // expo-file-system's `.delete()` throws a SwiftError that escapes
    // JS try/catch and SIGABRTs the bridge if the file doesn't exist.
    // Use `.exists` to check first, OR (better) skip the delete: each
    // session has a unique sessionId in the filename so the file
    // shouldn't exist anyway. `create()` is idempotent here.
    try {
      if (!file.exists) file.create()
    } catch (e) {
      // create() can also throw if the file unexpectedly exists.
      // That's fine — we'll just append.
      void e
    }
    const sink = (entry: LogEntry) => {
      try { file.write(JSON.stringify(entry) + '\n') } catch { /* swallow — never break logging */ }
    }
    const off = logStore.addSink(sink)
    logEvent('info', 'system', 'session-start', `session ${sessionId}`)
    return () => { off() }
  }, [])

  // After unlock the on-chain address materialises; surface it as an
  // info log so the user can grab it quickly without leaving the tab.
  React.useEffect(() => {
    if (unlocked && address) {
      logEvent('info', 'system', 'address', address)
    }
  }, [unlocked, address])

  // Deep-link handler — supports `utexo://rln-e2e/<action>` for
  // autonomous E2E launches. `run` jumps to the E2E tab; the runner
  // there picks up the tap synthetically via a window event.
  React.useEffect(() => {
    function handle (url: string | null) {
      if (!url) return
      if (!url.startsWith('utexo://')) return
      // utexo://rln-e2e/run → switch to e2e tab and emit a signal.
      if (url.includes('rln-e2e')) {
        setActive('e2e')
        logEvent('info', 'system', 'deeplink', `received ${url}`)
        // Side-channel signal for the E2ETab (auto-run on mount if
        // launched via deep link). Read via getInitialURL on first
        // mount.
        ;(globalThis as unknown as { __rlnE2EAutoRun?: boolean }).__rlnE2EAutoRun = true
      }
    }
    Linking.getInitialURL().then(handle).catch(() => undefined)
    const sub = Linking.addEventListener('url', (e) => handle(e?.url ?? null))
    return () => sub.remove()
  }, [])

  if (!unlocked) {
    return (
      <View style={styles.shell}>
        <UnlockGate ext={ext} ready={ready} onUnlocked={() => setUnlocked(true)} />
        <LogDrawer />
      </View>
    )
  }

  return (
    <View style={styles.shell}>
      <View style={styles.statusBar}>
        <Text style={styles.statusText}>
          ready · {address ? `${address.slice(0, 14)}…` : 'no address'}
        </Text>
        {(isLoading || error) && (
          <Text style={styles.statusError}>{error ?? 'loading…'}</Text>
        )}
      </View>
      <TabBar tabs={TABS} value={active} onChange={setActive} />
      <View style={styles.body}>
        {active === 'node'     && <NodeTab ext={ext} />}
        {active === 'btc'      && <BtcTab ext={ext} />}
        {active === 'channels' && <PeersChannelsTab ext={ext} />}
        {active === 'invoices' && <InvoicesTab ext={ext} />}
        {active === 'payments' && <PaymentsTab ext={ext} />}
        {active === 'hodl'     && <HodlTab ext={ext} />}
        {active === 'assets'   && <AssetsTab ext={ext} />}
        {active === 'rgb'      && <RgbTransfersTab ext={ext} />}
        {active === 'sign'     && <SignTab ext={ext} />}
        {active === 'e2e'      && <E2ETab ext={ext} />}
      </View>
      <LogDrawer />
    </View>
  )
}

const styles = StyleSheet.create({
  shell:    { flex: 1, backgroundColor: colors.background },
  body:     { flex: 1 },
  statusBar:{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  statusText: { color: colors.textSecondary, fontSize: 11, fontFamily: 'Menlo' },
  statusError: { color: colors.warning, fontSize: 11, marginLeft: 12 }
})
