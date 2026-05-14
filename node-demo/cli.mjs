#!/usr/bin/env node
// utexo-rgb-wdk-node-demo
//
// Node-side counterpart to the RN demo. Exercises @tetherto/wdk +
// @utexo/wdk-rgb-lightning + @utexo/rgb-lightning-node-nodejs against
// the same regtest stack (bitcoind/electrs/rgb-proxy) the RN app uses.
//
// Subcommands:
//   init       — generate a new BIP-39 mnemonic + write to .data/mnemonic
//   unlock     — bring the LDK node online (bitcoind/indexer/proxy creds)
//   address    — get an on-chain address
//   info       — node + network info
//   balance    — BTC balance (vanilla / colored)
//   peers      — connected LN peers
//   channels   — open channels
//   connect    — connect to a peer (positional: <pubkey@host:port>)
//   open       — open a BTC channel (positional: <peer_pubkey> <capacity_sat>)
//   invoice    — create a BOLT11 invoice (positional: <amt_msat>)
//   pay        — pay a BOLT11 invoice (positional: <invoice>)
//   shutdown   — close handle (idempotent)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateMnemonic, validateMnemonic } from 'bip39'
import WalletManagerRgbLightning from '@utexo/wdk-rgb-lightning'

const DATA_DIR = process.env.WDK_DATA_DIR ?? path.join(process.cwd(), '.data')
const MNEMONIC_PATH = path.join(DATA_DIR, 'mnemonic')
const RLN_DIR = path.join(DATA_DIR, 'rln')

const ENV = {
  network: process.env.WDK_NETWORK ?? 'regtest',
  bitcoindUser: process.env.BITCOIND_USER ?? 'user',
  bitcoindPass: process.env.BITCOIND_PASS ?? 'password',
  bitcoindHost: process.env.BITCOIND_HOST ?? '127.0.0.1',
  bitcoindPort: Number(process.env.BITCOIND_PORT ?? 18443),
  indexerUrl: process.env.INDEXER_URL ?? '127.0.0.1:50001',
  proxyEndpoint: process.env.PROXY_ENDPOINT ?? 'rpc://192.168.0.11:3001/json-rpc'
}

function die (msg) {
  console.error(`[wdk-rln] ERROR: ${msg}`)
  process.exit(1)
}

function ensureDataDir () {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(RLN_DIR, { recursive: true })
}

function loadMnemonic () {
  if (!fs.existsSync(MNEMONIC_PATH)) {
    die(`no mnemonic at ${MNEMONIC_PATH}. Run 'init' first or set WDK_MNEMONIC env var.`)
  }
  const mn = fs.readFileSync(MNEMONIC_PATH, 'utf8').trim()
  if (!validateMnemonic(mn)) die('stored mnemonic is invalid')
  return mn
}

function buildAccount () {
  const mnemonic = process.env.WDK_MNEMONIC || loadMnemonic()
  ensureDataDir()
  const manager = new WalletManagerRgbLightning(mnemonic, {
    network: ENV.network,
    dataDir: RLN_DIR
  })
  return { manager, accountPromise: manager.getAccount(0) }
}

async function cmdInit () {
  ensureDataDir()
  if (fs.existsSync(MNEMONIC_PATH)) {
    die(`mnemonic already exists at ${MNEMONIC_PATH}. Delete it manually to re-init.`)
  }
  const mnemonic = generateMnemonic(128)
  fs.writeFileSync(MNEMONIC_PATH, mnemonic + '\n', { mode: 0o600 })
  console.log(`✓ wrote mnemonic to ${MNEMONIC_PATH}`)
  console.log(`  ${mnemonic}`)
  console.log('\nNext: run `node cli.mjs unlock` (with bitcoind/electrs/rgb-proxy running).')
}

async function cmdUnlock () {
  const { accountPromise } = buildAccount()
  const account = await accountPromise
  console.log('[wdk-rln] bringing node online…')
  await account._binding.unlock({
    bitcoind_rpc_username: ENV.bitcoindUser,
    bitcoind_rpc_password: ENV.bitcoindPass,
    bitcoind_rpc_host: ENV.bitcoindHost,
    bitcoind_rpc_port: ENV.bitcoindPort,
    indexer_url: ENV.indexerUrl,
    proxy_endpoint: ENV.proxyEndpoint,
    announce_addresses: [],
    announce_alias: 'wdk-rln-node-demo'
  })
  const info = account._binding.node.nodeInfo() // wrapper already parses
  console.log('✓ unlocked. node_id:', info.pubkey)
  console.log('  peers:', info.num_peers, 'channels:', info.num_channels, 'usable:', info.num_usable_channels)
}

async function withAccount (fn) {
  const { manager, accountPromise } = buildAccount()
  const account = await accountPromise
  try {
    return await fn(account)
  } finally {
    try { manager.dispose() } catch { /* ignore */ }
  }
}

async function cmdAddress () {
  await withAccount(async (account) => {
    await account._binding.unlock({
      bitcoind_rpc_username: ENV.bitcoindUser,
      bitcoind_rpc_password: ENV.bitcoindPass,
      bitcoind_rpc_host: ENV.bitcoindHost,
      bitcoind_rpc_port: ENV.bitcoindPort,
      indexer_url: ENV.indexerUrl,
      proxy_endpoint: ENV.proxyEndpoint,
      announce_addresses: [],
      announce_alias: 'wdk-rln-node-demo'
    })
    const addr = account._binding.node.address() // already parsed by wrapper
    console.log(addr.address ?? addr)
  })
}

