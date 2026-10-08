// JUnit XML report — one <testsuite> per category, one <testcase> per
// occurrence, with file/line in the failure message so GitHub/GitLab
// annotate inline.
import type { ScanSummary } from '../engine/types'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderJunitReport(summary: ScanSummary): string {
  const findings = [...summary.findings].sort((a, b) => (
    a.file !== b.file ? (a.file < b.file ? -1 : 1) : a.line - b.line || a.column - b.column
  ))

  const testcases = findings.map((f) => {
    const name = esc(`${f.file}:${f.line}:${f.column}`)
    const message = esc(`Hard-coded string at ${f.file}:${f.line}:${f.column} — ${JSON.stringify(f.text)}`)
    return [
      `    <testcase name="${name}" classname="hardstring.${esc(f.file)}">`,
      `      <failure message="${message}">${message}</failure>`,
      `    </testcase>`,
    ].join('\n')
  })

  const suite = [
    `  <testsuite name="hardstring" tests="${findings.length}" failures="${findings.length}" errors="0" skipped="${summary.filesSkipped.length}">`,
    ...testcases,
    `  </testsuite>`,
  ].join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testsuites>',
    suite,
    '</testsuites>',
    '',
  ].join('\n')
}
