// Human-readable text report for the usage scanner.
import type { UsageSummary } from '../../engine/usage/types'

export interface UsageTextOptions {
  /** Break the "missing" section down per-locale instead of one flat list. */
  perLocale?: boolean
}

export function renderUsageTextReport(summary: UsageSummary, options: UsageTextOptions = {}): string {
  const lines: string[] = []

  if (summary.localeDiagnostics.length) {
    lines.push('Locale file errors:')
    for (const d of [...summary.localeDiagnostics].sort((a, b) => (a.file < b.file ? -1 : 1)))
      lines.push(`  ${d.file}: ${d.message}`)
    lines.push('')
  }

  if (summary.missing.length) {
    lines.push('Missing keys:')
    if (options.perLocale) {
      const byLocale = new Map<string, typeof summary.missing>()
      for (const m of summary.missing) {
        if (!byLocale.has(m.locale))
          byLocale.set(m.locale, [])
        byLocale.get(m.locale)!.push(m)
      }
      for (const locale of [...byLocale.keys()].sort()) {
        lines.push(`  [${locale}]`)
        for (const m of byLocale.get(locale)!.sort((a, b) => (a.key < b.key ? -1 : 1)))
          lines.push(`    ${m.key}  (${m.file}:${m.line}:${m.column}, ${m.occurrenceCount} occurrence(s))`)
      }
    }
    else {
      for (const m of [...summary.missing].sort((a, b) => (a.key !== b.key ? (a.key < b.key ? -1 : 1) : (a.locale < b.locale ? -1 : 1))))
        lines.push(`  ${m.key} [${m.locale}]  (${m.file}:${m.line}:${m.column}, ${m.occurrenceCount} occurrence(s))`)
    }
    lines.push('')
  }

  if (summary.unused.length) {
    lines.push('Unused keys:')
    for (const u of [...summary.unused].sort((a, b) => (a.key < b.key ? -1 : 1)))
      lines.push(`  ${u.key}  (defined in: ${u.locales.join(', ')}${u.file ? ` — ${u.file}` : ''})`)
    lines.push('')
  }

  lines.push('Coverage:')
  for (const c of [...summary.coverage].sort((a, b) => (a.locale < b.locale ? -1 : 1)))
    lines.push(`  ${c.locale}: ${c.percentage}% (${c.translated}/${c.total})`)
  lines.push(`  overall: ${summary.overallCoverage}%`)
  lines.push('')

  if (summary.caveats.length) {
    for (const c of summary.caveats)
      lines.push(`Caveat: ${c}`)
    lines.push('')
  }

  if (summary.filesSkipped.length) {
    lines.push('Skipped files:')
    for (const s of [...summary.filesSkipped].sort((a, b) => (a.file < b.file ? -1 : 1)))
      lines.push(`  ${s.file} (${s.reason}${s.detail ? `: ${s.detail}` : ''})`)
    lines.push('')
  }

  lines.push(
    `Summary: ${summary.filesScanned} file(s) scanned, `
    + `${summary.filesSkipped.length} skipped, `
    + `${summary.missing.length} missing key usage(s), `
    + `${summary.unused.length} unused key(s), `
    + `${summary.overallCoverage}% overall coverage `
    + `(${summary.durationMs}ms)`,
  )

  return `${lines.join('\n')}\n`
}
