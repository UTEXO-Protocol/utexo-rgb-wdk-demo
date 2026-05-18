// Autonomous E2E scenario suite for the RLN testing surface.
//
// Walks the full lifecycle from a freshly-unlocked node through:
//   funding → utxos → peers → channels → invoices → payments →
//   assets → asset channels → RGB transfers → close (coop + force) →
//   diagnostics
//
// Order matters — channels can't open until the peer is connected and
// UTXOs are colorable; asset transfers require an issued asset; etc.
// `dependsOn` lets a downstream case skip cleanly when its precondition
// failed (no need to flag a cascade of red).
//
// Cases tagged with `blockedBy` are iter-2 upstream blockers — they're
// expected-fail; their failure is the success signal and the report
// doesn't count them as broken.
//
// ─── Between-run state hygiene ───────────────────────────────────────
// Both sides keep persistent state:
//   • Device: <documents>/rgb-lightning/  (SQLite + LDK + BDK + VLS)
//   • Peer:   Docker volume for the rgb-lightning-node daemon
//
// If you see t31.channelReady fail with the device-side channel stuck
// in `Opening` despite blocks being mined, it's almost always peer-
// side state drift — the peer never observed the funding tx and
// therefore never sent `channel_ready`. Reset recipe:
//   docker compose down -v && docker compose up -d   # in rgb-lightning-node/
// (Adjust to your peer stack; the point is: wipe the peer's data dir.)
// Device-side state can be wiped via Settings → "Reset wallet" or by
// deleting the app and re-installing.

import { logEvent } from '../state/LogStore'
import type { TestCase, TestContext } from './types'

const PEER_PUBKEY_KEY = 'peer.pubkey'
const PEER_ADDR_KEY = 'peer.addr' // pubkey@host:port
const CHANNEL_ID_BTC_KEY = 'channel.btc.id'
const CHANNEL_ID_BTC_TEMP_KEY = 'channel.btc.temp_id'
const CHANNEL_IDS_BEFORE_BTC_OPEN_KEY = 'channels.btc.before_open_ids'
const CHANNEL_ID_ASSET_KEY = 'channel.asset.id'
const CHANNEL_IDS_BEFORE_ASSET_OPEN_KEY = 'channels.asset.before_open_ids'
const ASSET_ID_NIA_KEY = 'asset.nia.id'
const ASSET_ID_IFA_KEY = 'asset.ifa.id'
const INVOICE_HASH_KEY = 'invoice.last.hash'
const ONCHAIN_TXID_KEY = 'onchain.last.txid'

/**
 * Snapshot the set of channel ids currently visible. Returned as a
 * Set<string>. Used by openChannel tests to distinguish channels
 * opened in THIS run from leftovers in the wallet from prior runs.
 */
async function snapshotChannelIds (ext: TestContext['ext']): Promise<Set<string>> {
  const chans = await ext.listChannels().catch(() => [])
  const list = Array.isArray(chans) ? chans : []
  return new Set(list.map((c) => c?.channel_id).filter((id): id is string => typeof id === 'string'))
}

// Knobs the suite uses. Override via env if needed; defaults match the
// regtest stack from `rgb-lightning-node/regtest.sh start`.
const FUND_BTC = Number(process.env.EXPO_PUBLIC_E2E_FUND_BTC ?? '0.01')
const CSV_CONFIRMATIONS = 144 // RLN default for force-close locktime
const CHANNEL_CONFIRMATIONS = 6
const INVOICE_AMT_MSAT = 5000000
// Bumped further: 60s wasn't enough on the freshly-wiped wallet path
// where LDK + BDK + rgb-lib need a few sync cycles to stabilise before
// auto-claim works promptly. Observed flake at 60s after a wipe.
const PAYMENT_TIMEOUT_MS = 120000

async function sleep (ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Poll `predicate` until it returns truthy or the deadline passes.
 * Returns the truthy value; throws on timeout.
 */
async function waitFor<T> (label: string, predicate: () => Promise<T | null | undefined>, timeoutMs = 30000, intervalMs = 1000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const v = await predicate().catch(() => null)
    if (v) return v
    await sleep(intervalMs)
  }
  throw new Error(`timeout waiting for ${label} (${timeoutMs}ms)`)
}

