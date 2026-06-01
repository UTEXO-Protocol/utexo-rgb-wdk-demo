// VSS backup/restore roundtrip probe.
//
// Open questions this answers:
//   Q1. Does VSS-over-HTTP work in the in-process SDK path, or does it
//       trip the rustls crypto-provider gap that PR #53 patches for the
//       daemon? (Phase 1 unlock succeeding answers this.)
//   Q2. Does a state-changing op actually replicate to the VSS server?
//       (Check VSS postgres row count after createUtxos.)
//   Q3. Does a fresh-dataDir re-unlock restore that state from VSS?
//       (Phase 2: wipe local, re-unlock same mnemonic, expect utxos back.)
//
// Usage:  node vss-roundtrip.mjs
// Env (regtest defaults): VSS_URL, BITCOIND_*, INDEXER_URL, PROXY_ENDPOINT

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { generateMnemonic } from 'bip39'
import WalletManagerRgbLightning from '@utexo/wdk-rgb-lightning'

const DATA_DIR = path.resolve(process.cwd(), '.data')
const RLN_DIR = path.join(DATA_DIR, 'rln-vss')
const MNEMONIC_PATH = path.join(DATA_DIR, 'mnemonic-vss')

const ENV = {
  network: process.env.WDK_NETWORK ?? 'regtest',
  vssUrl: process.env.VSS_URL ?? 'http://127.0.0.1:8081/vss',
  bitcoindUser: process.env.BITCOIND_USER ?? 'user',
  bitcoindPass: process.env.BITCOIND_PASS ?? 'password',
  bitcoindHost: process.env.BITCOIND_HOST ?? '127.0.0.1',
  bitcoindPort: Number(process.env.BITCOIND_PORT ?? 18443),
  indexerUrl: process.env.INDEXER_URL ?? 'tcp://127.0.0.1:50001',
  proxyEndpoint: process.env.PROXY_ENDPOINT ?? 'rpc://127.0.0.1:3000/json-rpc'
}

const unlockReq = {
  bitcoind_rpc_username: ENV.bitcoindUser,
  bitcoind_rpc_password: ENV.bitcoindPass,
  bitcoind_rpc_host: ENV.bitcoindHost,
  bitcoind_rpc_port: ENV.bitcoindPort,
  indexer_url: ENV.indexerUrl,
  proxy_endpoint: ENV.proxyEndpoint,
  announce_addresses: [],
  announce_alias: 'vss-roundtrip'
}

const log = (...a) => console.log('[vss]', ...a)

function rpc (method, params = []) {
  const body = JSON.stringify({ jsonrpc: '1.0', id: 'vss', method, params })
  const out = execSync(
    `curl -sS --user ${ENV.bitcoindUser}:${ENV.bitcoindPass} --data '${body}' -H 'content-type: text/plain;' http://${ENV.bitcoindHost}:${ENV.bitcoindPort}/`,
    { encoding: 'utf8' }
  )
  return JSON.parse(out).result
}

function minerRpc (method, params = []) {
  const body = JSON.stringify({ jsonrpc: '1.0', id: 'vss', method, params })
  const out = execSync(
    `curl -sS --user ${ENV.bitcoindUser}:${ENV.bitcoindPass} --data '${body}' -H 'content-type: text/plain;' http://${ENV.bitcoindHost}:${ENV.bitcoindPort}/wallet/miner`,
    { encoding: 'utf8' }
  )
  return JSON.parse(out).result
}

function vssRowCount () {
  const out = execSync(
    "docker exec rgb-lightning-node-vss-postgres-1 psql -U postgres -d vss -t -c 'SELECT count(*) FROM vss_db;'",
    { encoding: 'utf8' }
  )
  return parseInt(out.trim(), 10)
}

