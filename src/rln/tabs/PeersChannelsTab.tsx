// PeersChannelsTab — peers + channels (open / close / list / resolve temp id).

import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import type { LnExt } from '../ext/LnExt'
import type { MethodSpec } from '../state/types'
import { MethodCard } from '../components/MethodCard'
import { colors } from '../components/colors'

const SPECS: MethodSpec[] = [
  {
    id: 'peers.connectPeer',
    title: 'Connect peer',
    description: 'Format: "<pubkey>@<host>:<port>". Idempotent — already-known peers return ok.',
    extMethod: 'connectPeer',
    category: 'peers',
    fields: [{ name: 'peer', type: 'string', required: true, label: 'pubkey@host:port' }],
    buildArgs: (v) => [String(v.peer ?? '')]
  },
  {
    id: 'peers.disconnectPeer',
    title: 'Disconnect peer',
    extMethod: 'disconnectPeer',
    category: 'peers',
    fields: [{ name: 'peer_pubkey', type: 'string', required: true, label: 'peer_pubkey (hex)' }]
  },
  {
    id: 'peers.listPeers',
    title: 'List peers',
    extMethod: 'listPeers',
    category: 'peers',
    fields: [],
    buildArgs: () => []
  },
  {
    id: 'channels.openChannel',
    title: 'Open channel',
    description: 'BTC-only: leave asset_id and asset_amount empty. RGB asset channel: fill both.',
    extMethod: 'openChannel',
    category: 'channels',
    fields: [
      { name: 'peer_pubkey_and_opt_addr', type: 'string', required: true, label: 'peer (pubkey@host:port)' },
      { name: 'capacity_sat', type: 'number', default: 1000000, required: true, label: 'capacity_sat' },
      { name: 'push_msat', type: 'number', default: 0, label: 'push_msat' },
      { name: 'asset_id', type: 'string', label: 'asset_id (empty = BTC-only)' },
      { name: 'asset_amount', type: 'number', label: 'asset_amount (empty = BTC-only)' },
      { name: 'public', type: 'boolean', default: true, label: 'public' },
      { name: 'with_anchors', type: 'boolean', default: true, label: 'with_anchors' },
      { name: 'fee_base_msat', type: 'number', label: 'fee_base_msat (override)' },
      { name: 'fee_proportional_millionths', type: 'number', label: 'fee_proportional_millionths' }
    ]
  },
  {
    id: 'channels.closeChannel',
    title: 'Close channel',
    description: 'force=false: coop close (asset channels hit iter-2 hang). force=true: force close, requires CSV wait + mining.',
    extMethod: 'closeChannel',
    category: 'channels',
    fields: [
      { name: 'channel_id', type: 'string', required: true, label: 'channel_id (hex)' },
      { name: 'peer_pubkey', type: 'string', required: true, label: 'peer_pubkey' },
      { name: 'force', type: 'boolean', default: false, required: true, label: 'force' }
    ]
  },
  {
    id: 'channels.listChannels',
    title: 'List channels',
    description: 'C-FFI returns a bare array; HTTP wraps in { channels: [...] }. The WDK surface preserves the array form.',
    extMethod: 'listChannels',
    category: 'channels',
    fields: [],
    buildArgs: () => []
  },
  {
    id: 'channels.getChannelId',
    title: 'Resolve temporary channel id',
    description: 'After openChannel, the returned temporary_channel_id becomes the permanent channel_id once the funding tx confirms.',
    extMethod: 'getChannelId',
    category: 'channels',
    fields: [{ name: 'tempId', type: 'string', required: true, label: 'temporary_channel_id_hex' }],
    buildArgs: (v) => [String(v.tempId ?? '')]
  }
]

export function PeersChannelsTab ({ ext }: { ext: LnExt | null }): React.ReactElement {
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <View>
        {SPECS.map((s) => <MethodCard key={s.id} ext={ext} spec={s} />)}
      </View>
    </ScrollView>
  )
}

export const PEERS_CHANNELS_TAB_SPECS = SPECS

const styles = StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: colors.background },
  content: { padding: 12, paddingBottom: 32 }
})
