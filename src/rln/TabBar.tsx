// TabBar — horizontal scrollable tab strip. Stateful in the shell —
// `value` + `onChange` are owned upstream so deep links / autonomous
// runs can drive the active tab.

import React from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native'
import { colors } from './components/colors'

export interface TabSpec {
  id: string
  label: string
  /** Optional badge — usually the method count for that tab. */
  badge?: number | string
}

interface Props {
  tabs: TabSpec[]
  value: string
  onChange: (id: string) => void
}

export function TabBar ({ tabs, value, onChange }: Props): React.ReactElement {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.bar}
      contentContainerStyle={styles.content}
    >
      {tabs.map((t) => {
        const active = t.id === value
        return (
          <TouchableOpacity
            key={t.id}
            onPress={() => onChange(t.id)}
            style={[styles.tab, active && styles.tabActive]}
            activeOpacity={0.7}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{t.label}</Text>
            {t.badge !== undefined && (
              <Text style={[styles.badge, active && styles.badgeActive]}>{t.badge}</Text>
            )}
          </TouchableOpacity>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  bar:      { backgroundColor: colors.card, maxHeight: 44, borderBottomWidth: 1, borderBottomColor: colors.border },
  content:  { paddingHorizontal: 8, alignItems: 'center', gap: 4 },
  tab:      { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabActive:{ backgroundColor: colors.cardElevated },
  label:    { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  labelActive: { color: colors.primary, fontWeight: '700' },
  badge:    { color: colors.textTertiary, fontSize: 10, fontFamily: 'Menlo' },
  badgeActive: { color: colors.primary }
})
