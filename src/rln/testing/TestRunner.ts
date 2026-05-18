// TestRunner — autonomous orchestrator for the RLN E2E scenario suite.
//
// Walks `TestCase[]` sequentially (order matters — open-channel must
// run before invoice-pay, etc.), enforcing `dependsOn` skips, flipping
// pass/fail semantics for cases tagged with iter-2 blockers, and
// writing a `report.json` artefact at the end.
//
// Every test step funnels through `runWithLogging` so the LogStore +
// JSONL sink see the entire chronology — no per-case log file to
// reconcile.

import { Paths, File } from 'expo-file-system'
import { Platform } from 'react-native'
import type { LnExt } from '../ext/LnExt'
import { logEvent, logStore, runWithLogging } from '../state/LogStore'
import type { PeerClient } from './PeerClient'
import type { ChainController } from './ChainController'
import type { RunnerSnapshot, RunnerStatus, TestCase, TestContext, TestReport, TestResult, TestStatus } from './types'

export class TestRunner {
  private status: RunnerStatus = 'idle'
  private currentId: string | null = null
  private results: TestResult[] = []
  private startedAt: string | null = null
  private finishedAt: string | null = null
  private report: TestReport | null = null
  private listeners = new Set<() => void>()
  private failedIds = new Set<string>()
  private state: Record<string, unknown> = {}

  constructor (
    private cases: TestCase[],
    private ctxDeps: { ext: LnExt; peer: PeerClient; chain: ChainController; initialState?: Record<string, unknown> }
  ) {}

  subscribe (l: () => void): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  snapshot (): RunnerSnapshot {
    return {
      status: this.status,
      currentId: this.currentId,
      results: [...this.results],
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      report: this.report
    }
  }

  /**
   * Walk the suite. Resolves when every case has run (or been skipped).
   * Re-running mid-flight is a no-op (must finish or reset first).
   */
  async run (categoryFilter?: string): Promise<TestReport> {
    if (this.status === 'running') throw new Error('TestRunner already running')
    this.status = 'running'
    this.results = []
    this.failedIds.clear()
    // Seed the test-case state bag with the caller-provided env (peer
    // host/port, indexer/proxy URLs). Resetting to {} here was the
    // bug — env injected BEFORE `run()` got wiped, and tests fell
    // through to the hardcoded Android defaults (10.0.2.2) which iOS
    // can't reach.
    this.state = { ...(this.ctxDeps.initialState ?? {}) }
    this.startedAt = new Date().toISOString()
    this.finishedAt = null
    this.report = null
    this.emit()

    const sessionId = logStore.getSessionId()
    logEvent('info', 'e2e', 'run-start', `runner started — ${this.cases.length} cases`, { categoryFilter })

    const cases = categoryFilter
      ? this.cases.filter((c) => c.category === categoryFilter)
      : this.cases

    for (const tc of cases) {
      const result = await this.runOne(tc)
      this.results.push(result)
      this.emit()
    }

    this.finishedAt = new Date().toISOString()
    this.status = 'done'
    this.currentId = null
    this.report = this.buildReport(sessionId)
    await this.writeReport(this.report)
    logEvent(
      'info',
      'e2e',
      'run-done',
      `${this.report.passed}/${this.report.total} passed (${this.report.expectedFail} expected-fail, ${this.report.unexpectedPass} unexpected-pass, ${this.report.skipped} skipped)`,
      this.report
    )
    this.emit()
    return this.report
  }

