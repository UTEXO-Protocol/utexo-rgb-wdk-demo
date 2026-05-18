// SignTab — sign, verify, onion, and the IWalletAccount generic surface
// (transfer / quote / getKeyPair / getTransactionReceipt / toReadOnlyAccount).

import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import type { LnExt } from '../ext/LnExt'
import type { MethodSpec } from '../state/types'
import { MethodCard } from '../components/MethodCard'
import { colors } from '../components/colors'

const SPECS: MethodSpec[] = [
  {
    id: 'sign.signMessage',
    title: 'Sign message (LN zbase32)',
    description: 'VLS signs in-process. Returns { signed_message } — a zbase32-encoded recoverable ECDSA signature.',
    extMethod: 'sign',
    category: 'sign',
    fields: [{ name: 'message', type: 'string', required: true, multiline: true, label: 'message' }],
    buildArgs: (v) => [String(v.message ?? '')]
  },
  {
    id: 'sign.verify',
    title: 'Verify signature (⚠ upstream gap)',
    description: 'IWalletAccount.verify — currently throws. Needs upstream c-ffi to expose lightning::util::message_signing::verify.',
    extMethod: 'verify',
    category: 'sign',
    fields: [
      { name: 'message', type: 'string', required: true, multiline: true, label: 'message' },
      { name: 'signature', type: 'string', required: true, label: 'signature' }
    ],
    buildArgs: (v) => [String(v.message ?? ''), String(v.signature ?? '')],
    note: 'documented gap — expected to throw until rln_verify_message is added upstream'
  },
  {
    id: 'sign.sendOnionMessage',
    title: 'Send onion message',
    description: 'BOLT12 onion message via the LN. tlv_type ∈ [64..253], data is a hex blob.',
    extMethod: 'sendOnionMessage',
    category: 'sign',
    fields: [
      { name: 'node_ids', type: 'json', default: '[]', required: true, label: 'node_ids (JSON array of hex pubkeys)' },
      { name: 'tlv_type', type: 'number', default: 64, required: true, label: 'tlv_type' },
      { name: 'data', type: 'string', required: true, label: 'data (hex)' }
    ]
  },
  {
    id: 'generic.transfer',
    title: 'Generic transfer (router)',
    description: 'Routes by recipient form: BOLT11 → sendPayment, pubkey → keysend, btc-address → sendBtc, rgb invoice → sendRgb.',
    extMethod: 'transfer',
    category: 'generic',
    fields: [
      { name: 'recipient', type: 'string', required: true, label: 'recipient' },
      { name: 'amount', type: 'number', required: true, label: 'amount (msat for LN, sat for on-chain)' },
      { name: 'token', type: 'string', label: 'token (RGB asset_id; empty for vanilla)' },
      { name: 'feeRate', type: 'number', label: 'feeRate (on-chain only)' }
    ]
  },
  {
    id: 'generic.quoteTransfer',
    title: 'Quote transfer (approx)',
    description: 'Approximation; per Renat — RLN does not expose a probe path. LN: 50 bps of amount. On-chain: rate × ~141 vbytes.',
    extMethod: 'quoteTransfer',
    category: 'generic',
    fields: [
      { name: 'recipient', type: 'string', required: true, label: 'recipient' },
      { name: 'amount', type: 'number', required: true, label: 'amount' },
      { name: 'token', type: 'string', label: 'token' }
    ]
  },
  {
    id: 'generic.quoteSendTransaction',
    title: 'Quote send transaction',
    description: 'Approximate on-chain fee: estimateFee(6) × ~141 vbytes.',
    extMethod: 'quoteSendTransaction',
    category: 'generic',
    fields: [
      { name: 'to', type: 'string', required: true, label: 'to (recipient address)' },
      { name: 'value', type: 'number', required: true, label: 'value (sats)' }
    ]
  },
  {
    id: 'generic.getKeyPair',
    title: 'Get key pair',
    description: 'Returns { publicKey: <node_id bytes>, privateKey: null }. Watch-only — VLS owns the privkey.',
    extMethod: 'getKeyPair',
    category: 'generic',
    fields: [],
    buildArgs: () => []
  },
  {
    id: 'generic.getTransactionReceipt',
    title: 'Get transaction receipt',
    description: 'Filters listTransactions then listPayments by hash. Returns null if not found.',
    extMethod: 'getTransactionReceipt',
    category: 'generic',
    fields: [{ name: 'hash', type: 'string', required: true, label: 'tx hash or payment hash' }],
    buildArgs: (v) => [String(v.hash ?? '')]
  },
  {
    id: 'generic.toReadOnlyAccount',
    title: 'To read-only account',
    description: 'Returns a façade exposing only read methods. Useful for diagnostics.',
    extMethod: 'toReadOnlyAccount',
    category: 'generic',
    fields: [],
    buildArgs: () => []
  },
  {
    id: 'generic.signTransaction',
    title: 'Sign transaction (⚠ upstream gap)',
    description: 'Documented stub — RLN does not expose direct PSBT signing. Use sendTransaction for on-chain spends.',
    extMethod: 'signTransaction',
    category: 'generic',
    fields: [{ name: 'tx', type: 'json', default: '{}', label: 'tx' }],
    note: 'documented gap — VLS policy filter rejects externally-built PSBTs by design'
  }
]

export function SignTab ({ ext }: { ext: LnExt | null }): React.ReactElement {
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <View>
        {SPECS.map((s) => <MethodCard key={s.id} ext={ext} spec={s} />)}
      </View>
    </ScrollView>
  )
}

export const SIGN_TAB_SPECS = SPECS

const styles = StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: colors.background },
  content: { padding: 12, paddingBottom: 32 }
})
