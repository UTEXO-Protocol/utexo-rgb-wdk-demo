// BtcTab — on-chain BTC ops: address, balance, transactions, UTXOs, send, fees.

import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import type { LnExt } from '../ext/LnExt'
import type { MethodSpec } from '../state/types'
import { MethodCard } from '../components/MethodCard'
import { colors } from '../components/colors'

const SPECS: MethodSpec[] = [
  {
    id: 'btc.getAddress',
    title: 'Get receive address',
    description: 'Fresh on-chain bech32 address. Pre-unlock returns the PENDING sentinel.',
    extMethod: 'getAddress',
    category: 'btc',
    fields: [],
    buildArgs: () => []
  },
  {
    id: 'btc.getBalance',
    title: 'Spendable balance (sats)',
    description: 'Numeric satoshi string — the IWalletAccount contract.',
    extMethod: 'getBalance',
    category: 'btc',
    fields: [{ name: 'skipSync', type: 'boolean', default: false, label: 'skipSync', hint: 'true = use cached value, false = re-scan electrum' }],
    buildArgs: (v) => [!!v.skipSync]
  },
  {
    id: 'btc.getBalanceDetails',
    title: 'Balance breakdown',
    description: 'Full { vanilla: { settled, future, spendable }, colored: { ... } } from RLN.',
    extMethod: 'getBalanceDetails',
    category: 'btc',
    fields: [{ name: 'skipSync', type: 'boolean', default: false, label: 'skipSync' }],
    buildArgs: (v) => [!!v.skipSync]
  },
  {
    id: 'btc.listUnspents',
    title: 'List UTXOs',
    description: 'All UTXOs the wallet knows about (colored + uncolored).',
    extMethod: 'listUnspents',
    category: 'btc',
    fields: [{ name: 'skipSync', type: 'boolean', default: false, label: 'skipSync' }],
    buildArgs: (v) => [!!v.skipSync]
  },
  {
    id: 'btc.listTransactions',
    title: 'List on-chain transactions',
    description: 'Wallet-scoped on-chain tx history. Different from listPayments (LN).',
    extMethod: 'getTransactions',
    category: 'btc',
    fields: [{ name: 'skipSync', type: 'boolean', default: false, label: 'skipSync' }],
    buildArgs: (v) => [!!v.skipSync]
  },
  {
    id: 'btc.estimateFee',
    title: 'Estimate fee rate',
    description: 'Returns sat/vB target for a given confirmation block count (1..=65535).',
    extMethod: 'estimateFee',
    category: 'btc',
    fields: [{ name: 'blocks', type: 'number', default: 6, required: true, label: 'target blocks' }],
    buildArgs: (v) => [Number(v.blocks ?? 6)]
  },
  {
    id: 'btc.sendTransaction',
    title: 'Send BTC (on-chain)',
    description: 'VLS signs in-process. External-signer mode — RLN never sees the seed.',
    extMethod: 'sendTransaction',
    category: 'btc',
    fields: [
      { name: 'address', type: 'string', required: true, label: 'recipient address' },
      { name: 'amount', type: 'number', required: true, label: 'amount (sats)' },
      { name: 'fee_rate', type: 'number', default: 5, required: true, label: 'fee rate (sat/vB)' },
      { name: 'skip_sync', type: 'boolean', default: false, label: 'skip_sync' }
    ]
  },
  {
    id: 'btc.createUtxos',
    title: 'Create colorable UTXOs',
    description: 'Pre-allocate UTXOs for RGB issuance / asset-channel funding. Required before opening RGB-LN channels.',
    extMethod: 'createUtxos',
    category: 'btc',
    fields: [
      { name: 'up_to', type: 'boolean', default: true, label: 'up_to' },
      { name: 'num', type: 'number', default: 5, label: 'num UTXOs' },
      { name: 'size', type: 'number', default: 32000, label: 'size (sats per UTXO)' },
      { name: 'fee_rate', type: 'number', default: 5, required: true, label: 'fee rate (sat/vB)' },
      { name: 'skip_sync', type: 'boolean', default: false, label: 'skip_sync' }
    ]
  }
]

export function BtcTab ({ ext }: { ext: LnExt | null }): React.ReactElement {
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <View>
        {SPECS.map((s) => <MethodCard key={s.id} ext={ext} spec={s} />)}
      </View>
    </ScrollView>
  )
}

export const BTC_TAB_SPECS = SPECS

const styles = StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: colors.background },
  content: { padding: 12, paddingBottom: 32 }
})