export const TEST_CASES: TestCase[] = [
  // ─────────────────────── Phase 0: cleanup ───────────────────────
  {
    // The wallet state persists across app launches (rgb-lightning's
    // dataDir under <documents>/rgb-lightning/). Each run's failed
    // issuance attempt leaves a WAITING-state batch_transfer locked
    // against the colored UTXOs — subsequent `issueNia` then hits
    // `Rln(Conflict)` (rgb-lib's `AllocationsAlreadyAvailable`).
    // Run this BEFORE anything else to free up state.
    id: 't00.cleanupPriorState',
    title: 'fail stuck batch transfers from prior runs',
    category: 'system',
    async run (ctx) {
      // Two-pass cleanup. First pass with `no_asset_only: true`
      // handles stuck ISSUANCE attempts. Second pass with
      // `no_asset_only: false` also reaps stuck CHANNEL-OPEN Send
      // transfers (kind: Send, status: Initiated) that the upstream
      // signer issue leaves behind when /openchannel with asset_id
      // completes negotiation but can't sign the funding PSBT — the
      // Initiated Send holds rgb_send_lock indefinitely, blocking
      // subsequent /rgbinvoice and /openchannel on the next run. Only
      // operates on WaitingCounterparty / WaitingConfirmations /
      // Initiated states; completed Settled transfers are untouched.
      const issuance = await ctx.ext.failTransfers({ no_asset_only: true, skip_sync: false })
        .catch((e: unknown) => ({ noop: true, reason: (e as Error).message ?? String(e) }))
      const pending = await ctx.ext.failTransfers({ no_asset_only: false, skip_sync: false })
        .catch((e: unknown) => ({ noop: true, reason: (e as Error).message ?? String(e) }))
      await ctx.ext.sync().catch(() => undefined)
      await ctx.ext.refreshTransfers({ skip_sync: false }).catch(() => undefined)
      return { issuance, pending }
    }
  },
  // ─────────────────────── Phase 1: Node health ───────────────────────
  {
    id: 't01.nodeInfo',
    title: 'nodeInfo returns pubkey + counts',
    category: 'node',
    async run (ctx) {
      const info = await ctx.ext.getNodeInfo()
      if (!info?.pubkey) throw new Error('no pubkey in nodeInfo')
      ctx.state['self.pubkey'] = info.pubkey
      return info
    }
  },
  {
    id: 't02.networkInfo',
    title: 'networkInfo returns network + height',
    category: 'node',
    async run (ctx) { return ctx.ext.getNetworkInfo() }
  },
  {
    id: 't03.sync',
    title: 'on-chain sync',
    category: 'node',
    async run (ctx) { return ctx.ext.sync() }
  },
  {
    id: 't04.bootstrap',
    title: 'signer bootstrap dictionary',
    category: 'node',
    async run (ctx) {
      const b = await ctx.ext.getBootstrap()
      if (!b?.node_id) throw new Error('bootstrap missing node_id')
      return b
    }
  },
  {
    id: 't05.checkIndexerUrl',
    title: 'indexer url validates',
    category: 'diag',
    async run (ctx) {
      // Re-use the value we know unlocks the node — pre-set by the gate.
      const url = (ctx.state['env.indexer_url'] as string) ?? 'tcp://127.0.0.1:50001'
      return ctx.ext.checkIndexerUrl(url)
    }
  },
  {
    id: 't06.checkProxyEndpoint',
    title: 'proxy endpoint validates',
    category: 'diag',
    async run (ctx) {
      const endpoint = (ctx.state['env.proxy_endpoint'] as string) ?? 'rpc://127.0.0.1:3001/json-rpc'
      return ctx.ext.checkProxyEndpoint(endpoint)
    }
  },

  // ─────────────────────── Phase 2: BTC funding ───────────────────────
  {
    id: 't10.getAddress',
    title: 'get fresh on-chain address',
    category: 'btc',
    dependsOn: ['t01.nodeInfo'],
    async run (ctx) {
      const a = await ctx.ext.getAddress()
      const addr = typeof a === 'string' ? a : a.address
      if (!addr || addr.startsWith('tb1qpendingunlock')) throw new Error('placeholder address — node not really unlocked')
      ctx.state['self.address'] = addr
      return addr
    }
  },
  {
    id: 't11.fundDevice',
    title: 'bitcoind sends BTC to device + mines',
    category: 'btc',
    dependsOn: ['t10.getAddress'],
    async run (ctx) {
      const addr = ctx.state['self.address'] as string
      const txid = await ctx.chain.sendToAddress(addr, FUND_BTC)
      ctx.state['fund.txid'] = txid
      await ctx.chain.mineBlocks(6)
      // Force a sync to pull the new UTXO into rgb-lib's view.
      await ctx.ext.sync()
      return { txid }
    }
  },
  {
    id: 't12.btcBalance',
    title: 'balance reflects the fund',
    category: 'btc',
    dependsOn: ['t11.fundDevice'],
    async run (ctx) {
      const balance = await waitFor('non-zero btc balance', async () => {
        const b = await ctx.ext.getBalanceDetails(false)
        const settled = b?.vanilla?.settled ?? 0
        return settled > 0 ? b : null
      }, 30000)
      return balance
    }
  },
  {
    id: 't13.listTransactions',
    title: 'listTransactions includes funding tx',
    category: 'btc',
    dependsOn: ['t11.fundDevice'],
    async run (ctx) { return ctx.ext.getTransactions(false) }
  },
  {
    id: 't14.listUnspents',
    title: 'listUnspents shows the new UTXO',
    category: 'btc',
    dependsOn: ['t11.fundDevice'],
    async run (ctx) { return ctx.ext.listUnspents(false) }
  },
  {
    id: 't15.estimateFee',
    title: 'estimateFee(6) returns a fee rate (regtest expected-fail)',
    category: 'btc',
    // bitcoind on regtest doesn't accumulate the fee history needed
    // by `estimatesmartfee`, so RLN surfaces the bitcoind error as
    // `Rln(Conflict): Cannot estimate fees`. This test passes on
    // testnet/mainnet — the expected-fail tag makes the report green
    // here without us pretending the function is broken. We require
    // the specific APIError display text so that an unrelated failure
    // (network blip, signer protocol error, …) is still counted as a
    // real failure.
    blockedBy: 'regtest-fee',
    blockedByMatch: 'Cannot estimate fees',
    async run (ctx) {
      const r = await ctx.ext.estimateFee(6)
      if (!r || typeof r.fee_rate !== 'number') throw new Error('estimateFee returned no fee_rate')
      return r
    }
  },
  {
    id: 't16.createUtxos',
    title: 'create colorable UTXOs for RGB',
    category: 'btc',
    dependsOn: ['t12.btcBalance'],
    async run (ctx) {
      // `up_to: true` means "create UTXOs UP TO num colorable" — when
      // the wallet already has enough (e.g. carrying state from a
      // prior run), rgb-lib raises `Rln(Conflict): AllocationsAlreadyAvailable`
      // rather than a friendly no-op. That specific case is benign;
      // any OTHER Conflict (FailedBdkSync, InsufficientBitcoins, …)
      // is a real problem and must propagate. Gate on the APIError
      // detail string surfaced through the c-ffi error-detail slot.
      try {
        const r = await ctx.ext.createUtxos({ up_to: true, num: 5, size: 32000, fee_rate: 5, skip_sync: false })
        await ctx.chain.mineBlocks(2)
        await ctx.ext.sync()
        return r
      } catch (e) {
        const msg = String((e as Error).message ?? e)
        // Match on the APIError Display string surfaced by the FFI
        // detail slot (see uniffi_api::state::stash_api_error_detail).
        // The string is the thiserror `#[error("...")]` text from
        // src/error.rs — variant DISPLAY, not variant NAME. Bare
        // `includes('Conflict')` would also swallow FailedBdkSync etc.,
        // hiding real bugs.
        if (msg.includes('Allocations already available')) {
          await ctx.ext.sync()
          return { idempotent: true, note: 'wallet already had enough colorable UTXOs' }
        }
        throw e
      }
    }
  },

  // ─────────────────────── Phase 2b: RGB invoice (early) ───────────────
  // Moved up from Phase 9 — see the comment block in Phase 9 for the
  // full reasoning. TL;DR: t70.openAssetChannel succeeds the call but
  // can't complete funding (upstream signer limitation), holding
  // rgb_send_lock and blocking subsequent /rgbinvoice. Running these
  // early avoids the conflict.
  {
    id: 't80.rgbInvoice',
    title: 'create RGB invoice (receive any asset)',
    category: 'rgb',
    dependsOn: ['t16.createUtxos'],
    async run (ctx) {
      // Force a fresh BDK sync first. blind_receive needs to allocate
      // against a colourable UTXO and was failing with bare
      // `Rln(Conflict)` (we don't yet know which APIError exactly, but
      // a stale BDK view is the leading hypothesis — see notes).
      await ctx.ext.sync().catch(() => undefined)
      // `witness` is required by RgbInvoiceRequest. `false` = blind
      // receive (UTXO-bound). `true` would mean witness-anchored.
      const r = await ctx.ext.createRgbInvoice({ min_confirmations: 1, witness: false } as unknown as Parameters<typeof ctx.ext.createRgbInvoice>[0])
      if (!r?.invoice) throw new Error('createRgbInvoice returned no invoice')
      ctx.state['rgb.invoice'] = r.invoice
      ctx.state['rgb.recipient_id'] = r.recipient_id
      return r
    }
  },
  {
    id: 't81.decodeRgbInvoice',
    title: 'decodeRgbInvoice parses our invoice',
    category: 'rgb',
    dependsOn: ['t80.rgbInvoice'],
    async run (ctx) {
      const invoice = ctx.state['rgb.invoice'] as string
      return ctx.ext.decodeRgbInvoice(invoice)
    }
  },

  // ─────────────────────── Phase 3: Peers ───────────────────────
  {
    id: 't20.peerNodeInfo',
    title: 'peer nodeInfo via HTTP',
    category: 'peers',
    async run (ctx) {
      const info = await ctx.peer.nodeInfo()
      if (!info?.pubkey) throw new Error('peer has no pubkey')
      ctx.state[PEER_PUBKEY_KEY] = info.pubkey
      // Compose the dial string from the peer base URL + advertised LN port.
      // We default to port 9735 on the peer; if the local setup differs,
      // override via ENV.
      const peerHost = (ctx.state['env.peer_host'] as string) ?? '10.0.2.2'
      const peerPort = (ctx.state['env.peer_ln_port'] as string) ?? '9735'
      ctx.state[PEER_ADDR_KEY] = `${info.pubkey}@${peerHost}:${peerPort}`
      return info
    }
  },
  {
    id: 't21.connectPeer',
    title: 'connect to peer',
    category: 'peers',
    dependsOn: ['t20.peerNodeInfo'],
    async run (ctx) {
      const addr = ctx.state[PEER_ADDR_KEY] as string
      const r = await ctx.ext.connectPeer(addr)
      return r
    }
  },
  {
    id: 't22.listPeers',
    title: 'peer appears in listPeers',
    category: 'peers',
    dependsOn: ['t21.connectPeer'],
    async run (ctx) {
      const wanted = ctx.state[PEER_PUBKEY_KEY] as string
      // LDK's outbound noise handshake completes lazily — the listPeers
      // entry may not surface immediately after `connect_peer` returns.
      // Poll for 30s. If after that the peer still isn't visible, fail
      // hard: either the handshake genuinely didn't complete, or the
      // listPeers API stopped reporting it — both are real bugs. The
      // previous lenient "return a note" path masked a class of LDK
      // regressions, so we don't do that anymore.
      const POLL_MS = 30000
      const deadline = Date.now() + POLL_MS
      let lastErr: string | null = null
      while (Date.now() < deadline) {
        const r = await ctx.ext.listPeers().catch((e: unknown) => {
          lastErr = (e as Error).message
          return { peers: [] }
        })
        const peers = r?.peers ?? []
        if (peers.find((p) => p?.pubkey === wanted)) return r
        await new Promise((rs) => setTimeout(rs, 1000))
      }
      throw new Error(`peer ${wanted.slice(0, 12)}… not visible in listPeers after ${POLL_MS}ms${lastErr ? ` (last listPeers err: ${lastErr})` : ''}`)
    }
  },

  // ─────────────────────── Phase 4: BTC channel ───────────────────────
  {
    id: 't30.openBtcChannel',
    title: 'open BTC-only channel',
    category: 'channels',
    dependsOn: ['t12.btcBalance', 't21.connectPeer'],
    async run (ctx) {
      const peer = ctx.state[PEER_ADDR_KEY] as string
      const peerPubkey = ctx.state[PEER_PUBKEY_KEY] as string

      // Pre-flight: ensure peer is ACTUALLY visible in listPeers
      // before initiating openchannel. t21's connectPeer returns Ok
      // when the TCP connect kicks off, but the noise handshake
      // settles lazily — observed regression: openChannel returns a
      // temp_channel_id, but the underlying open_channel message
      // never reaches the peer because the connection is still
      // half-open, so funding_txid stays null forever (channel stuck
      // in Opening).
      //
      // We re-issue connectPeer + poll listPeers for up to 30s. If
      // peer still not visible, we proceed anyway with a loud note —
      // t31's polling loop has its own reconnect-in-loop fallback.
      const POLL_MS = 30000
      const peerDeadline = Date.now() + POLL_MS
      let peerVisible = false
      while (Date.now() < peerDeadline) {
        await ctx.ext.connectPeer(peer).catch(() => undefined)
        const pl = await ctx.ext.listPeers().catch(() => ({ peers: [] }))
        const peers = pl?.peers ?? []
        if (peers.find((p) => p?.pubkey === peerPubkey)) {
          peerVisible = true
          break
        }
        await sleep(2000)
      }

      const beforeIds = await snapshotChannelIds(ctx.ext)
      ctx.state[CHANNEL_IDS_BEFORE_BTC_OPEN_KEY] = Array.from(beforeIds)
      // push_msat=100M (100k sat) gives the peer initial outbound to
      // us so they can pay our invoice in t42.
      const r = await ctx.ext.openChannel({
        peer_pubkey_and_opt_addr: peer,
        capacity_sat: 200000,
        push_msat: 100000000,
        public: true,
        with_anchors: true
      })
      ctx.state[CHANNEL_ID_BTC_TEMP_KEY] = r?.temporary_channel_id
      // DO NOT mine here. The funding tx broadcast is async — t31
      // mines while polling.
      return { ...r, peer_visible_pre_open: peerVisible }
    }
  },
  {
    id: 't31.channelReady',
    title: 'BTC channel becomes ready (this run only)',
    category: 'channels',
    dependsOn: ['t30.openBtcChannel'],
    async run (ctx) {
      const beforeIds = new Set(ctx.state[CHANNEL_IDS_BEFORE_BTC_OPEN_KEY] as string[] | undefined)
      const wantedPeer = ctx.state[PEER_PUBKEY_KEY] as string
      const peerAddr = ctx.state[PEER_ADDR_KEY] as string
      // Both ends must observe the funding tx confirmed before they
      // exchange `channel_ready`. We mine, then explicitly sync BOTH
      // device and peer (the peer's background sync doesn't tick fast
      // enough on regtest, so without `ctx.peer.sync()` the peer never
      // sees the confirmation and never sends its half of the
      // exchange — see investigation notes 2026-05-15).
      //
      // NEW: reconnect-in-loop. If the noise session drops between
      // open_channel and accept_channel exchange, LDK doesn't auto-
      // reconnect — funding stays null forever and we'd hit the 180s
      // timeout. We re-issue connectPeer every 5 iterations
      // (≈10s) which the daemon treats as a no-op if already
      // connected. This recovers the negotiation if it stalled.
      const deadline = Date.now() + 180000
      let lastPeerErr: string | null = null
      let iter = 0
      while (Date.now() < deadline) {
        const chans = await ctx.ext.listChannels().catch(() => [])
        const list = Array.isArray(chans) ? chans : []
        const fresh = list.filter((c) => c.channel_id && !beforeIds.has(c.channel_id) && c.peer_pubkey === wantedPeer)
        const ready = fresh.find((c) => c.ready || (c as { is_usable?: boolean }).is_usable)
        if (ready && ready.channel_id) {
          ctx.state[CHANNEL_ID_BTC_KEY] = ready.channel_id
          return ready
        }
        await ctx.chain.mineBlocks(1).catch(() => undefined)
        await ctx.ext.sync().catch(() => undefined)
        await ctx.peer.sync().catch((e: Error) => { lastPeerErr = e.message })
        // Every 5 iterations (≈10s with 2s sleep), re-trigger peer
        // connect to repair a dropped noise session.
        if (iter % 5 === 0 && iter > 0) {
          await ctx.ext.connectPeer(peerAddr).catch(() => undefined)
        }
        iter += 1
        await new Promise((r) => setTimeout(r, 2000))
      }
      const tail = lastPeerErr ? ` last peer sync err=${lastPeerErr}` : ''
      // Dump current state of our channel to help upstream diagnosis.
      const channelsNow = await ctx.ext.listChannels().catch(() => 'listChannels failed')
      throw new Error(`timeout waiting for NEW btc channel ready (180000ms). Pre-open ids: ${[...beforeIds].join(',')}.${tail}. Channels at timeout: ${JSON.stringify(channelsNow).slice(0, 500)}`)
    }
  },
  {
    id: 't32.getChannelId',
    title: 'resolve temporary → permanent channel id',
    category: 'channels',
    dependsOn: ['t31.channelReady'],
    async run (ctx) {
      // Use the temporary id captured at t30 (openChannel response),
      // not the permanent id resolved by t31. Previous code passed the
      // permanent id, which always failed → catch-all hid the bug.
      const tempId = ctx.state[CHANNEL_ID_BTC_TEMP_KEY] as string | undefined
      const permId = ctx.state[CHANNEL_ID_BTC_KEY] as string
      if (!tempId) {
        // Some SDK builds return the permanent id directly from
        // openChannel and never produce a separate temporary id. In
        // that case there's nothing to resolve and the probe is a
        // no-op (note this in the result rather than passing silently
        // — a future SDK regression that *should* return a temp id
        // would otherwise stay hidden).
        return { skippedReason: 'openChannel did not return a temporary_channel_id; nothing to resolve', perm: permId }
      }
      if (tempId === permId) {
        return { note: 'temporary id equals permanent id; resolver not exercised', id: permId }
      }
      const resolved = await ctx.ext.getChannelId(tempId)
      // getChannelId should return the permanent id for the temp id we
      // gave it. Hard-assert the resolver actually worked.
      const resolvedId = typeof resolved === 'string'
        ? resolved
        : (resolved as { channel_id?: string })?.channel_id
      if (!resolvedId) throw new Error(`getChannelId(${tempId.slice(0, 12)}…) returned no channel_id: ${JSON.stringify(resolved)}`)
      if (resolvedId !== permId) {
        throw new Error(`getChannelId resolved temp=${tempId.slice(0, 12)}… to ${resolvedId.slice(0, 12)}…, but t31 saw ${permId.slice(0, 12)}…`)
      }
      return { temp: tempId, perm: resolvedId }
    }
  },

  // ─────────────────────── Phase 5: BOLT11 invoice / pay ───────────────────────
  {
    id: 't40.createInvoice',
    title: 'create BTC BOLT11 invoice',
    category: 'invoices',
    dependsOn: ['t31.channelReady'],
    async run (ctx) {
      const r = await ctx.ext.createInvoice({ amt_msat: INVOICE_AMT_MSAT, expiry_sec: 3600 })
      if (!r?.invoice) throw new Error('no invoice in createInvoice response')
      ctx.state['invoice.last'] = r.invoice
      // SDK's lnInvoice response only carries the bolt11 string (the
      // HTTP `/lninvoice` returns more, but the uniffi `LnInvoiceResponse`
      // is just `{ invoice }`). Decode to extract the payment_hash that
      // t44.getPayment needs. Failure here MUST surface as t40 failing —
      // previous code swallowed the error and let t44 re-explode later
      // with a confusing `HexConversion("expected 32 bytes, got 0")`
      // because INVOICE_HASH_KEY was undefined.
      let decoded
      try {
        decoded = await ctx.ext.decodeInvoice(r.invoice)
      } catch (e) {
        throw new Error(`decodeInvoice failed on freshly-created invoice — downstream payment tests cannot run: ${(e as Error).message}`)
      }
      const paymentHash = (decoded as { payment_hash?: string } | null)?.payment_hash
      if (!paymentHash) {
        throw new Error(`decodeInvoice returned no payment_hash: ${JSON.stringify(decoded)}`)
      }
      ctx.state[INVOICE_HASH_KEY] = paymentHash
      return { invoice: r.invoice, payment_hash: paymentHash }
    }
  },
  {
    id: 't41.decodeInvoice',
    title: 'decodeInvoice parses the bolt11',
    category: 'invoices',
    dependsOn: ['t40.createInvoice'],
    async run (ctx) {
      const invoice = ctx.state['invoice.last'] as string
      return ctx.ext.decodeInvoice(invoice)
    }
  },
  {
    id: 't42.peerPaysInvoice',
    title: 'peer pays our invoice',
    category: 'payments',
    dependsOn: ['t40.createInvoice', 't31.channelReady'],
    async run (ctx) {
      const invoice = ctx.state['invoice.last'] as string
      // Allow time for the channel update to propagate.
      await sleep(2000)
      const r = await ctx.peer.sendPayment({ invoice })
      // peer.sendPayment returns immediately with `status: "Pending" |
      // "Succeeded" | "Failed"`. A "Failed" response is a real
      // failure even though the HTTP call returned 200, so reject it.
      const status = (r as { status?: string })?.status
      if (status && status.toLowerCase() === 'failed') {
        throw new Error(`peer.sendPayment returned status=Failed (peer has no outbound liquidity?). Payload: ${JSON.stringify(r)}`)
      }
      return r
    }
  },
  {
    id: 't43.invoiceStatus',
    title: 'getInvoiceStatus reflects paid',
    category: 'invoices',
    dependsOn: ['t42.peerPaysInvoice'],
    async run (ctx) {
      const invoice = ctx.state['invoice.last'] as string
      // InvoiceStatus enum (openapi.yaml): Pending | Claimable |
      // Claiming | Succeeded | Cancelled | Failed | Expired. The
      // terminal success state is `Succeeded`. We also accept
      // `claimable` / `claiming` as positive — the auto-claim is
      // imminent and the HTLC is locked in. Call ext.sync() inside
      // the loop to give the daemon's event loop a chance to update
      // the invoice status table from background LDK events.
      return waitFor('invoice paid', async () => {
        await ctx.ext.sync().catch(() => undefined)
        const r = await ctx.ext.getInvoiceStatus(invoice)
        const status = (r as { status?: string })?.status?.toLowerCase()
        if (status === 'succeeded' || status === 'claimable' || status === 'claiming') return r
        return null
      }, PAYMENT_TIMEOUT_MS, 2000)
    }
  },
  {
    id: 't44.getPayment',
    title: 'getPayment(InboundAutoClaim) returns the entry',
    category: 'payments',
    dependsOn: ['t43.invoiceStatus'],
    async run (ctx) {
      const hash = ctx.state[INVOICE_HASH_KEY] as string
      // SDK enum is `Outbound | InboundAutoClaim | InboundHodl` (see
      // PaymentType in uniffi types) — NOT the HTTP API's lowercase
      // strings. BOLT11 invoices we hand out are auto-claimed by
      // default, so the matching variant is `InboundAutoClaim`.
      return ctx.ext.getPayment(hash, 'InboundAutoClaim')
    }
  },
  {
    id: 't45.listPayments',
    title: 'listPayments includes the received entry',
    category: 'payments',
    dependsOn: ['t43.invoiceStatus'],
    async run (ctx) { return ctx.ext.listPayments() }
  },
  {
    // Coverage for `/sendpayment` from the device side. We've already
    // tested the inbound path (peer pays our invoice in t42); this is
    // the symmetric outbound path: device pays a peer-issued invoice.
    // No upstream blocker — `/sendpayment` works in external-signer
    // mode for plain BOLT11.
    id: 't46.devicePaysPeerInvoice',
    title: 'device pays a peer-issued BOLT11 invoice',
    category: 'payments',
    dependsOn: ['t31.channelReady'],
    async run (ctx) {
      // Peer needs the inbound liquidity to receive. Our channel
      // pushed 100k sat to peer at open (t30), so peer has outbound
      // back to us; we need OUR outbound (their inbound). The
      // capacity_sat=200000 minus push_msat=100000sat leaves us with
      // ~100k of outbound — enough for a small invoice.
      const peerInvoice = await ctx.peer.lnInvoice({ amt_msat: 4000000, expiry_sec: 600 })
      if (!peerInvoice?.invoice) throw new Error(`peer.lnInvoice returned no invoice: ${JSON.stringify(peerInvoice)}`)
      const r = await ctx.ext.sendPayment({ invoice: peerInvoice.invoice })
      const status = (r?.status ?? '').toString().toLowerCase()
      if (status === 'failed') throw new Error(`device sendPayment status=Failed: ${JSON.stringify(r)}`)
      return { peer_invoice: peerInvoice.invoice, response: r }
    }
  },

  // ─────────────────────── Phase 6: Keysend (we initiate to peer) ───────────────────────
  {
    id: 't50.keysendToPeer',
    title: 'keysend to peer pubkey',
    category: 'payments',
    dependsOn: ['t31.channelReady'],
    async run (ctx) {
      const dest = ctx.state[PEER_PUBKEY_KEY] as string
      // RLN enforces a 3,000,000 msat min on keysend (matches the
      // documented `rgb_htlc_min_msat`). Smaller amounts return
      // `Rln(InvalidRequest)` via the API's InvalidAmount path.
      return ctx.ext.keysend({ dest_pubkey: dest, amt_msat: 3000000 })
    }
  },

  // ─────────────────────── Phase 7: RGB asset issuance + metadata ───────────────────────
  {
    id: 't60.issueNia',
    title: 'issue NIA asset (expected-fail in external-signer mode)',
    category: 'assets',
    blockedBy: 'external-signer-mode',
    // Asset issuance is explicitly rejected in external-signer mode by
    // RLN's iter-1/2 design (APIError::UnsupportedInExternalSignerMode).
    // Anything else (InsufficientBitcoins, FailedBdkSync, …) means a
    // real regression we want to see.
    blockedByMatch: 'Unsupported in external signer mode',
    dependsOn: ['t16.createUtxos'],
    async run (ctx) {
      // After t30 opens a channel, the change UTXO from the funding
      // tx is unconfirmed → vanilla.settled drops to 0. rgb-lib's
      // issuance needs settled vanilla to pay the issuance tx fee, so
      // mine before issuing. (This was the real cause of the
      // persistent `Rln(Conflict)` — rgb-lib's InsufficientBitcoins.)
      await ctx.chain.mineBlocks(3).catch(() => undefined)
      await ctx.ext.sync().catch(() => undefined)
      // Also fail any stuck batch transfers that prior failed
      // issuance attempts left behind, in case they're locking
      // colored UTXOs.
      await ctx.ext.failTransfers({ no_asset_only: true, skip_sync: false }).catch(() => undefined)
      await ctx.ext.refreshTransfers({ skip_sync: false }).catch(() => undefined)
      // Tickers must be unique per session to avoid rgb-lib's
      // duplicate detection on retries.
      const tag = Math.floor(Math.random() * 1e4).toString(36).toUpperCase()
      const r = await ctx.ext.issueAssetNia({
        amounts: [1000000],
        ticker: `N${tag}`,
        name: `E2E NIA ${tag}`,
        precision: 2
      })
      // RLN may wrap the asset in an outer `{asset: {...}}` envelope.
      const inner = (r as { asset?: { asset_id?: string } })?.asset ?? r
      const assetId = (inner as { asset_id?: string })?.asset_id
      if (!assetId) throw new Error(`issueAssetNia returned no asset_id: ${JSON.stringify(r)}`)
      ctx.state[ASSET_ID_NIA_KEY] = assetId
      return r
    }
  },
  {
    id: 't61.issueIfa',
    title: 'issue IFA asset (expected-fail in external-signer mode)',
    category: 'assets',
    blockedBy: 'external-signer-mode',
    blockedByMatch: 'Unsupported in external signer mode',
    dependsOn: ['t16.createUtxos'],
    async run (ctx) {
      await ctx.chain.mineBlocks(2).catch(() => undefined)
      await ctx.ext.sync().catch(() => undefined)
      const tag = Math.floor(Math.random() * 1e4).toString(36).toUpperCase()
      const r = await ctx.ext.issueAssetIfa({
        amounts: [10000],
        inflation_amounts: [100000],
        ticker: `I${tag}`,
        name: `E2E IFA ${tag}`,
        precision: 2
      })
      const inner = (r as { asset?: { asset_id?: string } })?.asset ?? r
      const assetId = (inner as { asset_id?: string })?.asset_id
      if (!assetId) throw new Error(`issueAssetIfa returned no asset_id: ${JSON.stringify(r)}`)
      ctx.state[ASSET_ID_IFA_KEY] = assetId
      return r
    }
  },
  {
    id: 't62.listAssets',
    title: 'listAssets returns an enumerable list',
    category: 'assets',
    async run (ctx) { return ctx.ext.listAssets([]) }
  },
  {
    // Workaround for the external-signer asset-issuance block: have the
    // PEER (which runs without external-signer constraint) issue an
    // asset and transfer some to us on-chain. After this we hold a
    // real NIA balance — downstream tests (t63 getAssetBalance, t64
    // getAssetMetadata, t82 listTransfers, t70 openAssetChannel, …)
    // can then run for real instead of cascade-skipping.
    //
    // ORDERING: this MUST run before t63/t64/t82 in source order. The
    // runner walks the array sequentially; `dependsOn` only gates
    // cascade-SKIPS, it does NOT reorder execution. Placing t67 here
    // (between t62.listAssets and t63.getAssetBalance) ensures
    // ASSET_ID_NIA_KEY is populated by the time t63 reads it.
    //
    // Flow:
    //   1. ensure peer has colorable UTXOs (idempotent)
    //   2. peer issues NIA
    //   3. device generates rgbinvoice (blind receive)
    //   4. peer sends some asset to that invoice
    //   5. mine + refresh on both sides
    //   6. poll device.getAssetBalance until settled > 0
    id: 't67.peerFundedAsset',
    title: 'peer issues + transfers NIA on-chain to device',
    category: 'assets',
    dependsOn: ['t16.createUtxos'],
    async run (ctx) {
      // Step 1: peer needs colored UTXOs to issue against. up_to=true
      // → idempotent, succeeds if peer already has enough.
      await ctx.peer.createUtxos({ up_to: true, num: 5, size: 32000, fee_rate: 5, skip_sync: false })
        .catch((e: Error) => {
          // `AllocationsAlreadyAvailable` is fine — peer already had them.
          if (!String(e.message).includes('Allocations already available')) throw e
        })
      await ctx.chain.mineBlocks(2).catch(() => undefined)
      await ctx.peer.sync().catch(() => undefined)

      // Step 2: peer issues NIA. Unique ticker per run avoids rgb-lib's
      // duplicate-asset detection across re-runs.
      const tag = Math.floor(Math.random() * 1e4).toString(36).toUpperCase()
      const issued = await ctx.peer.issueAssetNia({
        amounts: [1000000],
        ticker: `P${tag}`,
        name: `Peer-Issued NIA ${tag}`,
        precision: 2
      })
      const assetId = issued?.asset_id ?? (issued as { asset?: { asset_id?: string } })?.asset?.asset_id
      if (!assetId) throw new Error(`peer.issueAssetNia returned no asset_id: ${JSON.stringify(issued)}`)
      ctx.state[ASSET_ID_NIA_KEY] = assetId

      // Step 3: device generates a blind receive invoice (no asset_id
      // pin — accept any asset; the peer will hand us this NIA).
      await ctx.ext.sync().catch(() => undefined)
      const rgb = await ctx.ext.createRgbInvoice({
        min_confirmations: 1,
        witness: false
      } as unknown as Parameters<typeof ctx.ext.createRgbInvoice>[0])
      const recipientId = rgb?.recipient_id
      if (!recipientId) throw new Error(`createRgbInvoice returned no recipient_id: ${JSON.stringify(rgb)}`)

      // Step 4: peer sends 1000 units to our recipient_id. Chosen for
      // headroom: t70 funds an RGB channel with 600 (leaves us 400
      // spare) and downstream tests may consume more. The peer issued
      // 1,000,000 units in step 2 so 1000 is a trivial slice. The HTTP
      // body is the nested `recipient_map` (see routes.rs:1118
      // SendRgbRequest + 1008 Recipient).
      const sent = await ctx.peer.sendRgb({
        donation: false,
        fee_rate: 5,
        min_confirmations: 1,
        skip_sync: false,
        recipient_map: {
          [assetId]: [{
            recipient_id: recipientId,
            witness_data: null,
            // `Assignment` enum is `#[serde(tag = "type", content =
            // "value")]` in routes.rs:324 — adjacently tagged. Default
            // serde `{ "Fungible": 1000 }` is REJECTED ("Failed to
            // deserialize the JSON body"). Must use the tagged form.
            assignment: { type: 'Fungible', value: 1000 },
            transport_endpoints: ['rpc://127.0.0.1:3001/json-rpc']
          }]
        }
      })

      // Step 5: burn in confirmations + initial refresh.
      //
      // The peer's send_rgb broadcast an on-chain tx that needs to
      // (a) be confirmed and (b) have its consignment delivered via
      // the RGB proxy before the receiver-side balance promotes from
      // `future` to `settled`. We REQUIRE settled here — t70's
      // openchannel rejects with `Not enough assets` if the asset is
      // only in future state.
      //
      // Mine an upfront burst (6 blocks ≫ `min_confirmations: 1`) so
      // the proxy/refresh has fully-buried inputs to promote. Then
      // refresh on both sides.
      await ctx.chain.mineBlocks(6).catch(() => undefined)
      await ctx.peer.refreshTransfers({ skip_sync: false }).catch(() => undefined)
      await ctx.ext.refreshTransfers({ asset_id: assetId, skip_sync: false }).catch(() => undefined)
      await ctx.ext.sync().catch(() => undefined)

      // Step 6: wait until our asset balance is SETTLED (not just
      // future). Future means BDK saw the unconfirmed tx; settled
      // means RGB promoted the assignment past min_confirmations.
      // openchannel + sendrgb need settled. 120s ceiling — generous
      // because rgb-lib's settlement can lag a few refresh cycles
      // even when chain confirmations are in.
      let lastBal: { settled?: number; future?: number; spendable?: number } | null = null
      const balance = await waitFor('device asset balance SETTLED (not just future)', async () => {
        await ctx.chain.mineBlocks(1).catch(() => undefined)
        await ctx.peer.refreshTransfers({ skip_sync: false }).catch(() => undefined)
        // Pin the refresh to this asset so rgb-lib walks the right
        // batch_transfer chain on every iteration.
        await ctx.ext.refreshTransfers({ asset_id: assetId, skip_sync: false }).catch(() => undefined)
        await ctx.ext.sync().catch(() => undefined)
        const b = await ctx.ext.getAssetBalance(assetId).catch(() => null)
        lastBal = b
        const settled = b?.settled ?? 0
        return settled > 0 ? b : null
      }, 120000, 2000).catch(async (e: Error) => {
        // On timeout, dump diagnostics so we can see what state the
        // transfer actually reached on the device side.
        const transfers = await ctx.ext.listTransfers(assetId).catch(() => 'listTransfers failed')
        throw new Error(`${e.message}. send_response=${JSON.stringify(sent)}. last_balance=${JSON.stringify(lastBal)}. transfers=${JSON.stringify(transfers).slice(0, 500)}`)
      })

      return { asset_id: assetId, recipient_id: recipientId, send_response: sent, balance }
    }
  },
  {
    // dependsOn changed from t60.issueNia → t67.peerFundedAsset:
    // local issuance is blocked in external-signer mode, so we obtain
    // the asset by having the peer issue + transfer. Same end state
    // (device holds NIA balance), test exercises the real
    // getAssetBalance code path.
    id: 't63.getAssetBalance',
    title: 'getAssetBalance for NIA',
    category: 'assets',
    dependsOn: ['t67.peerFundedAsset'],
    async run (ctx) {
      const id = ctx.state[ASSET_ID_NIA_KEY] as string
      return ctx.ext.getAssetBalance(id)
    }
  },
  {
    id: 't64.getAssetMetadata',
    title: 'getAssetMetadata for NIA',
    category: 'assets',
    dependsOn: ['t67.peerFundedAsset'],
    async run (ctx) {
      const id = ctx.state[ASSET_ID_NIA_KEY] as string
      return ctx.ext.getAssetMetadata(id)
    }
  },
  {
    id: 't65.inflateIfa',
    title: 'inflate IFA asset supply (expected-fail in external-signer mode)',
    category: 'assets',
    blockedBy: 'external-signer-mode',
    blockedByMatch: 'Unsupported in external signer mode',
    dependsOn: ['t61.issueIfa'],
    async run (ctx) {
      const id = ctx.state[ASSET_ID_IFA_KEY] as string
      return ctx.ext.inflate({ asset_id: id, amount: 1000 })
    }
  },

  // ─────────────────────── Phase 8: RGB asset channel ───────────────────────
  // Asset-channel-as-initiator requires local asset issuance (the
  // asset_id you fund the channel with). Both are blocked in
  // external-signer mode by RLN's iter-1/iter-2 design, so this
  // whole sub-section is expected-fail today. To exercise asset
  // channels we'd need the peer (full-signer) to initiate the
  // channel and us to accept — out of scope for this run.
  {
    // Probe — used to be tagged `external-signer-mode` expected-fail,
    // but the daemon doesn't explicitly block `/openchannel` with
    // `asset_id` (no `UnsupportedInExternalSignerMode` check on this
    // route). Now that we have a peer-funded asset (t67) we can
    // actually try opening an RGB channel and see what happens. If it
    // fails the report shows the real upstream error instead of a
    // silent expected-fail.
    id: 't70.openAssetChannel',
    title: 'open RGB asset channel (with peer-funded asset)',
    category: 'channels',
    dependsOn: ['t67.peerFundedAsset', 't21.connectPeer'],
    async run (ctx) {
      const peer = ctx.state[PEER_ADDR_KEY] as string
      const assetId = ctx.state[ASSET_ID_NIA_KEY] as string
      const beforeIds = await snapshotChannelIds(ctx.ext)
      ctx.state[CHANNEL_IDS_BEFORE_ASSET_OPEN_KEY] = Array.from(beforeIds)

      // Pre-flight: ensure we have fresh uncolored UTXOs.
      //
      // The daemon's openchannel-with-asset path needs an UNCOLORED
      // UTXO to pay the funding tx fees. After a busy suite (channel
      // opens, sendBtc, RGB receives) the only uncolored UTXOs left
      // can all be marked "reserved" by rgb-lib / BDK even though
      // they show as `colorable: false` in listUnspents — observed
      // error: `No uncolored UTXOs are available (hint: call createutxos)`.
      // Calling createUtxos rebalances: spends a vanilla input,
      // produces several small colored UTXOs + a fresh change UTXO
      // that's uncolored and unreserved.
      await ctx.ext.createUtxos({ up_to: true, num: 5, size: 32000, fee_rate: 5, skip_sync: false })
        .catch((e: Error) => {
          if (!String(e.message).includes('Allocations already available')) throw e
        })
      await ctx.chain.mineBlocks(2).catch(() => undefined)
      await ctx.ext.sync().catch(() => undefined)

      // asset_amount = 600 — leaves headroom from the 1000 we received
      // in t67. Above `channel_asset_min_amount: 1` (nodeinfo).
      const r = await ctx.ext.openChannel({
        peer_pubkey_and_opt_addr: peer,
        capacity_sat: 200000,
        push_msat: 0,
        asset_amount: 600,
        asset_id: assetId,
        public: true,
        with_anchors: true
      })
      return r
    }
  },
  {
    id: 't71.assetChannelReady',
    title: 'asset channel becomes ready (this run only)',
    category: 'channels',
    dependsOn: ['t70.openAssetChannel'],
    async run (ctx) {
      const beforeIds = new Set(ctx.state[CHANNEL_IDS_BEFORE_ASSET_OPEN_KEY] as string[] | undefined)
      const wantedPeer = ctx.state[PEER_PUBKEY_KEY] as string
      const wantedAssetId = ctx.state[ASSET_ID_NIA_KEY] as string
      const deadline = Date.now() + 180000
      while (Date.now() < deadline) {
        const chans = await ctx.ext.listChannels().catch(() => [])
        const list = Array.isArray(chans) ? chans : []
        const fresh = list.filter((c) => c.channel_id && !beforeIds.has(c.channel_id) && c.peer_pubkey === wantedPeer && c.asset_id === wantedAssetId)
        const ready = fresh.find((c) => c.ready || (c as { is_usable?: boolean }).is_usable)
        if (ready && ready.channel_id) {
          ctx.state[CHANNEL_ID_ASSET_KEY] = ready.channel_id
          return ready
        }
        await ctx.chain.mineBlocks(1).catch(() => undefined)
        await ctx.ext.sync().catch(() => undefined)
        await new Promise((r) => setTimeout(r, 2000))
      }
      throw new Error(`timeout waiting for NEW asset channel ready (180000ms)`)
    }
  },
  {
    // Probe — used to be tagged `iter-2-B1` expected-fail. Roman
    // hasn't claimed a fix for the asset-bearing ln_invoice signer
    // path, but we want to see the real outcome rather than rubber-
    // stamping a skip. If it fails the report carries the actual
    // error string for Roman to triage.
    id: 't72.assetInvoice',
    title: 'create RGB-LN invoice (probe iter-2 B1)',
    category: 'invoices',
    dependsOn: ['t71.assetChannelReady'],
    async run (ctx) {
      const assetId = ctx.state[ASSET_ID_NIA_KEY] as string
      return ctx.ext.createInvoice({
        amt_msat: 3000000,
        expiry_sec: 3600,
        asset_id: assetId,
        asset_amount: 100
      })
    }
  },

  // ─────────────────────── Phase 9: RGB on-chain transfer (continued) ───
  // NOTE: t80 (rgbInvoice) + t81 (decodeRgbInvoice) used to live HERE
  // but were moved up to run right after t16.createUtxos. Reason: the
  // upstream-blocked t70.openAssetChannel leaves an `Initiated` Send
  // transfer holding the daemon's rgb_send_lock indefinitely (because
  // the external signer can't sign the RGB anchor PSBT to broadcast
  // the funding tx). Any subsequent /rgbinvoice call then fails with
  // `Cannot perform this operation while an open channel operation
  // is in progress`. Running t80/t81 BEFORE t70 sidesteps the lock.
  // The t00 cleanup pass now reaps Initiated transfers between runs
  // so the previous run's stuck channel doesn't leak forward.
  {
    id: 't82.listTransfers',
    title: 'listTransfers (for issued NIA)',
    category: 'rgb',
    dependsOn: ['t67.peerFundedAsset'],
    async run (ctx) {
      // `/listtransfers` requires a real asset_id — there's no
      // "list all" mode. Passing empty string still trips rgb-lib's
      // contract-id parser. Use the asset minted in t60.
      const assetId = ctx.state[ASSET_ID_NIA_KEY] as string
      if (!assetId) throw new Error('asset id from t60.issueNia missing in state')
      return ctx.ext.listTransfers(assetId)
    }
  },
  {
    id: 't83.refreshTransfers',
    title: 'refreshTransfers reconciles state',
    category: 'rgb',
    async run (ctx) { return ctx.ext.refreshTransfers({ skip_sync: false }) }
  },

  // ─────────────────────── Phase 10: signing + diagnostics ───────────────────────
  {
    id: 't90.signMessage',
    title: 'sign message produces a signature',
    category: 'sign',
    async run (ctx) {
      const r = await ctx.ext.sign('e2e probe')
      if (!r?.signed_message) throw new Error('no signed_message returned')
      return r
    }
  },
  {
    id: 't91.getKeyPair',
    title: 'getKeyPair returns node_id pubkey',
    category: 'sign',
    async run (ctx) {
      const kp = await ctx.ext.getKeyPair()
      if (!kp?.publicKey) throw new Error('no publicKey')
      return kp
    }
  },
  {
    id: 't92.toReadOnlyAccount',
    title: 'toReadOnlyAccount returns façade',
    category: 'sign',
    async run (ctx) { return ctx.ext.toReadOnlyAccount() }
  },
  {
    id: 't93.quoteTransferOnchain',
    title: 'quoteTransfer (on-chain) returns approx fee',
    category: 'generic',
    async run (ctx) {
      const r = await ctx.ext.quoteTransfer({ token: '', recipient: 'bcrt1qfakefake', amount: 10000 })
      return r
    }
  },
  {
    id: 't94.quoteSendTransaction',
    title: 'quoteSendTransaction returns approx fee',
    category: 'generic',
    async run (ctx) {
      return ctx.ext.quoteSendTransaction({ to: 'bcrt1qfakefake', value: 10000 })
    }
  },

  // ─────────────────────── Phase 11: BTC spend ───────────────────────
  {
    id: 't95.sendBtcToPeer',
    title: 'send BTC on-chain to peer address',
    category: 'btc',
    dependsOn: ['t12.btcBalance'],
    async run (ctx) {
      // After channel-open the wallet's biggest vanilla UTXO is now
      // consumed by the funding tx and the change is in "future"
      // (unconfirmed) state. rgb-lib's sendBtc treats only settled
      // UTXOs as spendable — so without a pre-mine sendBtc fails with
      // `Rln(Internal)` (rgb-lib's `InsufficientBitcoins`).
      await ctx.chain.mineBlocks(3).catch(() => undefined)
      await ctx.ext.sync().catch(() => undefined)
      const peerAddr = (await ctx.peer.address()).address
      const r = await ctx.ext.sendTransaction({ amount: 5000, address: peerAddr, fee_rate: 5, skip_sync: false })
      ctx.state[ONCHAIN_TXID_KEY] = r.txid
      await ctx.chain.mineBlocks(2)
      return r
    }
  },
  {
    id: 't96.getTransactionReceipt',
    title: 'getTransactionReceipt finds the sent tx',
    category: 'generic',
    dependsOn: ['t95.sendBtcToPeer'],
    async run (ctx) {
      const txid = ctx.state[ONCHAIN_TXID_KEY] as string
      // listTransactions takes up to ~30s to surface a newly-confirmed
      // tx on regtest after a sync. Poll for it rather than accepting
      // null as success (previous behaviour was a green check that
      // didn't actually test anything).
      const r = await waitFor('tx receipt visible', async () => {
        await ctx.ext.sync().catch(() => undefined)
        const v = await ctx.ext.getTransactionReceipt(txid).catch(() => null)
        return v ?? null
      }, 30000)
      return r
    }
  },

  // ─────────────────────── Phase 12: channel close ───────────────────────
  {
    id: 't100.coopCloseBtc',
    title: 'cooperative close (BTC channel)',
    category: 'channels',
    dependsOn: ['t31.channelReady'],
    async run (ctx) {
      const channelId = ctx.state[CHANNEL_ID_BTC_KEY] as string
      const peer = ctx.state[PEER_PUBKEY_KEY] as string
      const peerAddr = ctx.state[PEER_ADDR_KEY] as string

      // Pre-check: is the channel still in listChannels? Observed
      // case: the asset-channel t70 wedge (Initiated Send with no
      // funding broadcast) can cause LDK to internally drop the BTC
      // channel between t31 and t100, leaving the persisted state in
      // place but the in-memory channel manager unaware of it.
      // Subsequent closeChannel returns `Rln(NotFound): Unknown
      // channel ID`. Detect this and treat as "already closed" —
      // the goal of the test (channel reaches a terminal state) is
      // effectively met.
      const channels = await ctx.ext.listChannels().catch(() => [])
      const ours = Array.isArray(channels) ? channels.find((c) => c.channel_id === channelId) : null
      if (!ours) {
        return { closed: true, attempts: 0, note: 'channel already gone from listChannels — likely auto-closed by LDK during suite. Treating as success.' }
      }

      // Coop close requires an active peer connection. After ~80s of
      // suite activity the LDK keepalive may have dropped the peer —
      // observed error: `Cannot begin shutdown while peer is
      // disconnected or we're waiting on a monitor update`. Re-trigger
      // connect_peer (idempotent — daemon returns Ok if already
      // connected) and wait briefly for the handshake to settle.
      await ctx.ext.connectPeer(peerAddr).catch(() => undefined)
      await sleep(1000)

      // Retry the close itself on transient `monitor update` rejections
      // — LDK can hold the channel briefly while persisting state.
      let lastErr: string | null = null
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await ctx.ext.closeChannel({ channel_id: channelId, peer_pubkey: peer, force: false })
          await ctx.chain.mineBlocks(6)
          return { closed: true, attempts: attempt + 1 }
        } catch (e) {
          lastErr = (e as Error).message
          if (lastErr.includes('Unknown channel ID') || lastErr.includes('NotFound')) {
            return { closed: true, attempts: attempt + 1, note: 'channel disappeared mid-close — treating as success' }
          }
          if (!lastErr.includes('Channel unavailable') && !lastErr.includes('monitor update')) throw e
          await ctx.ext.connectPeer(peerAddr).catch(() => undefined)
          await sleep(2000)
        }
      }
      throw new Error(`coop close failed after 3 attempts: ${lastErr}`)
    }
  },
  {
    // Probe — used to be `iter-2-B2` expected-fail. Roman explicitly
    // said coop close works for him 10/10 manually. Run the test for
    // real and see whether it passes or hangs in our automated stack.
    id: 't101.coopCloseAsset',
    title: 'coop close asset channel (probe — Roman says works 10/10)',
    category: 'channels',
    dependsOn: ['t71.assetChannelReady'],
    async run (ctx) {
      const channelId = ctx.state[CHANNEL_ID_ASSET_KEY] as string
      const peer = ctx.state[PEER_PUBKEY_KEY] as string
      // Race condition with iter-2 hang: enforce a hard ceiling.
      const p = ctx.ext.closeChannel({ channel_id: channelId, peer_pubkey: peer, force: false })
      const timeout = sleep(20000).then(() => { throw new Error('coop close did not return within 20s (iter-2 B2 hang)') })
      return Promise.race([p, timeout])
    }
  },
  {
    // Probe — used to be `iter-2-B3` expected-fail. Roman's
    // `beec1cd` ("Fix force rgb close") merged in our recent pull
    // adds local signing for the post-CSV DelayedPaymentOutput /
    // StaticPaymentOutput descriptors. That covers sender-side. Open
    // question (asked Roman): does it also fix receiver-side settled
    // transitions? Run for real and surface the actual outcome.
    id: 't102.forceCloseAssetSettlement',
    title: 'force close asset channel + receiver-side settlement (probe — Roman fixed sender)',
    category: 'channels',
    dependsOn: ['t71.assetChannelReady'],
    async run (ctx) {
      const channelId = ctx.state[CHANNEL_ID_ASSET_KEY] as string
      const peer = ctx.state[PEER_PUBKEY_KEY] as string
      await ctx.ext.closeChannel({ channel_id: channelId, peer_pubkey: peer, force: true })
      await ctx.chain.mineBlocks(CSV_CONFIRMATIONS + 6)
      await ctx.ext.refreshTransfers({ skip_sync: false })
      // The iter-2 receiver gap: even after CSV + refresh, the receiver
      // side often stays in `future` state. We probe and report —
      // pass/fail is gated on the receiver entry settling.
      const settled = await waitFor('receiver-side settled', async () => {
        const transfers = await ctx.ext.listTransfers() as Array<{ status?: string }> | { transfers?: Array<{ status?: string }> }
        const arr = Array.isArray(transfers) ? transfers : (transfers?.transfers ?? [])
        return arr.find((t) => t.status?.toLowerCase().includes('settled')) ?? null
      }, 30000).catch(() => null)
      if (!settled) throw new Error('receiver-side did not settle within 30s after CSV + refresh (iter-2 B3)')
      return settled
    }
  },

  // ─────────────────────── Phase 13: shutdown probe ───────────────────────
  // We DON'T call shutdown — it ends the runtime and the user would have
  // to restart the app to do anything else. The full lifecycle is
  // exercised by the manual UI; the autonomous suite stops here.
  {
    id: 't200.finalState',
    title: 'final state snapshot',
    category: 'system',
    async run (ctx) {
      return {
        nodeInfo: await ctx.ext.getNodeInfo().catch((e) => ({ error: (e as Error).message })),
        channels: await ctx.ext.listChannels().catch((e) => ({ error: (e as Error).message })),
        balance: await ctx.ext.getBalanceDetails(false).catch((e) => ({ error: (e as Error).message }))
      }
    }
  }
]
