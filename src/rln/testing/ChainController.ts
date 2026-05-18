// ChainController — talks to bitcoind over JSON-RPC for E2E setup.
//
// The autonomous test runner needs to:
//   1. Fund the device's BTC address (sendToAddress)
//   2. Mine blocks (channel confirmations, CSV expiry)
//   3. Read the current chain height
//
// The same regtest stack the UnlockGate connects to (host `10.0.2.2`
// on Android emulator, `127.0.0.1` on iOS sim) exposes JSON-RPC on
// port 18443 by default. We only use the read+mine paths — no
// signing, no wallet operations beyond `sendtoaddress`.

import { logEvent } from '../state/LogStore'

export interface ChainConfig {
  host: string
  port: number
  username: string
  password: string
  /** Wallet name as registered in bitcoind (default for regtest: `default`). */
  wallet?: string
  /**
   * Per-RPC timeout in milliseconds. Default 10s — bitcoind regtest
   * calls are typically <100ms; a long-pending RPC almost always means
   * the daemon is unreachable. A timeout prevents the suite from
   * hanging on the OS-level connect timeout.
   */
  timeoutMs?: number
}

const DEFAULT_RPC_TIMEOUT_MS = 10000

export class ChainController {
  private url: string
  private auth: string

  constructor (private config: ChainConfig) {
    // Default to 'miner' — regtest.sh in rgb-lightning-node creates a
    // bitcoind wallet by that name and mines all initial blocks into it.
    // The `/wallet/<name>` path-suffix is mandatory for any RPC that
    // touches wallet state (sendtoaddress, getnewaddress).
    const wallet = config.wallet ?? 'miner'
    this.url = `http://${config.host}:${config.port}/wallet/${wallet}`
    // Inline base64 of `user:pass` so we don't depend on the global
    // `btoa` shim being present in every RN runtime variant.
    this.auth = 'Basic ' + base64(`${config.username}:${config.password}`)
  }

  /**
   * Wait until bitcoind is reachable + the regtest wallet is loaded.
   * Returns the current block height on success; throws after the
   * timeout if the daemon never responds.
   */
  async waitReady (timeoutMs = 30000): Promise<number> {
    const deadline = Date.now() + timeoutMs
    let lastErr: unknown = null
    while (Date.now() < deadline) {
      try {
        const h = await this.getBlockHeight()
        return h
      } catch (e) {
        lastErr = e
        await sleep(500)
      }
    }
    throw new Error(`bitcoind not ready after ${timeoutMs}ms: ${lastErr}`)
  }

  /** Returns the current best-block height. */
  async getBlockHeight (): Promise<number> {
    const r = await this.call<number>('getblockcount', [])
    return Number(r)
  }

  /** Fund `address` with `btc` BTC. Returns the funding txid. */
  async sendToAddress (address: string, btc: number): Promise<string> {
    logEvent('info', 'chain', 'sendToAddress', `${btc} BTC → ${address}`)
    const txid = await this.call<string>('sendtoaddress', [address, btc])
    return txid
  }

  /** Mine `n` blocks to a freshly-generated regtest address. */
  async mineBlocks (n: number): Promise<string[]> {
    logEvent('info', 'chain', 'mineBlocks', `+${n} blocks`)
    const addr = await this.call<string>('getnewaddress', [])
    return this.call<string[]>('generatetoaddress', [n, addr])
  }

  /** Get a regtest address from the bitcoind wallet (for change). */
  async getNewAddress (): Promise<string> {
    return this.call<string>('getnewaddress', [])
  }

  private async call<T> (method: string, params: unknown[]): Promise<T> {
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: this.auth },
        body: JSON.stringify({ jsonrpc: '1.0', id: 'rln-e2e', method, params }),
        signal: controller.signal
      })
    } catch (e) {
      const aborted = (e as { name?: string }).name === 'AbortError'
      if (aborted) throw new Error(`bitcoind ${method} timed out after ${timeoutMs}ms`)
      throw e
    } finally {
      clearTimeout(timer)
    }
    const body = await res.text()
    let parsed: { result?: T; error?: { code: number; message: string } }
    try { parsed = JSON.parse(body) } catch { throw new Error(`bitcoind: non-JSON response ${res.status} ${body.slice(0, 200)}`) }
    if (parsed.error) throw new Error(`bitcoind ${method}: ${parsed.error.message} (code ${parsed.error.code})`)
    if (parsed.result === undefined) throw new Error(`bitcoind ${method}: missing result`)
    return parsed.result as T
  }
}

function base64 (s: string): string {
  // Polyfill-friendly base64. Bare-node-runtime / RN both ship a Buffer
  // global; if it's missing we fall back to a small inline encoder.
  if (typeof Buffer !== 'undefined' && Buffer.from) {
    return Buffer.from(s, 'utf8').toString('base64')
  }
  // Minimal pure-JS base64 (RFC 4648). Only used as a fallback — not
  // hot path.
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  let i = 0
  while (i < s.length) {
    const a = s.charCodeAt(i++)
    const b = i < s.length ? s.charCodeAt(i++) : NaN
    const c = i < s.length ? s.charCodeAt(i++) : NaN
    out += chars[a >> 2]
    out += chars[((a & 3) << 4) | (b >> 4)]
    out += isNaN(b) ? '=' : chars[((b & 15) << 2) | (c >> 6)]
    out += isNaN(c) ? '=' : chars[c & 63]
  }
  return out
}

function sleep (ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
