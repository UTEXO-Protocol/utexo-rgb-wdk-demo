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
//   PEER_LN_PORT                  # 9735
//   INDEXER_URL                   # tcp://127.0.0.1:50001
//   PROXY_ENDPOINT                # rpc://127.0.0.1:3001/json-rpc
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
  proxyEndpoint: process.env.PROXY_ENDPOINT ?? 'rpc://127.0.0.1:3001/json-rpc',
  peerBaseUrl: process.env.PEER_BASE_URL ?? 'http://127.0.0.1:3002',
  peerHostForLn: process.env.PEER_HOST_FOR_LN ?? '127.0.0.1',
  peerLnPort: process.env.PEER_LN_PORT ?? '9735',
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
  const manager = new ManagerCtor(mnemonic, {
    network: ENV.network,
    dataDir: RLN_DIR
  })
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
    'env.proxy_endpoint': ENV.proxyEndpoint
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

  const reportPath = path.join(REPORTS_DIR, `${report.sessionId}.json`)
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
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
