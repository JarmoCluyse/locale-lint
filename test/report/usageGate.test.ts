import { describe, expect, it } from 'vitest'
import {
  evaluateUsageGate, EXIT_MISSING_GATE, EXIT_UNUSED_GATE, EXIT_MULTIPLE_GATE,
} from '../../src/report/usage/gate'
import { EXIT_SUCCESS, EXIT_NO_FILES_MATCHED, EXIT_PARSE_ERRORS_EXCEEDED } from '../../src/report/gate'
import type { UsageSummary } from '../../src/engine/usage/types'

function summary(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    filesScanned: 1,
    filesSkipped: [],
    localeDiagnostics: [],
    missing: [],
    unused: [],
    coverage: [{ locale: 'en', total: 10, translated: 10, missing: 0, percentage: 100 }],
    overallCoverage: 100,
    dynamicKeyUsages: [],
    caveats: [],
    usedKeyCount: 0,
    durationMs: 1,
    ...overrides,
  }
}

function missingEntry(key: string, locale: string) {
  return { key, locale, file: 'a.ts', line: 1, column: 1, occurrenceCount: 1 }
}

function unusedEntry(key: string) {
  return { key, locales: ['en'], file: 'locales/en.json' }
}

describe('evaluateUsageGate', () => {
  it('exits 0 when nothing is missing or unused', () => {
    expect(evaluateUsageGate(summary()).exitCode).toBe(EXIT_SUCCESS)
  })

  it('exits 11 when zero files were scanned, even with nothing missing/unused', () => {
    expect(evaluateUsageGate(summary({ filesScanned: 0 })).exitCode).toBe(EXIT_NO_FILES_MATCHED)
  })

  it('exits 11 even with --warn-only (zero-files is never overridable)', () => {
    expect(evaluateUsageGate(summary({ filesScanned: 0 }), { warnOnly: true }).exitCode).toBe(EXIT_NO_FILES_MATCHED)
  })

  it('defaults to failing on ANY missing key (maxMissing default = 0)', () => {
    const result = evaluateUsageGate(summary({ missing: [missingEntry('a', 'en')] }))
    expect(result.exitCode).toBe(EXIT_MISSING_GATE)
  })

  it('"unused" does NOT fail by default (defaults to warn, not error)', () => {
    const result = evaluateUsageGate(summary({ unused: [unusedEntry('a'), unusedEntry('b')] }))
    expect(result.exitCode).toBe(EXIT_SUCCESS)
  })

  it('"unused" fails once --max-unused is explicitly set and exceeded', () => {
    const result = evaluateUsageGate(summary({ unused: [unusedEntry('a'), unusedEntry('b')] }), { maxUnused: 1 })
    expect(result.exitCode).toBe(EXIT_UNUSED_GATE)
  })

  it('"unused" fails when failOnIdle is set, even without --max-unused', () => {
    const result = evaluateUsageGate(summary({ unused: [unusedEntry('a')] }), { failOnIdle: true })
    expect(result.exitCode).toBe(EXIT_UNUSED_GATE)
  })

  it('--max-missing <n> allows up to n missing keys', () => {
    const result = evaluateUsageGate(summary({ missing: [missingEntry('a', 'en'), missingEntry('b', 'en')] }), { maxMissing: { kind: 'count', value: 2 } })
    expect(result.exitCode).toBe(EXIT_SUCCESS)
  })

  it('--max-missing <pct> computes percentage over usedKeyCount * locales', () => {
    // 1 missing out of (usedKeyCount=4 * 1 locale) = 25%
    const s = summary({ missing: [missingEntry('a', 'en')], usedKeyCount: 4 })
    expect(evaluateUsageGate(s, { maxMissing: { kind: 'percent', value: 50 } }).exitCode).toBe(EXIT_SUCCESS)
    expect(evaluateUsageGate(s, { maxMissing: { kind: 'percent', value: 10 } }).exitCode).toBe(EXIT_MISSING_GATE)
  })

  it('--min-coverage fails the missing/coverage category when below threshold', () => {
    const result = evaluateUsageGate(summary({ overallCoverage: 50 }), { minCoverage: 90 })
    expect(result.exitCode).toBe(EXIT_MISSING_GATE)
  })

  it('exits 4 when BOTH missing and unused gates are violated', () => {
    const result = evaluateUsageGate(summary({
      missing: [missingEntry('a', 'en')],
      unused: [unusedEntry('b')],
    }), { maxUnused: 0 })
    expect(result.exitCode).toBe(EXIT_MULTIPLE_GATE)
  })

  it('--warn-only forces exit 0 even when gates are violated', () => {
    const result = evaluateUsageGate(summary({ missing: [missingEntry('a', 'en')] }), { warnOnly: true })
    expect(result.exitCode).toBe(EXIT_SUCCESS)
  })

  it('exits 12 when parse errors (source + locale diagnostics) exceed tolerance', () => {
    const result = evaluateUsageGate(summary({
      localeDiagnostics: [{ file: 'locales/en.json', severity: 'error', message: 'bad json' }],
    }), { maxParseErrors: 0 })
    expect(result.exitCode).toBe(EXIT_PARSE_ERRORS_EXCEEDED)
  })

  it('a malformed locale file is never silently ignored (counts toward parse-error tolerance by default)', () => {
    const result = evaluateUsageGate(summary({
      localeDiagnostics: [{ file: 'locales/en.json', severity: 'error', message: 'bad json' }],
    }), { maxParseErrors: 0 })
    expect(result.exitCode).not.toBe(EXIT_SUCCESS)
  })
})
