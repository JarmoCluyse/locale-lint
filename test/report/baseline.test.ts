import { describe, expect, it } from 'vitest'
import { buildBaselineFromSummary, filterSummaryAgainstBaseline, parseBaseline, renderBaseline } from '../../src/report/baseline'
import type { UsageSummary } from '../../src/engine/usage/types'

function summary(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    filesScanned: 1,
    filesSkipped: [],
    localeDiagnostics: [],
    missing: [],
    unused: [],
    coverage: [],
    overallCoverage: 100,
    dynamicKeyUsages: [],
    caveats: [],
    usedKeyCount: 0,
    durationMs: 1,
    ...overrides,
  }
}

describe('baseline', () => {
  it('builds a deterministic, sorted snapshot from a summary', () => {
    const s = summary({
      missing: [
        { key: 'b.key', locale: 'en', file: 'a.ts', line: 1, column: 1, occurrenceCount: 1 },
        { key: 'a.key', locale: 'fr', file: 'a.ts', line: 1, column: 1, occurrenceCount: 1 },
      ],
      unused: [
        { key: 'z.unused', locales: ['en'], file: 'locales/en.json' },
        { key: 'a.unused', locales: ['en'], file: 'locales/en.json' },
      ],
    })
    const baseline = buildBaselineFromSummary(s)
    expect(baseline.missing).toEqual(['en|b.key', 'fr|a.key'])
    expect(baseline.unused).toEqual(['a.unused', 'z.unused'])
  })

  it('renders and parses round-trip identically', () => {
    const s = summary({
      missing: [{ key: 'a', locale: 'en', file: 'x.ts', line: 1, column: 1, occurrenceCount: 1 }],
      unused: [{ key: 'b', locales: ['en'], file: 'locales/en.json' }],
    })
    const baseline = buildBaselineFromSummary(s)
    const rendered = renderBaseline(baseline)
    const parsed = parseBaseline(rendered)
    expect(parsed).toEqual(baseline)
  })

  it('rendering twice is byte-identical (determinism)', () => {
    const s = summary({ missing: [{ key: 'a', locale: 'en', file: 'x.ts', line: 1, column: 1, occurrenceCount: 1 }] })
    const baseline = buildBaselineFromSummary(s)
    expect(renderBaseline(baseline)).toBe(renderBaseline(baseline))
  })

  it('filterSummaryAgainstBaseline removes only baseline-matched entries', () => {
    const s = summary({
      missing: [
        { key: 'known', locale: 'en', file: 'x.ts', line: 1, column: 1, occurrenceCount: 1 },
        { key: 'new', locale: 'en', file: 'x.ts', line: 2, column: 1, occurrenceCount: 1 },
      ],
      unused: [
        { key: 'known.unused', locales: ['en'], file: 'locales/en.json' },
        { key: 'new.unused', locales: ['en'], file: 'locales/en.json' },
      ],
    })
    const baseline = { schemaVersion: 1 as const, missing: ['en|known'], unused: ['known.unused'] }
    const filtered = filterSummaryAgainstBaseline(s, baseline)
    expect(filtered.missing.map(m => m.key)).toEqual(['new'])
    expect(filtered.unused.map(u => u.key)).toEqual(['new.unused'])
  })

  it('does not mutate fields outside missing/unused', () => {
    const s = summary({ overallCoverage: 42, dynamicKeyUsages: [{ file: 'a.ts', line: 1, column: 1, snippet: 'x' }] })
    const filtered = filterSummaryAgainstBaseline(s, { schemaVersion: 1, missing: [], unused: [] })
    expect(filtered.overallCoverage).toBe(42)
    expect(filtered.dynamicKeyUsages).toEqual(s.dynamicKeyUsages)
  })
})
