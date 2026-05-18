// `useExt` — memoised handle for the LnExt proxy.
//
// `useAccount(...).extension()` returns a fresh Proxy on every call,
// so callers MUST memoise it on `account` identity or every render
// rebuilds the proxy and busts downstream callback memoisation. The
// existing screen got this wrong in early iterations and re-fired
// effects in a tight render loop — wrapping it here avoids any new
// instance of that bug.

import React from 'react'
import { useAccount } from '@tetherto/wdk-react-native-core'
import type { LnExt } from './LnExt'

export interface UseExtResult {
  ext: LnExt | null
  /** True once the underlying `account` is materialised. */
  ready: boolean
  /** The fresh on-chain address from RLN (post-unlock). */
  address: string | null
  /** Loader status — same as `useAccount().isLoading`. */
  isLoading: boolean
  /** Loader-side error (does NOT include per-method errors). */
  error: string | null
  /** Raw account handle — exposed for tests that need it. */
  account: unknown
}

export function useExt (): UseExtResult {
  const ln = useAccount<LnExt>({ network: 'rgb-lightning', accountIndex: 0 })
  const { address, isLoading, error, account, extension } = ln
  const ext = React.useMemo<LnExt | null>(() => {
    if (!account || typeof extension !== 'function') return null
    try {
      return extension() as LnExt
    } catch { return null }
  }, [account, extension])
  return {
    ext,
    ready: !!ext,
    address: typeof address === 'string' ? address : null,
    isLoading,
    error: typeof error === 'string' ? error : (error ? String(error) : null),
    account
  }
}
