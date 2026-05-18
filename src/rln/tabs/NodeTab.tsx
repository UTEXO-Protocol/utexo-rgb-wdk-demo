// NodeTab — node info, network info, sync, signer bootstrap, indexer/proxy diagnostics.

import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import type { LnExt } from '../ext/LnExt'
import type { MethodSpec } from '../state/types'
import { MethodCard } from '../components/MethodCard'
import { colors } from '../components/colors'

const SPECS: MethodSpec[] = [
  {
    id: 'node.nodeInfo',
    title: 'Node info',
    description: 'Returns pubkey, num_peers, num_channels, num_usable_channels, block_height.',
    extMethod: 'getNodeInfo',
    category: 'node',
    fields: [],
    buildArgs: () => []
  },
  {
    id: 'node.networkInfo',
    title: 'Network info',
    description: 'Returns network name and current block height.',
    extMethod: 'getNetworkInfo',
    category: 'node',
    fields: [],
    buildArgs: () => []
  },
  {
    id: 'node.sync',
    title: 'Sync',
    description: 'Force a full on-chain wallet sync via electrum.',
    extMethod: 'sync',
    category: 'node',
    fields: [],
    buildArgs: () => []
  },
  {
    id: 'node.getBootstrap',
    title: 'Signer bootstrap',
    description: 'Returns node_id, account_xpub_vanilla, account_xpub_colored, master_fingerprint from the in-process VLS signer.',
    extMethod: 'getBootstrap',
    category: 'node',
    fields: [],
    buildArgs: () => []
  },
  {
    id: 'node.checkIndexerUrl',
    title: 'Check indexer URL',
    description: 'Validate that an electrum-style indexer URL is reachable and well-formed.',
    extMethod: 'checkIndexerUrl',
    category: 'node',
    fields: [{ name: 'url', type: 'string', required: true, label: 'indexer url', default: 'tcp://127.0.0.1:50001' }],
    buildArgs: (v) => [String(v.url ?? '')]
  },
  {
    id: 'node.checkProxyEndpoint',
    title: 'Check proxy endpoint',
    description: 'Validate that an rgb-proxy JSON-RPC endpoint is reachable.',
    extMethod: 'checkProxyEndpoint',
    category: 'node',
    fields: [{ name: 'endpoint', type: 'string', required: true, label: 'proxy endpoint', default: 'rpc://127.0.0.1:3001/json-rpc' }],
    buildArgs: (v) => [String(v.endpoint ?? '')]
  },
  {
    id: 'node.shutdown',
    title: 'Shutdown (⚠ idempotent — won\'t re-unlock without app restart)',
    description: 'Stops the LDK node + tokio runtime. Subsequent calls after shutdown will fail until app relaunch.',
    extMethod: 'shutdown',
    category: 'node',
    fields: [],
    buildArgs: () => []
  }
]

export function NodeTab ({ ext }: { ext: LnExt | null }): React.ReactElement {
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <View>
        {SPECS.map((s) => <MethodCard key={s.id} ext={ext} spec={s} />)}
      </View>
    </ScrollView>
  )
}

export const NODE_TAB_SPECS = SPECS

const styles = StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: colors.background },
  content: { padding: 12, paddingBottom: 32 }
})
