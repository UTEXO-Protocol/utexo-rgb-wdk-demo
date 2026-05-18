// InvoicesTab — BOLT11 invoice creation / decode / status.

import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import type { LnExt } from '../ext/LnExt'
import type { MethodSpec } from '../state/types'
import { MethodCard } from '../components/MethodCard'
import { colors } from '../components/colors'

const SPECS: MethodSpec[] = [
  {
    id: 'invoices.createInvoice',
    title: 'Create BOLT11 invoice',
    description: 'Vanilla BTC: leave asset_id/asset_amount empty. RGB-LN: fill both.',
    extMethod: 'createInvoice',
    category: 'invoices',
    fields: [
      { name: 'amt_msat', type: 'number', default: 5000000, label: 'amt_msat (5,000,000 = 5,000 sats)' },
      { name: 'expiry_sec', type: 'number', default: 3600, required: true, label: 'expiry_sec' },
      { name: 'asset_id', type: 'string', label: 'asset_id (empty = BTC)' },
      { name: 'asset_amount', type: 'number', label: 'asset_amount (empty = BTC)' },
      { name: 'hodl_invoice', type: 'boolean', default: false, label: 'hodl_invoice' },
      { name: 'hodl_invoice_payment_hash', type: 'string', label: 'hodl_invoice_payment_hash (if hodl)' }
    ],
    blockedBy: undefined,
    note: 'iter-2 B1: asset-carrying ln_invoice still fails with NativeExternalSigner. Vanilla BTC works.'
  },
  {
    id: 'invoices.decodeInvoice',
    title: 'Decode BOLT11',
    description: 'Parse a BOLT11 string into its components (amount, expiry, payment hash, ...).',
    extMethod: 'decodeInvoice',
    category: 'invoices',
    fields: [{ name: 'invoice', type: 'string', required: true, multiline: true, label: 'invoice string (lnbc/lntb/lnbcrt)' }],
    buildArgs: (v) => [String(v.invoice ?? '')]
  },
  {
    id: 'invoices.invoiceStatus',
    title: 'Invoice status',
    description: 'Status of a BOLT11 invoice the local node previously issued.',
    extMethod: 'getInvoiceStatus',
    category: 'invoices',
    fields: [{ name: 'invoice', type: 'string', required: true, multiline: true, label: 'invoice' }],
    buildArgs: (v) => [String(v.invoice ?? '')]
  }
]

export function InvoicesTab ({ ext }: { ext: LnExt | null }): React.ReactElement {
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <View>
        {SPECS.map((s) => <MethodCard key={s.id} ext={ext} spec={s} />)}
      </View>
    </ScrollView>
  )
}

export const INVOICES_TAB_SPECS = SPECS

const styles = StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: colors.background },
  content: { padding: 12, paddingBottom: 32 }
})
