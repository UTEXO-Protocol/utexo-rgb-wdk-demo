/**
 * Canary 2 screen — runs the rgb-lightning-node-bare smoke test inside a
 * react-native-bare-kit Worklet, completely independent of the wdk worklet.
 *
 * The bundle was produced by `bare-pack --linked` so native addon
 * resolution at runtime goes through bare-link's xcframework registry
 * (i.e. the xcframework wrapping `@utexo/rgb-lightning-node-bare` that
 * `node_modules/react-native-bare-kit/ios/link.mjs` writes to
 * `node_modules/react-native-bare-kit/ios/addons/`).
 */

import React from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Worklet } from 'react-native-bare-kit'
import b4a from 'b4a'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — generated bare-pack bundle, no type declarations
import canaryBundle from '../canary-worklet/canary.linked.bundle.js'

export function CanaryScreen () {
  const [lines, setLines] = React.useState<string[]>([])
  const [running, setRunning] = React.useState(false)
  const workletRef = React.useRef<Worklet | null>(null)

  const append = React.useCallback((line: string) => {
    setLines(prev => [...prev, line])
  }, [])

  const start = React.useCallback(() => {
    if (running) return
    setLines([])
    setRunning(true)

    const w = new Worklet()
    workletRef.current = w
    w.start('/canary.bundle', canaryBundle)

    const { IPC } = w
    IPC.on('data', (data: any) => {
      const txt = b4a.toString(data)
      txt.split('\n').filter(Boolean).forEach((line: string) => append(line))
      if (txt.includes('PASSED') || txt.includes('[fail]')) {
        setRunning(false)
      }
    })
    IPC.on('error', (err: Error) => {
      append(`[ipc-error] ${err.message}`)
      setRunning(false)
    })

    // Tell the worklet to start the smoke test.
    setTimeout(() => {
      try {
        IPC.write(b4a.from('run'))
      } catch (e: any) {
        append(`[write-error] ${e?.message ?? e}`)
      }
    }, 200)
  }, [append, running])

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Canary 2 — RLN bare worklet (iOS)</Text>
      <TouchableOpacity
        style={[styles.button, running && styles.buttonDisabled]}
        disabled={running}
        onPress={start}
      >
        <Text style={styles.buttonText}>{running ? 'Running…' : 'Run Canary'}</Text>
      </TouchableOpacity>
      <ScrollView style={styles.log} contentContainerStyle={styles.logContent}>
        {lines.length === 0
          ? <Text style={styles.dim}>Press Run Canary.</Text>
          : lines.map((l, i) => (
              <Text key={i} style={lineStyle(l)}>{l}</Text>
            ))}
      </ScrollView>
    </View>
  )
}

function lineStyle (l: string) {
  if (l.startsWith('[pass]') || l.includes('PASSED')) return styles.pass
  if (l.startsWith('[fail]')) return styles.fail
  if (l.startsWith('[info]')) return styles.info
  return styles.dim
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, gap: 12, backgroundColor: '#121212' },
  title: { color: '#fff', fontSize: 18, fontWeight: '600' },
  button: {
    backgroundColor: '#FF6501',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center'
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600' },
  log: { flex: 1, backgroundColor: '#1c1c1c', borderRadius: 8 },
  logContent: { padding: 12, gap: 4 },
  pass: { color: '#7CFF7C', fontFamily: 'Menlo' },
  fail: { color: '#FF6B6B', fontFamily: 'Menlo' },
  info: { color: '#fff', fontFamily: 'Menlo' },
  dim: { color: '#888', fontFamily: 'Menlo' }
})