async function unlockAndRun (fn) {
  await withAccount(async (account) => {
    await account._binding.unlock({
      bitcoind_rpc_username: ENV.bitcoindUser,
      bitcoind_rpc_password: ENV.bitcoindPass,
      bitcoind_rpc_host: ENV.bitcoindHost,
      bitcoind_rpc_port: ENV.bitcoindPort,
      indexer_url: ENV.indexerUrl,
      proxy_endpoint: ENV.proxyEndpoint,
      announce_addresses: [],
      announce_alias: 'wdk-rln-node-demo'
    })
    await fn(account._binding.node)
  })
}

const cmd = process.argv[2]
const args = process.argv.slice(3)

const commands = {
  init: cmdInit,
  unlock: cmdUnlock,
  address: cmdAddress,
  info: () => unlockAndRun((n) => console.log(n.nodeInfo())),
  netinfo: () => unlockAndRun((n) => console.log(n.networkInfo())),
  balance: () => unlockAndRun((n) => console.log(n.btcBalance(false))),
  peers: () => unlockAndRun((n) => console.log(n.listPeers())),
  channels: () => unlockAndRun((n) => console.log(n.listChannels())),

  connect: () => {
    const peer = args[0]
    if (!peer) die('usage: connect <pubkey@host:port>')
    return unlockAndRun((n) => {
      console.log(n.connectPeer(peer))
    })
  },

  open: () => {
    const [peer_pubkey, capacity_sat_raw] = args
    if (!peer_pubkey || !capacity_sat_raw) die('usage: open <peer_pubkey> <capacity_sat>')
    return unlockAndRun((n) => {
      // mirror the RN demo: createUtxos prerequisite, then openChannel
      try {
        n.createUtxos({ up_to: true, num: 4, size: 32000, fee_rate: 1, skip_sync: false })
      } catch (e) {
        console.error('createUtxos:', e.message)
      }
      const res = n.openChannel({
        peer_pubkey_and_opt_addr: peer_pubkey,
        capacity_sat: Number(capacity_sat_raw),
        push_msat: 0,
        public: false,
        with_anchors: true,
        fee_base_msat: 1000,
        fee_proportional_millionths: 1,
        temporary_channel_id: null
      })
      console.log(res)
    })
  },

  invoice: () => {
    const amt_msat = Number(args[0])
    if (!amt_msat) die('usage: invoice <amt_msat>')
    return unlockAndRun((n) => {
      const res = n.lnInvoice({ amt_msat, expiry_sec: 3600 })
      console.log(res.invoice)
    })
  },

  pay: () => {
    const invoice = args[0]
    if (!invoice) die('usage: pay <bolt11>')
    return unlockAndRun((n) => {
      const res = n.sendPayment({ invoice })
      console.log(res)
    })
  },

  shutdown: () => withAccount(async (account) => {
    try { account._binding.shutdown() } catch { /* ignore */ }
    console.log('✓ shutdown')
  }),

  // Runs an end-to-end flow in a single binding lifetime so peer
  // connections and channel state actually carry between steps.
  // Usage: node cli.mjs flow <peer_uri> <capacity_sat>
  flow: async () => {
    const [peerUri, capacityArg] = args
    if (!peerUri) die('usage: flow <peer_uri> [capacity_sat=1000000]')
    const capacity = Number(capacityArg ?? 1000000)
    await unlockAndRun(async (n) => {
      console.log('[flow] node:', n.nodeInfo().pubkey)
      console.log('[flow] address:', n.address())
      console.log('[flow] btc balance:', n.btcBalance(false).vanilla)
      console.log('[flow] connecting peer →', peerUri)
      n.connectPeer(peerUri)
      // listPeers returns a bare array of {pubkey} objects (matches the
      // RLN REST shape — the RN demo's `.peers` access reads the same
      // payload one level up, via the WDK extension proxy).
      console.log('[flow] peers:', n.listPeers().map(p => p.pubkey))
      console.log('[flow] creating UTXOs for channel funding…')
      try { n.createUtxos({ up_to: true, num: 4, size: 32000, fee_rate: 1, skip_sync: false }) }
      catch (e) { console.error('[flow] createUtxos:', e.message) }
      const peerPubkey = peerUri.split('@')[0]
      console.log(`[flow] opening BTC channel to ${peerPubkey.slice(0, 20)}… capacity=${capacity}sat`)
      const open = n.openChannel({
        peer_pubkey_and_opt_addr: peerPubkey,
        capacity_sat: capacity,
        push_msat: 0,
        public: false,
        with_anchors: true,
        fee_base_msat: 1000,
        fee_proportional_millionths: 1,
        temporary_channel_id: null
      })
      console.log('[flow] open:', open)
      console.log('[flow] channels:', n.listChannels().map(c => ({
        id: c.channel_id.slice(0, 16),
        ready: c.ready,
        usable: c.is_usable,
        cap: c.capacity_sat
      })))
      console.log('\n[flow] ✓ done. Funding tx is in the mempool — mine 6 blocks on bitcoind to confirm.')
    })
  }
}

if (!cmd || !commands[cmd]) {
  const known = Object.keys(commands).join(', ')
  console.error(`usage: node cli.mjs <command> [args]\nknown commands: ${known}`)
  process.exit(2)
}

commands[cmd]().then(
  () => process.exit(0),
  (e) => { console.error('[wdk-rln] ERROR:', e?.message ?? e); process.exit(1) }
)
