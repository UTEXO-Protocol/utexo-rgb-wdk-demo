// Node entry point for the autonomous E2E suite.
//
// Mirrors the RN E2ETab wiring:
//   1. Read/generate a BIP-39 mnemonic from ~/node-demo/.data/mnemonic
//      (or env $WDK_MNEMONIC).
//   2. Build a `WalletManagerRgbLightning` against ./.data/rln/, get the
//      first account.
//   3. Unlock the daemon (bitcoind / indexer / proxy creds from env).
//   4. Build the LnExt adapter over the napi binding.
//   5. Build PeerClient + ChainController from env.
//   6. Instantiate TestRunner with the same shared TEST_CASES.
//   7. Run, write JSON report to .data/reports/<sessionId>.json + print
//      a one-line summary.
//
// Env vars (all have sensible regtest defaults — see ENV below):
//   BITCOIND_HOST, BITCOIND_PORT, BITCOIND_USER, BITCOIND_PASS
//   PEER_BASE_URL                 # http://127.0.0.1:3002
//   PEER_HOST_FOR_LN              # 127.0.0.1
//   PEER_LN_PORT                  # 9736
//   INDEXER_URL                   # tcp://127.0.0.1:50001
//   PROXY_ENDPOINT                # rpc://127.0.0.1:3000/json-rpc
//   E2E_CATEGORY                  # comma-separated filter; default = all
//   WDK_MNEMONIC                  # 12-word BIP-39 seed (else read from .data)
//   WDK_DATA_DIR                  # default ./.data

import fs from 'node:fs'
import path from 'node:path'
import { generateMnemonic, validateMnemonic } from 'bip39'
// @utexo/wdk-rgb-lightning ships pure JS — no .d.ts. The default export
// is a class; we cast at the use-site. See node-binding.js + index-node.js.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — module lacks type declarations
import WalletManagerRgbLightning from '@utexo/wdk-rgb-lightning'
import { TestRunner } from './TestRunner'
import { ChainController } from './ChainController'
import { PeerClient } from './PeerClient'
import { TEST_CASES } from './testCases'
import { createLnExtNodeAdapter, type RglAccount } from './LnExtNodeAdapter'
import { logEvent, logStore } from './logger'

const DATA_DIR = process.env.WDK_DATA_DIR ?? path.resolve(process.cwd(), '.data')
const MNEMONIC_PATH = path.join(DATA_DIR, 'mnemonic')
const RLN_DIR = path.join(DATA_DIR, 'rln')
const REPORTS_DIR = path.join(DATA_DIR, 'reports')

