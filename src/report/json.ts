// Deterministic JSON report — sorted by file then line then column, no
// timestamps, no absolute paths (all paths relative to rootpath already).
// This is intended to become the golden-output format for a future Go port's
// conformance suite, so determinism is load-bearing: run twice, byte-identical.
import type { HardStringFinding, ScanSummary, SkippedFile } from '../engine/types'

export interface JsonReportFinding {
  file: string
  line: number
  column: number
  endLine: number
  endColumn: number
  text: string
  source: string
  languageId: string
}

export interface JsonReport {
  schemaVersion: 1
  summary: {
    filesScanned: number
    filesSkipped: number
    findingsCount: number
  }
  findings: JsonReportFinding[]
  skipped: SkippedFile[]
}

function compareFindings(a: HardStringFinding, b: HardStringFinding): number {
  if (a.file !== b.file)
    return a.file < b.file ? -1 : 1
  if (a.line !== b.line)
    return a.line - b.line
  if (a.column !== b.column)
    return a.column - b.column
  if (a.text !== b.text)
    return a.text < b.text ? -1 : 1
  return 0
}

function compareSkipped(a: SkippedFile, b: SkippedFile): number {
  return a.file < b.file ? -1 : a.file > b.file ? 1 : 0
}

export function buildJsonReport(summary: ScanSummary): JsonReport {
  const findings = [...summary.findings].sort(compareFindings).map(f => ({
    file: f.file,
    line: f.line,
    column: f.column,
    endLine: f.endLine,
    endColumn: f.endColumn,
    text: f.text,
    source: f.source,
    languageId: f.languageId,
  }))
  const skipped = [...summary.filesSkipped].sort(compareSkipped)

  return {
    schemaVersion: 1,
    summary: {
      filesScanned: summary.filesScanned,
      filesSkipped: skipped.length,
      findingsCount: findings.length,
    },
    findings,
    skipped,
  }
}

/** Stable stringify: object key order is already deterministic via object
 * literal construction above (insertion order === declared order), so plain
 * JSON.stringify with a fixed indent is sufficient — no key-sorting library
 * needed since we never spread user-provided objects with unordered keys
 * into the output. */
export function renderJsonReport(summary: ScanSummary): string {
  return `${JSON.stringify(buildJsonReport(summary), null, 2)}\n`
}
