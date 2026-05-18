// PeerClient — HTTP wrapper around a counterparty RLN daemon.
//
// The autonomous E2E suite needs a second RLN node to play the
// counterparty in channel-open / invoice-pay / RGB-transfer flows.
// We talk to the existing Docker peer (rgb-lightning-node serving its
// REST API on 3001 by default) — no signer attached on our side, just
// the HTTP routes from openapi.yaml.
//
// Only the routes the E2E suite actually drives are mapped here; add
// more as new scenarios need them.

import { logEvent } from '../state/LogStore'

export interface PeerConfig {
  /** Base URL — e.g. `http://10.0.2.2:3001`. NO trailing slash. */
  baseUrl: string
  /**
   * Per-request timeout in milliseconds. Default 15s — long enough for
   * slow operations like `openChannel`, short enough that an
   * unreachable peer doesn't stall the entire suite indefinitely.
   * Override per-environment if needed.
   */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15000

export class PeerClient {
  constructor (private config: PeerConfig) {}

  // The RLN HTTP daemon routes some read-only endpoints as GET (no
  // body) and mutations as POST (with body). The actual method per
  // route was confirmed by live-probing the daemon; openapi.yaml is
  // inconsistent (it lists everything as POST, but POSTing to
  // /nodeinfo / /listchannels / etc. returns 405). See the matrix at
  // the top of testCases.ts.

  // ─── Diagnostics (GET) ─────────────────────────────────────────────
  async nodeInfo (): Promise<{ pubkey?: string; num_peers?: number; num_channels?: number; block_height?: number }> {
    return this.get<{ pubkey?: string }>('/nodeinfo')
  }
  async networkInfo (): Promise<unknown> { return this.get('/networkinfo') }

  /**
   * Trigger a chain sync on the peer daemon. Needed during channel-open
   * polling because the peer's background sync doesn't tick fast enough
   * on regtest to observe newly-mined funding-tx confirmations and send
   * `channel_ready` in a timely fashion.
   */
  async sync (): Promise<unknown> { return this.post('/sync', {}) }

  // ─── Peers / channels ──────────────────────────────────────────────
  async connectPeer (peerPubkeyAndAddr: string): Promise<unknown> {
    return this.post('/connectpeer', { peer_pubkey_and_addr: peerPubkeyAndAddr })
  }
  async openChannel (req: Record<string, unknown>): Promise<{ temporary_channel_id?: string; channel_id?: string }> {
    return this.post('/openchannel', req)
  }
  /** GET — listChannels has no request body on the HTTP surface. */
  async listChannels (): Promise<{ channels?: Array<Record<string, unknown>> }> {
    return this.get('/listchannels')
  }
  async listPeers (): Promise<{ peers?: Array<Record<string, unknown>> }> {
    return this.get('/listpeers')
  }

  // ─── BTC ───────────────────────────────────────────────────────────
  async address (): Promise<{ address: string }> { return this.post('/address', {}) }
  async btcBalance (): Promise<unknown> { return this.post('/btcbalance', { skip_sync: false }) }
  async sendBtc (req: { amount: number; address: string; fee_rate: number; skip_sync: boolean }): Promise<{ txid: string }> {
    return this.post('/sendbtc', req)
  }

  /**
   * Allocate colorable UTXOs on the peer side. Required before the peer
   * can issue an RGB asset (issuance needs free colored UTXOs to bind
   * the genesis allocation to). `up_to: true` is idempotent — succeeds
   * silently when the peer already has ≥ `num` colorable UTXOs.
   */
  async createUtxos (req: { up_to: boolean; num?: number; size?: number; fee_rate: number; skip_sync: boolean }): Promise<unknown> {
    return this.post('/createutxos', req)
  }

  // ─── BOLT11 ────────────────────────────────────────────────────────
  async lnInvoice (req: Record<string, unknown>): Promise<{ invoice?: string; payment_hash?: string }> {
    return this.post('/lninvoice', req)
  }
  async sendPayment (req: Record<string, unknown>): Promise<{ payment_hash?: string; status?: string }> {
    return this.post('/sendpayment', req)
  }
  async keysend (req: Record<string, unknown>): Promise<{ payment_hash?: string }> {
    return this.post('/keysend', req)
  }

  // ─── RGB ───────────────────────────────────────────────────────────
  async issueAssetNia (req: { amounts: number[]; ticker: string; name: string; precision: number }): Promise<{ asset_id?: string }> {
    return this.post('/issueassetnia', req)
  }
  async rgbInvoice (req: Record<string, unknown>): Promise<{ recipient_id?: string; invoice?: string }> {
    return this.post('/rgbinvoice', req)
  }
  async sendRgb (req: Record<string, unknown>): Promise<{ txid?: string }> {
    return this.post('/sendrgb', req)
  }
  async refreshTransfers (req: Record<string, unknown> = {}): Promise<unknown> {
    return this.post('/refreshtransfers', req)
  }

  // ─── Low-level ─────────────────────────────────────────────────────
  private async post<T> (path: string, body: unknown): Promise<T> {
    return this.request<T>(path, 'POST', body)
  }

  private async get<T> (path: string): Promise<T> {
    return this.request<T>(path, 'GET', null)
  }

  private async request<T> (path: string, method: 'GET' | 'POST', body: unknown): Promise<T> {
    const url = this.config.baseUrl + path
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    // AbortController gates each fetch so an unreachable peer can't
    // stall the test suite indefinitely. Previously a hung peer would
    // freeze the entire run until the OS-level connect timeout (often
    // 60s+) fired — and longer for the read phase.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
        body: method === 'POST' ? JSON.stringify(body) : undefined,
        signal: controller.signal
      })
    } catch (e) {
      const aborted = (e as { name?: string }).name === 'AbortError'
      const err = aborted
        ? `peer fetch timed out after ${timeoutMs}ms: ${path}`
        : `peer fetch failed: ${path}: ${(e as Error).message}`
      logEvent('error', 'peer', path, err)
      throw new Error(err)
    } finally {
      clearTimeout(timer)
    }
    const text = await res.text()
    if (!res.ok) {
      const err = `peer HTTP ${res.status} ${path}: ${text.slice(0, 200)}`
      logEvent('error', 'peer', path, err)
      throw new Error(err)
    }
    try {
      const parsed = text.length > 0 ? JSON.parse(text) : ({} as unknown)
      return parsed as T
    } catch (e) {
      throw new Error(`peer ${path}: non-JSON response: ${text.slice(0, 200)}`)
    }
  }
}