const ENV = {
  network: process.env.WDK_NETWORK ?? 'regtest',
  bitcoindUser: process.env.BITCOIND_USER ?? 'user',
  bitcoindPass: process.env.BITCOIND_PASS ?? 'password',
  bitcoindHost: process.env.BITCOIND_HOST ?? '127.0.0.1',
  bitcoindPort: Number(process.env.BITCOIND_PORT ?? 18443),
  indexerUrl: process.env.INDEXER_URL ?? 'tcp://127.0.0.1:50001',
  proxyEndpoint: process.env.PROXY_ENDPOINT ?? 'rpc://127.0.0.1:3000/json-rpc',
  peerBaseUrl: process.env.PEER_BASE_URL ?? 'http://127.0.0.1:3002',
  peerHostForLn: process.env.PEER_HOST_FOR_LN ?? '127.0.0.1',
  // 9736 matches the local regtest peer launched with
  // `--ldk-peer-listening-port 9736` (default LDK port 9735 is left for
  // any concurrently-running mainline node). iOS users override this in
  // the E2ETab UI; on Node we have no UI so the default has to be right.
  peerLnPort: process.env.PEER_LN_PORT ?? '9736',
  // Optional LSP integration target. When unset the LSP suite (t109+)
  // fails fast on the probe case, which cascades to skips for the rest
  // — matches the "non-LSP" environment cleanly. Set
  // LSP_BASE_URL=http://127.0.0.1:8080 (or use ./lsp/up.sh) to enable.
  lspBaseUrl: process.env.LSP_BASE_URL ?? '',
  // Optional VSS cloud backup target. When unset the wallet runs
  // without VSS — t120 (vssBackupReplication) skips. When set, the
  // wallet is constructed with vssUrl forwarded to RLN and t120
  // verifies that state-changing ops replicate to the VSS server.
  vssUrl: process.env.VSS_URL ?? '',
  // Postgres container that backs the VSS server. Used by t120 to
  // count vss_db rows pre/post state change as proof of replication.
  // Defaults to the demo regtest stack name.
  vssPostgresContainer: process.env.VSS_POSTGRES_CONTAINER ?? 'rgb-lightning-node-vss-postgres-1',
  // Opt-in virtual-channels-v0 mode for the APay flow. RLN's async_order
  // forward is gated on a `trusted_no_broadcast` (virtual) channel
  // between device and the host peer — see `allows_peer()`. When set,
  // the wallet enables virtual channels and t30 opens the BTC channel
  // with `virtual_open_mode: trusted_no_broadcast`, which unblocks
  // t113/t114 (apayNew). Requires the peer launched with
  // `--enable-virtual-channels-v0 --virtual-peer-pubkeys <device>`.
  apayVirtual: (process.env.APAY_VIRTUAL ?? '') === '1',
  // Host peer (LSP) node_id the device should trust for virtual channels.
  // In production every mobile client sets virtualPeerPubkeys=[LSP id]
  // so RLN's `allows_peer` accepts the LSP's trusted_no_broadcast
  // channel. Defaults to the regtest peer's node_id.
  peerNodeId: process.env.PEER_NODE_ID ?? '',
  categoryFilter: process.env.E2E_CATEGORY
}

function ensureDirs (): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(RLN_DIR, { recursive: true })
  fs.mkdirSync(REPORTS_DIR, { recursive: true })
}

function loadOrGenerateMnemonic (): string {
  if (process.env.WDK_MNEMONIC) {
    if (!validateMnemonic(process.env.WDK_MNEMONIC)) {
      throw new Error('$WDK_MNEMONIC is not a valid BIP-39 mnemonic')
    }
    return process.env.WDK_MNEMONIC
  }
  if (fs.existsSync(MNEMONIC_PATH)) {
    const mn = fs.readFileSync(MNEMONIC_PATH, 'utf8').trim()
    if (!validateMnemonic(mn)) throw new Error(`stored mnemonic at ${MNEMONIC_PATH} is invalid`)
    return mn
  }
  const fresh = generateMnemonic(128)
  fs.writeFileSync(MNEMONIC_PATH, fresh + '\n', { mode: 0o600 })
  logEvent('info', 'lifecycle', 'mnemonic', `generated fresh mnemonic and wrote to ${MNEMONIC_PATH}`)
  return fresh
}