  private async runOne (tc: TestCase): Promise<TestResult> {
    const startedAt = new Date().toISOString()

    // Dependency skip.
    if (tc.dependsOn) {
      const failedDeps = tc.dependsOn.filter((id) => this.failedIds.has(id))
      if (failedDeps.length > 0) {
        this.failedIds.add(tc.id)
        // Backfill `skippedDownstream` on each upstream failure so the
        // report can render a tree of "X failed → Y, Z, … skipped"
        // without consumers having to reconstruct it from `dependsOn`.
        for (const failedId of failedDeps) {
          const upstream = this.results.find((r) => r.id === failedId)
          if (upstream) {
            if (!upstream.skippedDownstream) upstream.skippedDownstream = []
            upstream.skippedDownstream.push(tc.id)
          }
        }
        const endedAt = new Date().toISOString()
        logEvent('info', 'e2e', tc.id, `skipped — dependency failed`, { dependsOn: tc.dependsOn, failedDeps }, tc.id)
        return {
          id: tc.id,
          title: tc.title,
          category: tc.category,
          status: 'skip',
          durationMs: 0,
          startedAt,
          endedAt,
          blockedBy: tc.blockedBy,
          // Record which upstream dep(s) caused this skip — surfaced in
          // the report's `error` field for human-readable triage.
          error: `skipped — upstream failed: ${failedDeps.join(', ')}`
        }
      }
    }

    this.currentId = tc.id
    this.emit()

    const ctx: TestContext = {
      ext: this.ctxDeps.ext,
      peer: this.ctxDeps.peer,
      chain: this.ctxDeps.chain,
      state: this.state,
      testCaseId: tc.id
    }

    const out = await runWithLogging({
      category: 'e2e',
      method: tc.id,
      message: tc.title,
      testCaseId: tc.id,
      run: () => tc.run(ctx)
    })

    const endedAt = new Date().toISOString()

    if (out.status === 'ok') {
      // For tagged blockers an unexpected pass IS a useful signal but
      // not a failure — we record it as `pass` with an `unexpectedPass`
      // marker in the payload + counter, so the summary can flag it
      // without adding a third pass-ish bucket.
      const payload: unknown = tc.blockedBy
        ? { unexpectedPass: true, blockedBy: tc.blockedBy, value: out.result }
        : out.result
      return {
        id: tc.id,
        title: tc.title,
        category: tc.category,
        status: 'pass',
        durationMs: out.durationMs,
        startedAt,
        endedAt,
        blockedBy: tc.blockedBy,
        payload
      }
    } else {
      // A test tagged with `blockedBy` is only counted as expected-fail
      // when its actual error matches `blockedByMatch` (when set). A
      // blocker tag without a matcher accepts any failure for legacy
      // compatibility — but new tests SHOULD always supply a matcher so
      // unrelated regressions don't get absorbed into the expected-fail
      // bucket.
      const expected = !!tc.blockedBy && matchesBlocker(out.error, tc.blockedByMatch)
      // Both `fail` and `expected-fail` propagate the dependency skip
      // downstream — otherwise tests that depend on (say) t60.issueNia
      // would try to read its non-existent asset_id from state and
      // produce noisy "asset id missing" errors instead of a clean
      // skip. The reporter counts them separately.
      this.failedIds.add(tc.id)
      // When the error didn't match a declared `blockedByMatch`,
      // attach a hint to the recorded error so it's obvious in the
      // report why a tagged test was nonetheless counted as a hard
      // fail.
      const errorOut = tc.blockedBy && tc.blockedByMatch && !expected
        ? `${out.error} [blockedByMatch (${describeMatcher(tc.blockedByMatch)}) did not match — counted as real failure, not expected-fail]`
        : out.error
      return {
        id: tc.id,
        title: tc.title,
        category: tc.category,
        status: expected ? 'expected-fail' : 'fail',
        durationMs: out.durationMs,
        startedAt,
        endedAt,
        blockedBy: tc.blockedBy,
        error: errorOut
      }
    }
  }

  private buildReport (sessionId: string): TestReport {
    const total = this.results.length
    let passed = 0, failed = 0, skipped = 0, expectedFail = 0, unexpectedPass = 0
    for (const r of this.results) {
      switch (r.status) {
        case 'pass':
          passed += 1
          if (r.blockedBy && r.payload && typeof r.payload === 'object' && (r.payload as Record<string, unknown>).unexpectedPass) {
            unexpectedPass += 1
          }
          break
        case 'fail': failed += 1; break
        case 'skip': skipped += 1; break
        case 'expected-fail': expectedFail += 1; break
        default: break
      }
    }
    const startedAt = this.startedAt ?? new Date().toISOString()
    const endedAt = this.finishedAt ?? new Date().toISOString()
    return {
      sessionId,
      startedAt,
      endedAt,
      durationMs: new Date(endedAt).getTime() - new Date(startedAt).getTime(),
      total,
      passed,
      failed,
      skipped,
      expectedFail,
      unexpectedPass,
      cases: [...this.results],
      environment: {
        platform: platformTag(),
        appBuild: process.env.EXPO_PUBLIC_APP_BUILD ?? undefined
      }
    }
  }

  private async writeReport (report: TestReport): Promise<void> {
    const path = `rln-e2e-report-${report.sessionId}.json`
    const file = new File(Paths.document, path)
    // `.delete()` throws a SwiftError that escapes JS try/catch and
    // SIGABRTs the bridge when the file doesn't exist. Always gate on
    // `.exists`. Fallback: just write (overwrites in place).
    try {
      if (file.exists) file.delete()
      file.create()
      file.write(JSON.stringify(report, null, 2))
    } catch {
      try { file.write(JSON.stringify(report, null, 2)) } catch { /* swallow */ }
    }
    logEvent('info', 'e2e', 'report-written', path, { path })
  }

  private emit () {
    for (const l of this.listeners) l()
  }
}

/**
 * Match an error string against a `blockedByMatch` pattern. Returns
 * true when the pattern is undefined (legacy: any failure counts) or
 * when the string contains/satisfies the pattern.
 */
function matchesBlocker (error: string | undefined, pattern: string | RegExp | undefined): boolean {
  if (!pattern) return true
  if (!error) return false
  if (typeof pattern === 'string') return error.includes(pattern)
  return pattern.test(error)
}

function describeMatcher (pattern: string | RegExp): string {
  return typeof pattern === 'string' ? `"${pattern}"` : pattern.toString()
}

function platformTag (): 'ios' | 'android' | 'web' | 'other' {
  if (Platform.OS === 'ios') return 'ios'
  if (Platform.OS === 'android') return 'android'
  if (Platform.OS === 'web') return 'web'
  return 'other'
}
