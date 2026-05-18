// UnlockGate — pre-tab screen that drives the one-time `ext.unlock()` call.
//
// Defaults match `rgb-lightning-node/regtest.sh start` (compose.yaml in
// that repo, with rgb-proxy on 3001 to avoid the demo's dev-server
// collision). Once unlock succeeds, the gate flips and the tabbed UI
// becomes the active surface.

import React from 'react'
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import type { LnExt } from './ext/LnExt'
import { logEvent } from './state/LogStore'
import { colors } from './components/colors'

// Android emulator's `localhost`/127.0.0.1 is the emulator itself, NOT
// the host. The host-machine alias from inside the AVD is `10.0.2.2`.
// iOS sim shares the host's loopback so 127.0.0.1 works there.
const HOST_LOOPBACK = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1'

interface Props {
  ext: LnExt | null
  ready: boolean
  onUnlocked: () => void
}

export function UnlockGate ({ ext, ready, onUnlocked }: Props): React.ReactElement {
  const [bitcoindHost, setBitcoindHost] = React.useState(HOST_LOOPBACK)
  const [bitcoindPort, setBitcoindPort] = React.useState('18443')
  const [bitcoindUser, setBitcoindUser] = React.useState('user')
  const [bitcoindPass, setBitcoindPass] = React.useState('password')
  const [indexerUrl, setIndexerUrl] = React.useState(`tcp://${HOST_LOOPBACK}:50001`)
  const [proxyEndpoint, setProxyEndpoint] = React.useState(`rpc://${HOST_LOOPBACK}:3001/json-rpc`)
  const [announceAlias, setAnnounceAlias] = React.useState('wdk-demo')
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const submittedRef = React.useRef(false)

  const onUnlock = React.useCallback(async () => {
    if (!ext || submittedRef.current) return
    submittedRef.current = true
    setBusy(true); setErr(null)
    const request = {
      bitcoind_rpc_username: bitcoindUser,
      bitcoind_rpc_password: bitcoindPass,
      bitcoind_rpc_host: bitcoindHost,
      bitcoind_rpc_port: parseInt(bitcoindPort, 10),
      indexer_url: indexerUrl,
      proxy_endpoint: proxyEndpoint,
      announce_addresses: [] as string[],
      announce_alias: announceAlias
    }
    logEvent('action', 'lifecycle', 'unlock', 'unlocking node', request)
    try {
      await ext.unlock(request)
      logEvent('success', 'lifecycle', 'unlock', 'node unlocked')
      onUnlocked()
    } catch (e: unknown) {
      submittedRef.current = false
      const raw = e instanceof Error ? e.message : String(e)
      const msg = raw.includes('Conflict')
        ? raw + ' — usually means bitcoind/indexer/proxy unreachable. Check the regtest stack is running.'
        : raw
      setErr(msg)
      logEvent('error', 'lifecycle', 'unlock', `fail: ${msg}`)
    } finally {
      setBusy(false)
    }
  }, [ext, bitcoindUser, bitcoindPass, bitcoindHost, bitcoindPort, indexerUrl, proxyEndpoint, announceAlias, onUnlocked])

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Unlock RGB Lightning node</Text>
      <Text style={styles.subtitle}>
        One-time bring-online of the in-process VLS signer + LDK node. Defaults
        target the regtest stack from <Text style={styles.codeInline}>rgb-lightning-node/regtest.sh start</Text>.
      </Text>

      {!ready && (
        <View style={styles.bannerWarn}>
          <Text style={styles.bannerText}>Account not ready — waiting for the worklet to finish booting…</Text>
        </View>
      )}

      <Group title="bitcoind RPC">
        <Row><Label>host</Label><TextInput style={styles.input} value={bitcoindHost} onChangeText={setBitcoindHost} autoCapitalize="none" placeholderTextColor={colors.textTertiary} /></Row>
        <Row><Label>port</Label><TextInput style={styles.input} value={bitcoindPort} onChangeText={setBitcoindPort} keyboardType="numeric" placeholderTextColor={colors.textTertiary} /></Row>
        <Row><Label>user</Label><TextInput style={styles.input} value={bitcoindUser} onChangeText={setBitcoindUser} autoCapitalize="none" placeholderTextColor={colors.textTertiary} /></Row>
        <Row><Label>pass</Label><TextInput style={styles.input} value={bitcoindPass} onChangeText={setBitcoindPass} autoCapitalize="none" placeholderTextColor={colors.textTertiary} /></Row>
      </Group>

      <Group title="indexer + proxy">
        <Row><Label>indexer</Label><TextInput style={styles.input} value={indexerUrl} onChangeText={setIndexerUrl} autoCapitalize="none" placeholderTextColor={colors.textTertiary} /></Row>
        <Row><Label>proxy</Label><TextInput style={styles.input} value={proxyEndpoint} onChangeText={setProxyEndpoint} autoCapitalize="none" placeholderTextColor={colors.textTertiary} /></Row>
        <Row><Label>alias</Label><TextInput style={styles.input} value={announceAlias} onChangeText={setAnnounceAlias} autoCapitalize="none" placeholderTextColor={colors.textTertiary} /></Row>
      </Group>

      <TouchableOpacity style={[styles.btn, (!ext || busy) && styles.btnDisabled]} onPress={onUnlock} disabled={!ext || busy}>
        {busy ? <ActivityIndicator color="#000" /> : <Text style={styles.btnText}>Unlock</Text>}
      </TouchableOpacity>

      {err && <Text style={styles.err}>{err}</Text>}
    </ScrollView>
  )
}

function Group ({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      {children}
    </View>
  )
}

function Row ({ children }: { children: React.ReactNode }) { return <View style={styles.row}>{children}</View> }
function Label ({ children }: { children: React.ReactNode }) { return <Text style={styles.label}>{children}</Text> }

const styles = StyleSheet.create({
  wrap:     { flex: 1, backgroundColor: colors.background },
  content:  { padding: 16, paddingBottom: 32 },
  title:    { color: colors.text, fontSize: 20, fontWeight: '700' },
  subtitle: { color: colors.textSecondary, fontSize: 13, marginTop: 4, marginBottom: 12, lineHeight: 18 },
  codeInline: { fontFamily: 'Menlo', color: colors.primary },
  group:    { backgroundColor: colors.card, borderRadius: 8, padding: 12, marginTop: 12, borderWidth: 1, borderColor: colors.borderSubtle },
  groupTitle: { color: colors.textSecondary, fontSize: 11, textTransform: 'uppercase', fontWeight: '700', marginBottom: 8 },
  row:      { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  label:    { color: colors.textSecondary, fontSize: 12, width: 70 },
  input:    { flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardElevated, color: colors.text, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, fontFamily: 'Menlo', fontSize: 12 },
  btn:      { backgroundColor: colors.primary, marginTop: 16, padding: 14, borderRadius: 8, alignItems: 'center' },
  btnDisabled: { opacity: 0.5 },
  btnText:  { color: '#000', fontWeight: '700', fontSize: 15 },
  err:      { color: colors.error, marginTop: 12, fontSize: 12 },
  bannerWarn: { backgroundColor: '#3a2e14', borderColor: colors.warning, borderWidth: 1, borderRadius: 6, padding: 10, marginTop: 8 },
  bannerText: { color: colors.warning, fontSize: 12 }
})
