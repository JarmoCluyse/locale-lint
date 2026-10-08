// Baseline support — "no NEW violations" instead of a hard numeric
// threshold, for legacy repos where the raw counts are already too high to
// gate on meaningfully. The baseline file is a deterministic, line-diffable
// JSON snapshot of current missing/unused key *identities*; subsequent runs
// subtract baseline-matched entries before gate evaluation, so only
// genuinely new violations can fail the build.
import type { UsageSummary } from '../engine/usage/types'

export interface UsageBaseline {
  schemaVersion: 1
  /** `"${locale}|${key}"`, sorted lexicographically. */
  missing: string[]
  /** `key`, sorted lexicographically. */
  unused: string[]
}

function missingIdentity(key: string, locale: string): string {
  return `${locale}|${key}`
}

export function buildBaselineFromSummary(summary: UsageSummary): UsageBaseline {
  return {
    schemaVersion: 1,
    missing: [...new Set(summary.missing.map(m => missingIdentity(m.key, m.locale)))].sort(),
    unused: [...new Set(summary.unused.map(u => u.key))].sort(),
  }
}

/** Deterministic, diff-friendly serialization — one array entry per line. */
export function renderBaseline(baseline: UsageBaseline): string {
  return `${JSON.stringify(baseline, null, 2)}\n`
}

export function parseBaseline(raw: string): UsageBaseline {
  const parsed = JSON.parse(raw)
  return {
    schemaVersion: 1,
    missing: Array.isArray(parsed?.missing) ? [...parsed.missing].sort() : [],
    unused: Array.isArray(parsed?.unused) ? [...parsed.unused].sort() : [],
  }
}

export const EMPTY_BASELINE: UsageBaseline = { schemaVersion: 1, missing: [], unused: [] }

/**
 * Returns a new `UsageSummary` with baseline-matched missing/unused entries
 * removed. Used ONLY to feed the gate — the rendered report should still use
 * the original, unfiltered summary so users can see everything the scan
 * found (baseline-suppressed findings are still real debt, just not
 * build-breaking yet).
 */
export function filterSummaryAgainstBaseline(summary: UsageSummary, baseline: UsageBaseline): UsageSummary {
  const missingSet = new Set(baseline.missing)
  const unusedSet = new Set(baseline.unused)

  return {
    ...summary,
    missing: summary.missing.filter(m => !missingSet.has(missingIdentity(m.key, m.locale))),
    unused: summary.unused.filter(u => !unusedSet.has(u.key)),
  }
}
