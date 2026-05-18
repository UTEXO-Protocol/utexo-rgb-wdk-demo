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
//
// If a method ends up missing at runtime (older napi build), the failure
// will surface naturally — `TypeError: this._node.xyz is not a function`
// — which is much better diagnostics than a hand-rolled NotImplemented.

import type { LnExt } from './LnExt'

/** Loose shape of the wdk-rgb-lightning account object. */
export interface RglAccount {
  [method: string]: (...args: unknown[]) => Promise<unknown> | unknown
}

export function createLnExtNodeAdapter (account: RglAccount): LnExt {
  // Most methods pass straight through. Wrap the few that need shimming.
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
      return v
    }
  })
  return proxy as unknown as LnExt
}
