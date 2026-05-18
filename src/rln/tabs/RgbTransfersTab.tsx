// RgbTransfersTab — RGB invoices, on-chain RGB transfers, refresh/fail/list, inflate.

import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import type { LnExt } from '../ext/LnExt'
import type { MethodSpec } from '../state/types'
import { MethodCard } from '../components/MethodCard'
import { colors } from '../components/colors'

const SPECS: MethodSpec[] = [
  {
    id: 'rgb.createInvoice',
    title: 'Create RGB invoice',
    description: 'Generates a recipient_id + invoice string for receiving an RGB asset on-chain (witness/blind).',
    extMethod: 'createRgbInvoice',
    category: 'rgb',
    fields: [
      { name: 'min_confirmations', type: 'number', default: 1, required: true, label: 'min_confirmations' },
      { name: 'asset_id', type: 'string', label: 'asset_id (optional — any-asset if omitted)' },
      { name: 'amount', type: 'number', label: 'amount' },
      { name: 'duration_seconds', type: 'number', label: 'duration_seconds' }
    ]
  },
  {
    id: 'rgb.decodeInvoice',
    title: 'Decode RGB invoice',
    extMethod: 'decodeRgbInvoice',
    category: 'rgb',
    fields: [{ name: 'invoice', type: 'string', required: true, multiline: true, label: 'rgb:..., utxob:..., or canonical' }],
    buildArgs: (v) => [String(v.invoice ?? '')]
  },
  {
    id: 'rgb.sendAsset',
    title: 'Send RGB asset (on-chain)',
    description: 'Transfer an asset by paying an rgb invoice. fee_rate in sat/vB.',
    extMethod: 'sendRgbAsset',
    category: 'rgb',
    fields: [
      { name: 'recipient_id', type: 'string', required: true, label: 'recipient_id (from RGB invoice)' },
      { name: 'asset_id', type: 'string', label: 'asset_id (optional if encoded in invoice)' },
      { name: 'amount', type: 'number', label: 'amount' },
      { name: 'fee_rate', type: 'number', default: 5, required: true, label: 'fee_rate (sat/vB)' },
      { name: 'min_confirmations', type: 'number', default: 1, label: 'min_confirmations' },
      { name: 'donation', type: 'boolean', default: false, label: 'donation' },
      { name: 'transport_endpoints', type: 'json', label: 'transport_endpoints (JSON array)' },
      { name: 'skip_sync', type: 'boolean', default: false, label: 'skip_sync' }
    ]
  },
  {
    id: 'rgb.refreshTransfers',
    title: 'Refresh transfers',
    description: 'Force an electrum re-scan + rgb-lib reconciliation. Required after broadcast for receiver-side settlement.',
    extMethod: 'refreshTransfers',
    category: 'rgb',
    fields: [
      { name: 'asset_id', type: 'string', label: 'asset_id (optional — all if empty)' },
      { name: 'skip_sync', type: 'boolean', default: false, label: 'skip_sync' }
    ]
  },
  {
    id: 'rgb.listTransfers',
    title: 'List transfers',
    description: 'All transfers; optionally filtered by asset_id.',
    extMethod: 'listTransfers',
    category: 'rgb',
    fields: [{ name: 'asset_id', type: 'string', label: 'asset_id (optional)' }],
    buildArgs: (v) => [v.asset_id ? String(v.asset_id) : undefined]
  },
  {
    id: 'rgb.failTransfers',
    title: 'Fail transfers',
    description: 'Mark pending transfers as failed (frees the allocations).',
    extMethod: 'failTransfers',
    category: 'rgb',
    fields: [
      { name: 'batch_transfer_idx', type: 'number', label: 'batch_transfer_idx (optional)' },
      { name: 'no_asset_only', type: 'boolean', default: false, label: 'no_asset_only' },
      { name: 'skip_sync', type: 'boolean', default: false, label: 'skip_sync' }
    ]
  },
  {
    id: 'rgb.inflate',
    title: 'Inflate IFA asset',
    description: 'Mint additional supply of an IFA asset (Inflatable Fungible Asset only).',
    extMethod: 'inflate',
    category: 'rgb',
    fields: [
      { name: 'asset_id', type: 'string', required: true, label: 'asset_id' },
      { name: 'amount', type: 'number', required: true, label: 'amount' }
    ]
  }
]

export function RgbTransfersTab ({ ext }: { ext: LnExt | null }): React.ReactElement {
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <View>
        {SPECS.map((s) => <MethodCard key={s.id} ext={ext} spec={s} />)}
      </View>
    </ScrollView>
  )
}

export const RGB_TRANSFERS_TAB_SPECS = SPECS

const styles = StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: colors.background },
  content: { padding: 12, paddingBottom: 32 }
})
