// Test-runner types — shared between the runner, the case definitions,
// and the E2ETab UI.

import type { LnExt } from '../ext/LnExt'
import type { PeerClient } from './PeerClient'
import type { ChainController } from './ChainController'

export type TestStatus = 'pending' | 'running' | 'pass' | 'fail' | 'skip' | 'expected-fail' | 'expected-pass'

/**
 * Iteration-2 upstream blockers the runner expects-fail. Mapping:
 *   - B1: `ln_invoice` fails on NativeExternalSigner when carrying an
 *         asset payload (signing path bug).
 *   - B2: asset channel coop close hangs at htlc-unsettled state.
 *   - B3: receiver-side stays in `future` after force close + on-chain
 *         settlement past CSV.
 *   - external-signer-mode: RLN's iter-1/iter-2 design explicitly
 *         rejects issueAssetNia/Ifa/Cfa/Uda + `inflate` (and on-chain
 *         RGB send + open-asset-channel-as-initiator) when the node
 *         is using `NativeExternalSigner`. The Rust handler raises
 *         `UnsupportedInExternalSignerMode` directly — not a bug.
 *         See rgb-lightning-node/src/routes.rs.
 *   - regtest-fee: bitcoind regtest doesn't accumulate fee history
 *         so `estimateFee` returns `Rln(Conflict)`. Not a bug — pass
 *         on testnet/mainnet, just noise here.
 */
export type BlockedTag = 'iter-2-B1' | 'iter-2-B2' | 'iter-2-B3' | 'external-signer-mode' | 'regtest-fee'

export interface TestContext {
  ext: LnExt
  peer: PeerClient
  chain: ChainController
  /** Mutable bag for cross-test state (asset_ids, channel_ids, …). */
  state: Record<string, unknown>
  /** Auto-stamped on each `log()` call from a test step. */
  testCaseId: string
}

export interface TestCase {
  id: string
  title: string
  category: string
  /** Iteration-2 expected-fail tag. Runner flips pass/fail semantics. */
  blockedBy?: BlockedTag
  /**
   * Optional error-string matcher used together with `blockedBy`.
   *
   * When set, a failure is only counted as `expected-fail` if the
   * thrown error message matches this pattern. A failure with an
   * unrelated message (e.g. a network blip, an unrelated APIError) is
   * still a real `fail` — preventing the blocker tag from silently
   * absorbing regressions. When unset, any failure on a blocked test
   * counts as expected-fail (legacy behavior).
   */
  blockedByMatch?: string | RegExp
  /**
   * Optional dependency list — the runner skips this case if any of
   * the listed ids did not pass. Use it to short-circuit downstream
   * scenarios when their precondition collapses.
   */
  dependsOn?: string[]
  /** Run the test. Throw on failure; return value is captured. */
  run: (ctx: TestContext) => Promise<unknown>
}

export interface TestResult {
  id: string
  title: string
  category: string
  status: TestStatus
  durationMs: number
  startedAt: string
  endedAt: string
  blockedBy?: BlockedTag
  /** Captured return value on success, error string on failure. */
  payload?: unknown
  error?: string
  /** Ids skipped because this case failed and they depended on it. */
  skippedDownstream?: string[]
}

export interface TestReport {
  sessionId: string
  startedAt: string
  endedAt: string
  durationMs: number
  total: number
  passed: number
  failed: number
  skipped: number
  expectedFail: number
  unexpectedPass: number
  cases: TestResult[]
  environment: {
    platform: 'ios' | 'android' | 'web' | 'other'
    appBuild?: string
  }
}

export type RunnerStatus = 'idle' | 'running' | 'done'

export interface RunnerSnapshot {
  status: RunnerStatus
  currentId: string | null
  results: TestResult[]
  startedAt: string | null
  finishedAt: string | null
  report: TestReport | null
}
