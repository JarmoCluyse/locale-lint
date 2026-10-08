// Human-readable text report — grouped by file, with a summary line.
import type { ScanSummary } from '../engine/types'

export function renderTextReport(summary: ScanSummary): string {
  const lines: string[] = []

  const byFile = new Map<string, typeof summary.findings>()
  for (const f of summary.findings) {
    if (!byFile.has(f.file))
      byFile.set(f.file, [])
    byFile.get(f.file)!.push(f)
  }

  const files = [...byFile.keys()].sort()
  for (const file of files) {
    lines.push(file)
    const findings = [...byFile.get(file)!].sort((a, b) => a.line - b.line || a.column - b.column)
    for (const f of findings)
      lines.push(`  ${f.line}:${f.column}  ${f.source}  ${JSON.stringify(f.text)}`)
    lines.push('')
  }

  if (summary.filesSkipped.length) {
    lines.push('Skipped files:')
    for (const s of [...summary.filesSkipped].sort((a, b) => a.file < b.file ? -1 : 1))
      lines.push(`  ${s.file} (${s.reason}${s.detail ? `: ${s.detail}` : ''})`)
    lines.push('')
  }

  lines.push(
    `Summary: ${summary.filesScanned} file(s) scanned, `
    + `${summary.filesSkipped.length} skipped, `
    + `${summary.findings.length} hard-coded string(s) found `
    + `(${summary.durationMs}ms)`,
  )

  return `${lines.join('\n')}\n`
}
