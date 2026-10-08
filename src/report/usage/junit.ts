// JUnit XML report for the usage scanner — one <testsuite> per category
// (missing, unused, coverage, locale-errors), one <testcase> per key/entry,
// with file/line in the failure message for inline CI annotation.
import type { UsageSummary } from '../../engine/usage/types'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function suite(name: string, testcases: string[], failures: number, skipped = 0): string {
  return [
    `  <testsuite name="${esc(name)}" tests="${testcases.length}" failures="${failures}" errors="0" skipped="${skipped}">`,
    ...testcases,
    `  </testsuite>`,
  ].join('\n')
}

export interface UsageJunitOptions {
  perLocale?: boolean
}

export function renderUsageJunitReport(summary: UsageSummary, _options: UsageJunitOptions = {}): string {
  const missing = [...summary.missing].sort((a, b) => (
    a.key !== b.key ? (a.key < b.key ? -1 : 1) : (a.locale < b.locale ? -1 : 1)
  ))
  const missingCases = missing.map((m) => {
    const name = esc(`${m.key}[${m.locale}]`)
    const message = esc(`Missing key "${m.key}" for locale "${m.locale}" at ${m.file}:${m.line}:${m.column} (${m.occurrenceCount} occurrence(s))`)
    return [
      `    <testcase name="${name}" classname="usage.missing">`,
      `      <failure message="${message}">${message}</failure>`,
      `    </testcase>`,
    ].join('\n')
  })

  const unused = [...summary.unused].sort((a, b) => (a.key < b.key ? -1 : 1))
  const unusedCases = unused.map((u) => {
    const name = esc(u.key)
    const message = esc(`Unused key "${u.key}" (defined in: ${u.locales.join(', ')}${u.file ? ` — ${u.file}` : ''})`)
    return [
      `    <testcase name="${name}" classname="usage.unused">`,
      `      <failure message="${message}">${message}</failure>`,
      `    </testcase>`,
    ].join('\n')
  })

  const coverage = [...summary.coverage].sort((a, b) => (a.locale < b.locale ? -1 : 1))
  const coverageCases = coverage.map((c) => {
    const name = esc(c.locale)
    const okMessage = esc(`Coverage for "${c.locale}": ${c.percentage}% (${c.translated}/${c.total})`)
    return [
      `    <testcase name="${name}" classname="usage.coverage">`,
      `      <system-out>${okMessage}</system-out>`,
      `    </testcase>`,
    ].join('\n')
  })

  const diagnostics = [...summary.localeDiagnostics].sort((a, b) => (a.file < b.file ? -1 : 1))
  const diagnosticCases = diagnostics.map((d) => {
    const name = esc(d.file)
    const message = esc(`${d.severity}: ${d.message} (${d.file})`)
    return [
      `    <testcase name="${name}" classname="usage.locale-errors">`,
      `      <failure message="${message}">${message}</failure>`,
      `    </testcase>`,
    ].join('\n')
  })

  const suites = [
    suite('usage.missing', missingCases, missingCases.length),
    suite('usage.unused', unusedCases, unusedCases.length),
    suite('usage.coverage', coverageCases, 0),
    suite('usage.locale-errors', diagnosticCases, diagnosticCases.length),
  ]

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testsuites>',
    ...suites,
    '</testsuites>',
    '',
  ].join('\n')
}
