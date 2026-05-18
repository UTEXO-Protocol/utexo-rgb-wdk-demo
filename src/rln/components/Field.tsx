// Field — schema-driven input element for MethodCard forms.
//
// Single component handles `string`, `number`, `boolean`, `json`, and
// `select` field types based on the FieldSpec. Renders the label, the
// input, and a hint. State is local — parent passes value + setter.

import React from 'react'
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import type { FieldSpec } from '../state/types'
import { colors } from './colors'

interface Props {
  spec: FieldSpec
  value: unknown
  onChange: (next: unknown) => void
  disabled?: boolean
}

export function Field ({ spec, value, onChange, disabled }: Props): React.ReactElement {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>
        {spec.label ?? spec.name}
        {spec.required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      {renderInput(spec, value, onChange, !!disabled)}
      {spec.hint ? <Text style={styles.hint}>{spec.hint}</Text> : null}
    </View>
  )
}

function renderInput (spec: FieldSpec, value: unknown, onChange: (v: unknown) => void, disabled: boolean) {
  switch (spec.type) {
    case 'boolean':
      return <BooleanInput value={!!value} onChange={onChange} disabled={disabled} />
    case 'number':
      return (
        <TextInput
          style={[styles.input, disabled && styles.inputDisabled]}
          value={value === undefined || value === null || value === '' ? '' : String(value)}
          onChangeText={(t) => onChange(t === '' ? null : Number(t))}
          keyboardType="numeric"
          editable={!disabled}
          placeholder={spec.default !== undefined ? String(spec.default) : ''}
          placeholderTextColor={colors.textTertiary}
        />
      )
    case 'json':
      return (
        <TextInput
          style={[styles.input, styles.inputMulti, disabled && styles.inputDisabled]}
          value={typeof value === 'string' ? value : (value !== undefined ? JSON.stringify(value, null, 2) : '')}
          onChangeText={onChange}
          multiline
          numberOfLines={5}
          editable={!disabled}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={spec.hint ?? '{ … }'}
          placeholderTextColor={colors.textTertiary}
        />
      )
    case 'select':
      return (
        <View style={styles.selectRow}>
          {(spec.options ?? []).map((opt) => {
            const active = value === opt
            return (
              <TouchableOpacity
                key={opt}
                style={[styles.selectChip, active && styles.selectChipActive, disabled && styles.inputDisabled]}
                onPress={() => onChange(opt)}
                disabled={disabled}
              >
                <Text style={[styles.selectChipText, active && styles.selectChipTextActive]}>{opt}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      )
    case 'string':
    default:
      return (
        <TextInput
          style={[styles.input, spec.multiline && styles.inputMulti, disabled && styles.inputDisabled]}
          value={typeof value === 'string' ? value : (value ?? '').toString()}
          onChangeText={onChange}
          multiline={!!spec.multiline}
          editable={!disabled}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={spec.default !== undefined ? String(spec.default) : ''}
          placeholderTextColor={colors.textTertiary}
        />
      )
  }
}

function BooleanInput ({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled: boolean }) {
  return (
    <View style={styles.boolRow}>
      {([true, false] as const).map((v) => {
        const active = value === v
        return (
          <TouchableOpacity
            key={String(v)}
            style={[styles.selectChip, active && styles.selectChipActive, disabled && styles.inputDisabled]}
            onPress={() => onChange(v)}
            disabled={disabled}
          >
            <Text style={[styles.selectChipText, active && styles.selectChipTextActive]}>{v ? 'true' : 'false'}</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row:        { marginBottom: 10 },
  label:      { color: colors.textSecondary, fontSize: 12, marginBottom: 4, fontWeight: '500' },
  required:   { color: colors.warning },
  input:      { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardElevated, color: colors.text, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, fontFamily: 'Menlo', fontSize: 13 },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
  inputDisabled: { opacity: 0.4 },
  hint:       { color: colors.textTertiary, fontSize: 11, marginTop: 3 },
  boolRow:    { flexDirection: 'row', gap: 8 },
  selectRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  selectChip: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardElevated, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  selectChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  selectChipText: { color: colors.textSecondary, fontSize: 12 },
  selectChipTextActive: { color: '#000', fontWeight: '600' }
})
