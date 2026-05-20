// Exposes the `LnExt` surface on Node by wrapping
// `WalletAccountRgbLightning` from `@utexo/wdk-rgb-lightning`. That
// account class already exposes the same method names with matching
// Promise-returning shapes (see
// node_modules/@utexo/wdk-rgb-lightning/src/wallet-account-rgb-lightning.js),
// so the adapter is a thin pass-through with two small adjustments:
//
//   1. `unlock` is a no-op — the Node entry-point unlocks the binding
//      directly before building this adapter, so calls inside the
//      suite would otherwise re-issue the unlock and 409.
//   2. `getKeyPair` falls back to a clear thrower if the account
//      doesn't implement it. Other methods missing at runtime surface
//      naturally as `TypeError: ... is not a function`, which is more
//      informative than a hand-rolled NotImplemented.

import type { LnExt } from './LnExt'

/** Loose shape of the wdk-rgb-lightning account object. */
export interface RglAccount {
  [method: string]: (...args: unknown[]) => Promise<unknown> | unknown
}

export function createLnExtNodeAdapter (account: RglAccount): LnExt {
  const proxy = new Proxy(account, {
    get (target, prop, receiver) {
      if (prop === 'unlock') {
        return async () => ({ ok: true as const })
      }
      if (prop === 'getKeyPair' && typeof (target as { getKeyPair?: unknown }).getKeyPair !== 'function') {
        return async () => { throw new Error('getKeyPair: not implemented on @utexo/wdk-rgb-lightning account in Node') }
      }
      return Reflect.get(target, prop, receiver)
    }
  })
  return proxy as unknown as LnExt
}
