// LnExtNodeAdapter — exposes the LnExt surface on Node.
//
// In RN, `ext: LnExt` is an HRPC proxy into a Bare worklet running the
// rgb-lightning daemon. On Node, `@utexo/wdk-rgb-lightning`'s
// `WalletAccountRgbLightning` ALREADY exposes the same method names with
// the same Promise-returning shapes (see node_modules/@utexo/wdk-rgb-
// lightning/src/wallet-account-rgb-lightning.js). So the adapter is just
// a thin pass-through that:
//
//   1. Type-asserts the account as LnExt (the runtime surface matches
//      method-for-method; verbose `wrap` calls would only re-create the
//      same plumbing).
//   2. Patches `unlock` to a no-op — by the time the suite runs, the
//      daemon is already online (we unlock the binding before building
//      the adapter), so calls inside the test cases would otherwise
//      re-issue the unlock and either no-op or 409.
//   3. Adds tolerant getKeyPair / verify / signTransaction shims for
//      methods the account doesn't itself implement.
//   4. **Yields the Node event loop after every napi-backed call** so
//      the daemon's tokio runtime gets CPU cycles to drive its
//      background tasks (LDK peer manager, BDK chain sync, etc.).
//      Without this, the tight test loop fires napi calls at ~0-1 ms
//      intervals — leaving the tokio workers starved and stalling
//      noise handshakes / channel state transitions (the t30 cascade).
//      See `yieldToEventLoop()` below for details.
//
// If a method ends up missing at runtime (older napi build), the failure
// will surface naturally — `TypeError: this._node.xyz is not a function`
// — which is much better diagnostics than a hand-rolled NotImplemented.

import type { LnExt } from './LnExt'

/** Loose shape of the wdk-rgb-lightning account object. */
export interface RglAccount {
  [method: string]: (...args: unknown[]) => Promise<unknown> | unknown
}

/**
 * Force a Node event-loop turn. The napi binding uses
 * `tokio::runtime::block_on` to drive each daemon call. When the
 * caller fires napi calls back-to-back at ~0-1 ms intervals, the
 * tokio runtime's other workers (running LDK's peer manager, BDK
 * sync, etc.) don't get enough sustained CPU to progress async tasks
 * like noise handshakes — they're constantly contending with the
 * incoming block_on. On RN, HRPC marshalling naturally adds
 * 1-20 ms per call which gives tokio breathing room; on Node we
 * have to insert it explicitly.
 *
 * `setImmediate` yields AFTER pending I/O callbacks process, which
 * is exactly what we want — it doesn't just bounce the microtask
 * queue, it actually returns to the event loop. ~1 ms cost per call.
 */
function yieldToEventLoop (): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

/**
 * Method names that should bypass the yield-after-call hook because
 * they're synthetic (don't actually hit the napi binding) or they
 * already return immediately. Skipping the yield here avoids paying
 * the overhead twice in chains of cheap calls.
 */
const NO_YIELD_METHODS = new Set<string>([
  'unlock',
  'getKeyPair',
  'verify',
  'signTransaction',
  'toReadOnlyAccount'
])

export function createLnExtNodeAdapter (account: RglAccount): LnExt {
  const proxy = new Proxy(account, {
    get (target, prop, receiver) {
      // Suite calls `ext.unlock(...)` is a holdover from RN's UnlockGate
      // flow. The Node entry-point unlocks the binding directly before
      // building this adapter, so we no-op here to avoid a double-unlock.
      if (prop === 'unlock') {
        return async () => ({ ok: true as const })
      }
      // Methods that the account class doesn't implement — return a
      // friendly thrower so the failing test case carries a clear
      // message instead of `TypeError: undefined is not a function`.
      if (prop === 'getKeyPair' && typeof (target as { getKeyPair?: unknown }).getKeyPair !== 'function') {
        return async () => { throw new Error('getKeyPair: not implemented on @utexo/wdk-rgb-lightning account in Node') }
      }

      const v = Reflect.get(target, prop, receiver)
      // Symbol properties (e.g. Symbol.toPrimitive) and non-functions
      // pass straight through — don't wrap.
      if (typeof v !== 'function' || typeof prop !== 'string') return v
      if (NO_YIELD_METHODS.has(prop)) return v.bind(target)

      // Real napi-backed methods: invoke, await, then yield the loop
      // before returning to the caller. This is Option 1 of bringing
      // Node to parity with RN — keep the tokio runtime fed between
      // calls so LDK's peer manager can drive noise handshakes etc.
      return async (...args: unknown[]) => {
        const result = await (v as (...a: unknown[]) => Promise<unknown> | unknown).apply(target, args)
        await yieldToEventLoop()
        return result
      }
    }
  })
  return proxy as unknown as LnExt
}
