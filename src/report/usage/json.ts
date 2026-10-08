// Deterministic JSON report for the usage scanner (missing/unused keys +
// coverage). Same determinism rules as the hard-string JSON report: sorted,
// no timestamps, no absolute paths, rootpath-relative paths only — this is
// the golden-output format for a future Go port's conformance suite.
import type { UsageSummary } from '../../engine/usage/types'

export interface UsageJsonReport {
  schemaVersion: 1
  summary: {
    filesScanned: number
    filesSkipped: number
    missingCount: number
    unusedCount: number
    usedKeyCount: number
    overallCoverage: number
  }
  missing: UsageSummary['missing']
  unused: UsageSummary['unused']
  coverage: UsageSummary['coverage']
  dynamicKeyUsages: UsageSummary['dynamicKeyUsages']
  caveats: string[]
  localeDiagnostics: UsageSummary['localeDiagnostics']
  skipped: UsageSummary['filesSkipped']
}

function compareBySortKey<T>(key: (t: T) => (string | number)[]) {
  return (a: T, b: T) => {
    const ka = key(a)
    const kb = key(b)
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i])
        return ka[i] < kb[i] ? -1 : 1
    }
    return 0
  }
}

export function buildUsageJsonReport(summary: UsageSummary): UsageJsonReport {
  const missing = [...summary.missing].sort(compareBySortKey(m => [m.key, m.locale]))
  const unused = [...summary.unused].sort(compareBySortKey(u => [u.key]))
  const coverage = [...summary.coverage].sort(compareBySortKey(c => [c.locale]))
  const dynamicKeyUsages = [...summary.dynamicKeyUsages].sort(compareBySortKey(d => [d.file, d.line, d.column]))
  const skipped = [...summary.filesSkipped].sort(compareBySortKey(s => [s.file]))
  const localeDiagnostics = [...summary.localeDiagnostics].sort(compareBySortKey(d => [d.file, d.message]))

  return {
    schemaVersion: 1,
    summary: {
      filesScanned: summary.filesScanned,
      filesSkipped: skipped.length,
      missingCount: missing.length,
      unusedCount: unused.length,
      usedKeyCount: summary.usedKeyCount,
      overallCoverage: summary.overallCoverage,
    },
    missing,
    unused,
    coverage,
    dynamicKeyUsages,
    caveats: [...summary.caveats],
    localeDiagnostics,
    skipped,
  }
}

export function renderUsageJsonReport(summary: UsageSummary): string {
  return `${JSON.stringify(buildUsageJsonReport(summary), null, 2)}\n`
}
