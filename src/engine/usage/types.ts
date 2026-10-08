// Shared types for the usage scanner (missing/unused keys + coverage).
import type { Diagnostic } from '../locale/types'
import type { SkippedFile } from '../types'

/** One raw key-usage occurrence found in source code, pre-aggregation. */
export interface KeyOccurrence {
  /** Normalized keypath (via vendored `Analyst.normalizeKey` — `a[0]` -> `a.0`). */
  key: string
  /** Rootpath-relative, forward-slash path. */
  file: string
  line: number
  column: number
  endLine: number
  endColumn: number
}

/** A heuristically-detected dynamic key expression (e.g. `` t(`err.${code}`) ``). */
export interface DynamicKeyUsage {
  file: string
  line: number
  column: number
  /** Short raw-text snippet for human context (truncated). */
  snippet: string
}

export interface FileUsageScanResult {
  occurrences: KeyOccurrence[]
  dynamicKeyUsages: DynamicKeyUsage[]
}

/** Raw (pre-aggregation) output of scanning every source file for usages. */
export interface UsageScanRaw {
  filesScanned: number
  filesSkipped: SkippedFile[]
  occurrences: KeyOccurrence[]
  dynamicKeyUsages: DynamicKeyUsage[]
  durationMs: number
}

export interface MissingKeyEntry {
  key: string
  locale: string
  /** First (file -> line -> column sorted) occurrence location, for CI annotation. */
  file: string
  line: number
  column: number
  /** Total number of occurrences of this key anywhere in source. */
  occurrenceCount: number
}

export interface UnusedKeyEntry {
  key: string
  /** Locale(s) in which this key is defined (sorted). */
  locales: string[]
  /** One representative locale file path (sourceLanguage's file if present, else first alphabetically), for CI annotation. */
  file: string
}

export interface CoverageEntry {
  locale: string
  total: number
  translated: number
  missing: number
  /** 0-100, rounded to 2 decimal places. */
  percentage: number
}

export interface UsageSummary {
  filesScanned: number
  filesSkipped: SkippedFile[]
  localeDiagnostics: Diagnostic[]
  missing: MissingKeyEntry[]
  unused: UnusedKeyEntry[]
  coverage: CoverageEntry[]
  /** 0-100, rounded to 2 decimal places; translated/total across all locales combined. */
  overallCoverage: number
  dynamicKeyUsages: DynamicKeyUsage[]
  /** Non-empty iff dynamicKeyUsages.length > 0 — see UsageScanner.ts doc comment. */
  caveats: string[]
  /**
   * Distinct normalized keys referenced anywhere in source (post
   * derived-key-rule adjustment). Used by `--max-missing <pct>` to compute a
   * percentage (missing.length / (usedKeyCount * locales.length) * 100)
   * rather than a raw count.
   */
  usedKeyCount: number
  durationMs: number
}
