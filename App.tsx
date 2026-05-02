// RGB × WDK — Minimal demo app
//
// Demonstrates the agnostic worklet architecture:
//   1. `wdk.config.js` declares which wallet packages compile into the bundle
//   2. `wdk-worklet-bundler generate` emits `.wdk-bundle/wdk-worklet.bundle.js`
//   3. `<WdkAppProvider>` starts the worklet and wires the hook layer
//   4. `useAccount({ network: 'rgb', accountIndex: 0 })` gives standard methods
//      (sign/verify/send/estimateFee) plus an `.extension()` proxy for any
//      RGB-specific method on `WalletAccountRgb`.
import 'react-native-get-random-values'
import React from 'react'
import { StatusBar, StyleSheet, View, ActivityIndicator, Text } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { Paths } from 'expo-file-system'
import { WdkAppProvider, useWdkApp } from '@tetherto/wdk-react-native-core'

// The bundle is a `.js` file that does `module.exports = "<~6 MB string>"`.
// Metro is configured to watch `.wdk-bundle/` in metro.config.js.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — generated artifact, no type declarations
import bundle from './.wdk-bundle/wdk-worklet.bundle.js'

import { WalletGate } from './src/WalletGate'
import { CanaryScreen } from './src/CanaryScreen'

// Set EXPO_PUBLIC_RUN_CANARY=1 to bypass wdk and render the bare-only
// canary screen for Canary 2 (rgb-lightning-node-bare smoke test).
const RUN_CANARY = process.env.EXPO_PUBLIC_RUN_CANARY === '1'

const RGB_NETWORK = (process.env.EXPO_PUBLIC_RGB_NETWORK ?? 'regtest') as
  | 'mainnet' | 'testnet' | 'regtest'
const RGB_INDEXER_URL = process.env.EXPO_PUBLIC_RGB_INDEXER_URL ?? 'tcp://localhost:50001'
const RGB_TRANSPORT_ENDPOINT = process.env.EXPO_PUBLIC_RGB_TRANSPORT_ENDPOINT ?? 'rpc://localhost:3000/json-rpc'

const BTC_NETWORK = process.env.EXPO_PUBLIC_BTC_NETWORK ?? 'regtest'
const BTC_INDEXER_URL = process.env.EXPO_PUBLIC_BTC_INDEXER_URL ?? 'tcp://localhost:50001'

// rgb-lib stores its SQLite state (UTXO allocations, asset metadata,
// in-flight transfers) under `dataDir`. Losing this directory loses all
// RGB asset balances even though the seed still derives the right
// addresses — so we must point it at a persistent, app-private path.
//
// `Paths.document` resolves to:
//   iOS      → file:///.../Documents/
//   Android  → file:///data/user/0/<pkg>/files/
// Both survive app relaunches, reboots, and Android auto-backup rules
// apply as usual. The `file://` prefix is stripped because rgb-lib
// expects a plain OS path.
const RGB_DATA_DIR = Paths.document.uri.replace(/^file:\/\//, '') + 'rgb-wallet'

// The generic is intentionally loose — each network has its own config shape.
const wdkConfigs: import('@tetherto/wdk-react-native-core').WdkConfigs<Record<string, unknown>> = {
  networks: {
    rgb: {
      blockchain: 'rgb',
      config: {
        network: RGB_NETWORK,
        indexerUrl: RGB_INDEXER_URL,
        transportEndpoint: RGB_TRANSPORT_ENDPOINT,
        dataDir: RGB_DATA_DIR
      }
    },
    bitcoin: {
      blockchain: 'bitcoin',
      config: {
        network: BTC_NETWORK,
        client: { type: 'electrum', clientConfig: { url: BTC_INDEXER_URL } }
      }
    }
  }
}

function AppShell () {
  const { state, retry } = useWdkApp()

  switch (state.status) {
    case 'INITIALIZING':
    case 'REINITIALIZING':
      return (
        <CenterBox>
          <ActivityIndicator color="#FF6501" />
          <Text style={{ color: '#fff' }}>Starting WDK worklet…</Text>
        </CenterBox>
      )
    case 'ERROR':
      return (
        <CenterBox>
          <Text style={styles.err}>WDK error: {state.error.message}</Text>
          <Text onPress={retry} style={styles.link}>Tap to retry</Text>
        </CenterBox>
      )
    default:
      return <WalletGate state={state} />
  }
}

function CenterBox ({ children }: { children: React.ReactNode }) {
  return <View style={styles.center}>{children}</View>
}

export default function App () {
  if (RUN_CANARY) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
          <StatusBar barStyle="light-content" />
          <CanaryScreen />
        </SafeAreaView>
      </SafeAreaProvider>
    )
  }
  return (
    <SafeAreaProvider>
      <WdkAppProvider bundle={{ bundle }} wdkConfigs={wdkConfigs}>
        <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
          <StatusBar barStyle="light-content" />
          <AppShell />
        </SafeAreaView>
      </WdkAppProvider>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#121212' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, gap: 12, backgroundColor: '#121212' },
  err:    { color: '#FF6B6B' },
  link:   { color: '#FF6501', textDecorationLine: 'underline' }
})
