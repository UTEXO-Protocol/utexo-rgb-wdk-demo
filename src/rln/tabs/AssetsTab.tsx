// AssetsTab — RGB asset issuance (NIA / UDA / CFA / IFA), list, balance, metadata, media.

import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import type { LnExt } from '../ext/LnExt'
import type { MethodSpec } from '../state/types'
import { MethodCard } from '../components/MethodCard'
import { colors } from '../components/colors'

const SPECS: MethodSpec[] = [
  {
    id: 'assets.issueNia',
    title: 'Issue NIA asset',
    description: 'Non-inflatable fungible asset. amounts is the list of issuance allocations per UTXO.',
    extMethod: 'issueAssetNia',
    category: 'assets',
    fields: [
      { name: 'ticker', type: 'string', default: 'USDT', required: true, label: 'ticker' },
      { name: 'name', type: 'string', default: 'Tether USD', required: true, label: 'name' },
      { name: 'precision', type: 'number', default: 2, required: true, label: 'precision (decimals)' },
      { name: 'amounts', type: 'json', default: '[1000000]', required: true, label: 'amounts (JSON array)' }
    ]
  },
  {
    id: 'assets.issueUda',
    title: 'Issue UDA asset',
    description: 'Unique digital asset (NFT-ish). Supply is implicitly 1.',
    extMethod: 'issueAssetUda',
    category: 'assets',
    fields: [
      { name: 'ticker', type: 'string', default: 'UDA1', required: true, label: 'ticker' },
      { name: 'name', type: 'string', default: 'Unique Asset 1', required: true, label: 'name' },
      { name: 'details', type: 'string', label: 'details' },
      { name: 'media_file_path', type: 'string', label: 'media_file_path (optional)' }
    ]
  },
  {
    id: 'assets.issueCfa',
    title: 'Issue CFA asset',
    description: 'Collectible fungible asset (image + supply).',
    extMethod: 'issueAssetCfa',
    category: 'assets',
    fields: [
      { name: 'name', type: 'string', default: 'CFA Collectible', required: true, label: 'name' },
      { name: 'details', type: 'string', label: 'details' },
      { name: 'precision', type: 'number', default: 0, required: true, label: 'precision' },
      { name: 'amounts', type: 'json', default: '[100]', required: true, label: 'amounts (JSON array)' },
      { name: 'media_file_path', type: 'string', label: 'media_file_path' }
    ]
  },
  {
    id: 'assets.issueIfa',
    title: 'Issue IFA asset',
    description: 'Inflatable fungible asset. inflation_amounts cap future inflation per UTXO.',
    extMethod: 'issueAssetIfa',
    category: 'assets',
    fields: [
      { name: 'ticker', type: 'string', default: 'IFA1', required: true, label: 'ticker' },
      { name: 'name', type: 'string', default: 'Inflatable Asset 1', required: true, label: 'name' },
      { name: 'precision', type: 'number', default: 2, required: true, label: 'precision' },
      { name: 'amounts', type: 'json', default: '[100000]', required: true, label: 'amounts (JSON array)' },
      { name: 'inflation_amounts', type: 'json', default: '[1000000]', required: true, label: 'inflation_amounts (JSON array)' }
    ]
  },
  {
    id: 'assets.listAssets',
    title: 'List assets',
    description: 'Filter by schema(s) — JSON array like ["Nia","Cfa","Uda","Ifa"]. Empty array returns all.',
    extMethod: 'listAssets',
    category: 'assets',
    fields: [{ name: 'filterAssetSchemas', type: 'json', default: '[]', label: 'filterAssetSchemas (JSON array)' }],
    buildArgs: (v) => {
      const raw = v.filterAssetSchemas
      if (raw === '' || raw === null || raw === undefined) return [undefined]
      if (typeof raw === 'string') {
        try { return [JSON.parse(raw)] } catch { return [[raw]] }
      }
      return [raw]
    }
  },
  {
    id: 'assets.getAssetBalance',
    title: 'Get asset balance',
    description: 'Per-asset balance: { settled, future, spendable, offchain_outbound, offchain_inbound }.',
    extMethod: 'getAssetBalance',
    category: 'assets',
    fields: [{ name: 'asset_id', type: 'string', required: true, label: 'asset_id (rgb:...)' }],
    buildArgs: (v) => [String(v.asset_id ?? '')]
  },
  {
    id: 'assets.getAssetMetadata',
    title: 'Get asset metadata',
    description: 'Schema, supply, ticker, name, precision, issuance info.',
    extMethod: 'getAssetMetadata',
    category: 'assets',
    fields: [{ name: 'asset_id', type: 'string', required: true, label: 'asset_id' }],
    buildArgs: (v) => [String(v.asset_id ?? '')]
  },
  {
    id: 'assets.getAssetMedia',
    title: 'Get asset media',
    description: 'Fetch the media (image, etc.) for an asset by digest.',
    extMethod: 'getAssetMedia',
    category: 'assets',
    fields: [{ name: 'digest', type: 'string', required: true, label: 'media digest (hex)' }],
    buildArgs: (v) => [String(v.digest ?? '')]
  },
  {
    id: 'assets.postAssetMedia',
    title: 'Post asset media',
    description: 'Upload an asset media file. file_path is the absolute path on the device.',
    extMethod: 'postAssetMedia',
    category: 'assets',
    fields: [{ name: 'file_path', type: 'string', required: true, label: 'file_path (absolute)' }]
  }
]

export function AssetsTab ({ ext }: { ext: LnExt | null }): React.ReactElement {
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <View>
        {SPECS.map((s) => <MethodCard key={s.id} ext={ext} spec={s} />)}
      </View>
    </ScrollView>
  )
}

export const ASSETS_TAB_SPECS = SPECS

const styles = StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: colors.background },
  content: { padding: 12, paddingBottom: 32 }
})