async function main (): Promise<void> {
  ensureDirs()
  const mnemonic = loadOrGenerateMnemonic()
  const ManagerCtor = WalletManagerRgbLightning as unknown as new (mn: string, opts: Record<string, unknown>) => { getAccount: (idx: number) => Promise<unknown> }
  const managerCfg: Record<string, unknown> = {
    network: ENV.network,
    dataDir: RLN_DIR
  }
  if (ENV.vssUrl) {
    // Forward VSS config when set — Renat's dev plan calls VSS a first-
    // alpha requirement; t120 validates replication. Loopback http
    // accepted in regtest via vssAllowHttp.
    managerCfg.vssUrl = ENV.vssUrl
    managerCfg.vssAllowHttp = true
  }
  if (ENV.apayVirtual) {
    // APay's async_order forward requires a trusted_no_broadcast (virtual)
    // channel to the host peer — enable virtual channels on the device so
    // t30 can open one.
    managerCfg.enableVirtualChannelsV0 = true
    // Trust the host peer (LSP) for virtual channels. Mirrors the
    // production contract: virtualPeerPubkeys=[LSP node_id]. The peer is
    // launched with the reciprocal --virtual-peer-pubkeys <device>.
    if (ENV.peerNodeId) managerCfg.virtualPeerPubkeys = [ENV.peerNodeId]
  }
  const manager = new ManagerCtor(mnemonic, managerCfg)
  const account = (await manager.getAccount(0)) as RglAccount & {
    unlock: (req: unknown) => Promise<unknown>
    getNodeInfo: () => Promise<{ pubkey?: string }>
  }
  // Drive the daemon online — same call the UnlockGate makes in RN.
  await account.unlock({
    bitcoind_rpc_username: ENV.bitcoindUser,
    bitcoind_rpc_password: ENV.bitcoindPass,
    bitcoind_rpc_host: ENV.bitcoindHost,
    bitcoind_rpc_port: ENV.bitcoindPort,
    indexer_url: ENV.indexerUrl,
    proxy_endpoint: ENV.proxyEndpoint,
    announce_addresses: [],
    announce_alias: 'wdk-rln-node-runner'
  })
  const info = await account.getNodeInfo()
  logEvent('success', 'lifecycle', 'unlock', `node online — pubkey ${String(info.pubkey ?? '').slice(0, 64)}…`)

  const ext = createLnExtNodeAdapter(account)
  const peer = new PeerClient({ baseUrl: ENV.peerBaseUrl })
  const chain = new ChainController({
    host: ENV.bitcoindHost,
    port: ENV.bitcoindPort,
    username: ENV.bitcoindUser,
    password: ENV.bitcoindPass
  })

  const initialState: Record<string, unknown> = {
    'env.peer_host': ENV.peerHostForLn,
    'env.peer_ln_port': ENV.peerLnPort,
    'env.indexer_url': ENV.indexerUrl,
    'env.proxy_endpoint': ENV.proxyEndpoint,
    'env.lsp_base_url': ENV.lspBaseUrl,
    'env.vss_url': ENV.vssUrl,
    'env.vss_postgres_container': ENV.vssPostgresContainer,
    'env.apay_virtual': ENV.apayVirtual
  }

  const runner = new TestRunner(TEST_CASES, { ext, peer, chain, initialState })
  // TestRunner.run takes a single category string (or undefined for all);
  // matches the RN E2ETab UI dropdown.
  const categoryFilter = ENV.categoryFilter && ENV.categoryFilter.length > 0 ? ENV.categoryFilter : undefined

  logEvent('info', 'e2e', 'session', `running suite — ${TEST_CASES.length} cases, sessionId=${logStore.getSessionId()}`)
  await runner.run(categoryFilter)
  const snap = runner.snapshot()
  const report = snap.report
  if (!report) {
    throw new Error('runner finished but no report attached')
  }

  // Some payloads include BigInt (e.g. asset amounts > 2^53). Stringify
  // them so JSON.stringify doesn't throw at write time.
  const reportPath = path.join(REPORTS_DIR, `${report.sessionId}.json`)
  fs.writeFileSync(reportPath, JSON.stringify(report, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2))
  logEvent('success', 'e2e', 'report', `wrote ${reportPath}`)
  console.log(`\n=== SUMMARY ===`)
  console.log(`total=${report.total} pass=${report.passed} fail=${report.failed} skip=${report.skipped} expected-fail=${report.expectedFail} unexpected-pass=${report.unexpectedPass}`)
  console.log(`durationMs=${report.durationMs} sessionId=${report.sessionId}`)
  // Exit non-zero if anything genuinely failed (not expected-fail / skip).
  process.exit(report.failed > 0 ? 1 : 0)
}

main().catch((e: unknown) => {
  console.error('FATAL:', e instanceof Error ? e.stack ?? e.message : e)
  process.exit(2)
})
