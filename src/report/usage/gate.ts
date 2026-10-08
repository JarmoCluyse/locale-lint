// Threshold evaluation -> process exit code for the usage scanner.
//
// Exit codes (shared numbering across the whole CLI — see src/report/gate.ts
// for the hard-string/common codes):
//   0  success
//   1  missing-keys/coverage gate violated
//   2  unused-keys gate violated
//   4  multiple categories violated (both 1 and 2 would apply)
//  10  config error
//  11  no files matched / no framework detected
//  12  parse errors exceeded tolerance (file parse errors OR locale-file
//      Diagnostics — a malformed locale file must never be silently ignored)
//  70  internal error
//
// Severity default, per the project brief: "unused" defaults to WARN (never
// fails the gate on its own unless the caller opts in via `--max-unused` or
// `gate.failOnIdle`) — dynamic keys make false-positive "unused" results
// common enough that defaulting to a hard failure would erode trust in the
// tool. "missing" defaults to a hard failure (maxMissing defaults to 0) —
// a key referenced in code but absent from a locale is a correctness bug,
// not a heuristic-driven false positive.
import type { UsageSummary } from '../../engine/usage/types'
import { EXIT_SUCCESS, EXIT_NO_FILES_MATCHED, EXIT_PARSE_ERRORS_EXCEEDED } from '../gate'

export const EXIT_MISSING_GATE = 1
export const EXIT_UNUSED_GATE = 2
export const EXIT_MULTIPLE_GATE = 4

export type MaxMissingThreshold = { kind: 'count', value: number } | { kind: 'percent', value: number }

export interface UsageGateOptions {
  /** Default: `{ kind: 'count', value: 0 }` — any missing key fails. */
  maxMissing?: MaxMissingThreshold
  /** Default: `Infinity` unless `failOnIdle` is set, in which case `0`. */
  maxUnused?: number
  /** Mirrors `GateConfig.failOnIdle` — opts "unused" into a hard failure by default. */
  failOnIdle?: boolean
  /** Fail if overall coverage is below this percentage (0-100). */
  minCoverage?: number
  /** Max allowed parse-error-skipped files + locale-file Diagnostics combined, before failing. Default: Infinity. */
  maxParseErrors?: number
  /** Force exit 0 regardless of gate outcome, while still emitting the report. */
  warnOnly?: boolean
}

export interface UsageGateResult {
  exitCode: number
  reasons: string[]
}

function missingExceedsThreshold(summary: UsageSummary, threshold: MaxMissingThreshold): { exceeds: boolean, reason: string } {
  if (threshold.kind === 'count') {
    const exceeds = summary.missing.length > threshold.value
    return { exceeds, reason: `${summary.missing.length} missing key usage(s), exceeding the allowed ${threshold.value}.` }
  }
  const totalChecks = summary.usedKeyCount * summary.coverage.length
  const pct = totalChecks === 0 ? 0 : (summary.missing.length / totalChecks) * 100
  const exceeds = pct > threshold.value
  return { exceeds, reason: `${pct.toFixed(2)}% of key×locale checks are missing, exceeding the allowed ${threshold.value}%.` }
}

export function evaluateUsageGate(summary: UsageSummary, options: UsageGateOptions = {}): UsageGateResult {
  if (summary.filesScanned === 0) {
    return {
      exitCode: EXIT_NO_FILES_MATCHED,
      reasons: ['No files matched the scan patterns (0 files scanned) — refusing to report success.'],
    }
  }

  const parseErrorCount = summary.filesSkipped.filter(s => s.reason === 'parse-error').length + summary.localeDiagnostics.length
  const maxParseErrors = options.maxParseErrors ?? Infinity
  if (parseErrorCount > maxParseErrors) {
    const result: UsageGateResult = {
      exitCode: EXIT_PARSE_ERRORS_EXCEEDED,
      reasons: [`${parseErrorCount} parse error(s) (source + locale files), exceeding the allowed ${maxParseErrors}.`],
    }
    return options.warnOnly ? { ...result, exitCode: EXIT_SUCCESS } : result
  }

  const reasons: string[] = []
  let missingViolated = false
  let unusedViolated = false

  const maxMissing = options.maxMissing ?? { kind: 'count', value: 0 }
  const missingCheck = missingExceedsThreshold(summary, maxMissing)
  if (missingCheck.exceeds) {
    missingViolated = true
    reasons.push(missingCheck.reason)
  }

  if (options.minCoverage !== undefined && summary.overallCoverage < options.minCoverage) {
    missingViolated = true
    reasons.push(`Overall coverage ${summary.overallCoverage}% is below the required ${options.minCoverage}%.`)
  }

  const maxUnused = options.maxUnused ?? (options.failOnIdle ? 0 : Infinity)
  if (summary.unused.length > maxUnused) {
    unusedViolated = true
    reasons.push(`${summary.unused.length} unused key(s), exceeding the allowed ${maxUnused}.`)
  }

  let exitCode = EXIT_SUCCESS
  if (missingViolated && unusedViolated)
    exitCode = EXIT_MULTIPLE_GATE
  else if (missingViolated)
    exitCode = EXIT_MISSING_GATE
  else if (unusedViolated)
    exitCode = EXIT_UNUSED_GATE

  if (exitCode === EXIT_SUCCESS)
    return { exitCode, reasons: ['OK'] }

  return options.warnOnly ? { exitCode: EXIT_SUCCESS, reasons } : { exitCode, reasons }
}
