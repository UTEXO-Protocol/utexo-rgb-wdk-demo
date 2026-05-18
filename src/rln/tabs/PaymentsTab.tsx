// PaymentsTab — BOLT11 + keysend payments, list/get.

import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import type { LnExt } from '../ext/LnExt'
import type { MethodSpec } from '../state/types'
import { MethodCard } from '../components/MethodCard'
import { colors } from '../components/colors'

const SPECS: MethodSpec[] = [
  {
    id: 'payments.sendPayment',
    title: 'Send payment (BOLT11)',
    description: 'Pay a BOLT11 invoice. amt_msat overrides the invoice amount (only for amount-less invoices).',
    extMethod: 'sendPayment',
    category: 'payments',
    fields: [
      { name: 'invoice', type: 'string', required: true, multiline: true, label: 'invoice' },
      { name: 'amt_msat', type: 'number', label: 'amt_msat (override; leave empty for invoice amount)' },
      { name: 'asset_id', type: 'string', label: 'asset_id (for RGB-LN)' }
    ]
  },
  {
    id: 'payments.keysend',
    title: 'Keysend (spontaneous payment)',
    description: 'Send to a destination pubkey without an invoice. For RGB keysend, fill asset_id + asset_amount.',
    extMethod: 'keysend',
    category: 'payments',
    fields: [
      { name: 'dest_pubkey', type: 'string', required: true, label: 'dest_pubkey (hex)' },
      { name: 'amt_msat', type: 'number', required: true, default: 5000000, label: 'amt_msat' },
      { name: 'asset_id', type: 'string', label: 'asset_id (optional)' },
      { name: 'asset_amount', type: 'number', label: 'asset_amount (with asset_id)' }
    ]
  },
  {
    id: 'payments.listPayments',
    title: 'List payments',
    description: 'All sent + received LN payments.',
    extMethod: 'listPayments',
    category: 'payments',
    fields: [],
    buildArgs: () => []
  },
  {
    id: 'payments.getPayment',
    title: 'Get payment by hash',
    description: 'Lookup a specific payment by hash + type. paymentType ∈ {Outbound, InboundAutoClaim, InboundHodl}.',
    extMethod: 'getPayment',
    category: 'payments',
    fields: [
      { name: 'payment_hash', type: 'string', required: true, label: 'payment_hash (hex)' },
      // PaymentType enum strings match SDK uniffi exactly. Old
      // lowercase values (`sent`/`received`/`swap`) are rejected by
      // the SDK with `unknown variant ...`.
      { name: 'payment_type', type: 'select', options: ['Outbound', 'InboundAutoClaim', 'InboundHodl'], default: 'Outbound', required: true, label: 'payment_type' }
    ],
    buildArgs: (v) => [String(v.payment_hash ?? ''), String(v.payment_type ?? 'Outbound')]
  }
]

export function PaymentsTab ({ ext }: { ext: LnExt | null }): React.ReactElement {
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <View>
        {SPECS.map((s) => <MethodCard key={s.id} ext={ext} spec={s} />)}
      </View>
    </ScrollView>
  )
}

export const PAYMENTS_TAB_SPECS = SPECS

const styles = StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: colors.background },
  content: { padding: 12, paddingBottom: 32 }
})
