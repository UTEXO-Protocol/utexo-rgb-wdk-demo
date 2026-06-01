// Per-network demo defaults.
//
// Both E2ETab + UnlockGate currently hard-code the regtest values
// inline. This file centralizes the per-network endpoint set so we
// can flip the demo onto Signet (Renat's June 1 ask: "update demo to
// the new version and change it to signet") without scattering the
// constants. Yurii owns the LSP-side Signet wiring with Oleksandr +
// Xalkan; once those endpoints are stable, swap DEFAULT_NETWORK
// below or wire a runtime selector into the tab UI.

import { Platform } from 'react-native'

/** RLN supports four networks via the JsonSdkInitRequest `network` field. */
export type WdkNetwork = 'mainnet' | 'testnet' | 'regtest' | 'signet'

export interface NetworkDefaults {
  /** Display label for UI selectors. */
  label: string
  /** Bitcoin Core / esplora RPC creds and host. */
  bitcoind: { host: string, port: number, user: string, password: string }
  /** Electrs / Esplora indexer URL (tcp:// or http(s)://). */
  indexerUrl: string
  /** RGB proxy endpoint (rpc://host/json-rpc). */
  proxyEndpoint: string
  /** Peer RLN HTTP base (used by node-demo's PeerClient). */
  peerBaseUrl: string
  /** Peer host for `pubkey@host:port` LDK channel-open strings. */
  peerHostForLn: string
  /** Peer LDK port (--ldk-peer-listening-port). */
  peerLnPort: string
  /** utexo-lsp HTTP base (or empty to disable the LSP suite). */
  lspBaseUrl: string
  /** Optional VSS cloud backup endpoint. */
  vssUrl: string
}

/**
 * In RN, the simulator's "host machine" alias is platform-specific:
 *   iOS sim   → 127.0.0.1 (shared kernel)
 *   Android emu → 10.0.2.2 (NAT alias for the host)
 * Real devices need the LAN IP.
 *
 * Exported so other UI files (UnlockGate, E2ETab, NodeTab,
 * RgbLightningScreen, RgbScreen) can use one source of truth
 * rather than re-declaring the Platform check inline.
 */
export const HOST_LOOPBACK: string = Platform?.OS === 'android' ? '10.0.2.2' : '127.0.0.1'

/**
 * Regtest defaults — match the rgb-lightning-node `regtest.sh start`
 * compose stack + node-demo/lsp/up.sh. This is what every E2E run
 * targets unless the user overrides in the UI.
 */
export const REGTEST_DEFAULTS: NetworkDefaults = {
  label: 'Regtest (local)',
  bitcoind: { host: HOST_LOOPBACK, port: 18443, user: 'user', password: 'password' },
  indexerUrl: `tcp://${HOST_LOOPBACK}:50001`,
  proxyEndpoint: `rpc://${HOST_LOOPBACK}:3000/json-rpc`,
  peerBaseUrl: `http://${HOST_LOOPBACK}:3002`,
  peerHostForLn: HOST_LOOPBACK,
  peerLnPort: '9736',
  lspBaseUrl: `http://${HOST_LOOPBACK}:8080`,
  vssUrl: ''
}

/**
 * Signet defaults — UTEXO-operated Signet endpoints. Plug in the real
 * URLs once Oleksandr / Xalkan finalize the LSP + indexer + proxy
 * deployments. The placeholders below are intentional so a misclick
 * doesn't accidentally hit production-ish hosts before they're ready.
 *
 * Once these are live, set DEFAULT_NETWORK to 'signet' (or expose a
 * network selector in the UI).
 */
export const SIGNET_DEFAULTS: NetworkDefaults = {
  label: 'Signet (UTEXO)',
  // bitcoind credentials: signet uses the public utexo-operated node.
  // Host/port intentionally left empty so a stale Signet config can't
  // silently send funds anywhere — operators must paste them in.
  bitcoind: { host: '', port: 38332, user: '', password: '' },
  indexerUrl: 'tcp://signet.electrum.utexo.com:50001',
  proxyEndpoint: 'rpc://signet.proxy.utexo.com:3000/json-rpc',
  peerBaseUrl: 'https://signet.peer.utexo.com',
  peerHostForLn: 'signet.peer.utexo.com',
  peerLnPort: '9735',
  lspBaseUrl: 'https://signet.lsp.utexo.com',
  vssUrl: 'https://signet.vss.utexo.com'
}

export const NETWORK_DEFAULTS: Record<WdkNetwork, NetworkDefaults> = {
  regtest: REGTEST_DEFAULTS,
  signet: SIGNET_DEFAULTS,
  // Mainnet / testnet are not first-alpha targets. Placeholders so a
  // future runtime switch doesn't throw on lookup.
  testnet: { ...REGTEST_DEFAULTS, label: 'Testnet' },
  mainnet: { ...REGTEST_DEFAULTS, label: 'Mainnet (do not use yet)' }
}

/**
 * Current demo default. `regtest` while Signet endpoints are still
 * being plumbed in by the LSP team. Flip to `signet` (or expose a
 * selector) once Yurii confirms the Signet stack is reachable.
 */
export const DEFAULT_NETWORK: WdkNetwork = 'regtest'

export function getNetworkDefaults (network: WdkNetwork): NetworkDefaults {
  return NETWORK_DEFAULTS[network] ?? REGTEST_DEFAULTS
}
