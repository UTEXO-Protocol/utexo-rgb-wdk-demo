// HodlTab — HODL invoice settle/cancel. The creation-side lives in
// InvoicesTab with `hodl_invoice=true`.

import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import type { LnExt } from '../ext/LnExt'
import type { MethodSpec } from '../state/types'
import { MethodCard } from '../components/MethodCard'
import { colors } from '../components/colors'

const SPECS: MethodSpec[] = [
  {
    id: 'hodl.cancelHodlInvoice',
    title: 'Cancel HODL invoice',
    description: 'Cancel a held HTLC, releasing the funds back to the payer.',
    extMethod: 'cancelHodlInvoice',
    category: 'hodl',
    fields: [{ name: 'payment_hash', type: 'string', required: true, label: 'payment_hash (hex)' }]
  },
  {
    id: 'hodl.claimHodlInvoice',
    title: 'Claim HODL invoice',
    description: 'Settle a held HTLC by revealing the preimage. The payment_image is the 32-byte preimage in hex.',
    extMethod: 'claimHodlInvoice',
    category: 'hodl',
    fields: [{ name: 'payment_image', type: 'string', required: true, label: 'payment_image (hex preimage)' }]
  }
]

export function HodlTab ({ ext }: { ext: LnExt | null }): React.ReactElement {
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <View>
        {SPECS.map((s) => <MethodCard key={s.id} ext={ext} spec={s} />)}
      </View>
    </ScrollView>
  )
}

export const HODL_TAB_SPECS = SPECS

const styles = StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: colors.background },
  content: { padding: 12, paddingBottom: 32 }
})