async function bringUp (mnemonic, label) {
  const manager = new WalletManagerRgbLightning(mnemonic, {
    network: ENV.network,
    dataDir: RLN_DIR,
    vssUrl: ENV.vssUrl,
    vssAllowHttp: true
  })
  const account = await manager.getAccount(0)
  const t0 = Date.now()
  await account.unlock(unlockReq)
  log(`${label}: unlock OK in ${Date.now() - t0}ms`)
  return { manager, account }
}

function loadOrGenMnemonic () {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  if (fs.existsSync(MNEMONIC_PATH)) return fs.readFileSync(MNEMONIC_PATH, 'utf8').trim()
  const m = generateMnemonic()
  fs.writeFileSync(MNEMONIC_PATH, m)
  return m
}

async function main () {
  const mnemonic = loadOrGenMnemonic()
  fs.rmSync(RLN_DIR, { recursive: true, force: true })
  fs.mkdirSync(RLN_DIR, { recursive: true })

  log('=== PHASE 1: backup ===')
  log('VSS rows before phase1:', vssRowCount())
  const p1 = await bringUp(mnemonic, 'phase1')
  const info1 = await p1.account.getNodeInfo()
  log('phase1 pubkey:', String(info1.pubkey ?? '').slice(0, 32) + '…')

  // Fund the wallet so createUtxos can run (real RGB-wallet state write).
  const addr = await p1.account.getAddress()
  const addrStr = typeof addr === 'string' ? addr : (addr?.address ?? addr)
  log('phase1 wallet address:', addrStr)
  log('sending 1 BTC from miner + mining 6…')
  minerRpc('sendtoaddress', [addrStr, 1])
  const mineAddr = minerRpc('getnewaddress')
  rpc('generatetoaddress', [6, mineAddr])
  await new Promise(r => setTimeout(r, 4000))

  try {
    log('createUtxos (forces RGB wallet persist → VSS backup)…')
    await p1.account.createUtxos({ up_to: true, num: 5, size: 32000, fee_rate: 5, skip_sync: false })
  } catch (e) {
    log('createUtxos error (may be benign):', String(e.message || e))
  }

  const unspents1 = await p1.account.listUnspents(false).catch(() => null)
  const utxoCount1 = Array.isArray(unspents1) ? unspents1.length : (unspents1?.unspents?.length ?? unspents1?.length ?? 'n/a')
  log('phase1 utxos after createUtxos:', utxoCount1)

  // Let continuous VSS backup flush.
  await new Promise(r => setTimeout(r, 5000))
  const rowsAfterP1 = vssRowCount()
  log('VSS rows after phase1 ops:', rowsAfterP1)

  await p1.account.shutdown()

  log('=== PHASE 2: restore (wipe local, re-unlock same mnemonic) ===')
  fs.rmSync(RLN_DIR, { recursive: true, force: true })
  fs.mkdirSync(RLN_DIR, { recursive: true })

  const p2 = await bringUp(mnemonic, 'phase2')
  const info2 = await p2.account.getNodeInfo()
  log('phase2 pubkey:', String(info2.pubkey ?? '').slice(0, 32) + '…')

  const unspents2 = await p2.account.listUnspents(false).catch(() => null)
  const utxoCount2 = Array.isArray(unspents2) ? unspents2.length : (unspents2?.unspents?.length ?? unspents2?.length ?? 'n/a')
  log('phase2 utxos after restore:', utxoCount2)

  await p2.account.shutdown()

  log('=== RESULT ===')
  log('Q1 VSS unlock crashes on crypto provider?  NO (both unlocks succeeded)')
  log('Q2 state replicated to VSS?                ', rowsAfterP1 > 0 ? `YES (${rowsAfterP1} rows)` : 'NO (0 rows — writes not landing)')
  log('Q3 pubkey stable across wipe?              ', info1.pubkey === info2.pubkey ? 'YES' : 'NO')
  log('Q3 utxos restored from VSS?                ', `phase1=${utxoCount1} phase2=${utxoCount2}`)
  process.exit(0)
}

main().catch((e) => {
  console.error('[vss] FATAL:', e && e.stack ? e.stack : e)
  process.exit(1)
})
