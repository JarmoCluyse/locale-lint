// Threshold evaluation -> process exit code.
//
// Exit codes:
//   0  success
//   1  (reserved — usage scanner: missing keys)
//   2  (reserved — usage scanner: unused keys)
//   3  hard-string gate violated
//  10  config error
//  11  no files matched / no framework detected
//  12  parse errors exceeded tolerance
//  70  internal error
//
// Invariant: NEVER exit 0 when zero files were scanned — a scan that silently
// matched nothing is the most common way a green CI run lies.
import type { ScanSummary } from '../engine/types'

export const EXIT_SUCCESS = 0
export const EXIT_HARD_STRING_GATE = 3
export const EXIT_CONFIG_ERROR = 10
export const EXIT_NO_FILES_MATCHED = 11
export const EXIT_PARSE_ERRORS_EXCEEDED = 12
export const EXIT_INTERNAL_ERROR = 70

export interface GateOptions {
  /** Max allowed hard-string findings before failing. Default: 0 (any finding fails). */
  maxHardStrings?: number
  /** Max allowed parse-error-skipped files before failing. Default: Infinity (never fails on parse errors alone). */
  maxParseErrors?: number
  /** Force exit 0 regardless of gate outcome, while still reporting findings/skips. */
  warnOnly?: boolean
}

export interface GateResult {
  exitCode: number
  reason: string
}

export function evaluateGate(summary: ScanSummary, options: GateOptions = {}): GateResult {
  if (summary.filesScanned === 0) {
    return {
      exitCode: EXIT_NO_FILES_MATCHED,
      reason: 'No files matched the scan patterns (0 files scanned) — refusing to report success.',
    }
  }

  const parseErrorCount = summary.filesSkipped.filter(s => s.reason === 'parse-error').length
  const maxParseErrors = options.maxParseErrors ?? Infinity
  if (parseErrorCount > maxParseErrors) {
    const result = {
      exitCode: EXIT_PARSE_ERRORS_EXCEEDED,
      reason: `${parseErrorCount} file(s) failed to parse, exceeding the allowed ${maxParseErrors}.`,
    }
    return options.warnOnly ? { ...result, exitCode: EXIT_SUCCESS } : result
  }

  const maxHardStrings = options.maxHardStrings ?? 0
  if (summary.findings.length > maxHardStrings) {
    const result = {
      exitCode: EXIT_HARD_STRING_GATE,
      reason: `${summary.findings.length} hard-coded string(s) found, exceeding the allowed ${maxHardStrings}.`,
    }
    return options.warnOnly ? { ...result, exitCode: EXIT_SUCCESS } : result
  }

  return { exitCode: EXIT_SUCCESS, reason: 'OK' }
}
