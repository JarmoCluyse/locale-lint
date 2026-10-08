import { describe, expect, it } from 'vitest'
import { evaluateGate, EXIT_SUCCESS, EXIT_HARD_STRING_GATE, EXIT_NO_FILES_MATCHED, EXIT_PARSE_ERRORS_EXCEEDED } from '../../src/report/gate'
import type { ScanSummary } from '../../src/engine/types'

function summary(overrides: Partial<ScanSummary> = {}): ScanSummary {
  return {
    filesScanned: 1,
    filesSkipped: [],
    findings: [],
    durationMs: 1,
    ...overrides,
  }
}

describe('evaluateGate', () => {
  it('exits 0 when no findings and files were scanned', () => {
    expect(evaluateGate(summary()).exitCode).toBe(EXIT_SUCCESS)
  })

  it('exits 11 when zero files were scanned, even with zero findings', () => {
    const result = evaluateGate(summary({ filesScanned: 0 }))
    expect(result.exitCode).toBe(EXIT_NO_FILES_MATCHED)
  })

  it('exits 11 even when warnOnly is set (zero-files is never overridable)', () => {
    const result = evaluateGate(summary({ filesScanned: 0 }), { warnOnly: true })
    expect(result.exitCode).toBe(EXIT_NO_FILES_MATCHED)
  })

  it('exits 3 when findings exceed maxHardStrings', () => {
    const result = evaluateGate(summary({
      findings: [{ file: 'a.ts', line: 1, column: 1, endLine: 1, endColumn: 2, text: 'x', source: 'js-string', languageId: 'typescript' }],
    }))
    expect(result.exitCode).toBe(EXIT_HARD_STRING_GATE)
  })

  it('allows findings under maxHardStrings', () => {
    const result = evaluateGate(summary({
      findings: [{ file: 'a.ts', line: 1, column: 1, endLine: 1, endColumn: 2, text: 'x', source: 'js-string', languageId: 'typescript' }],
    }), { maxHardStrings: 5 })
    expect(result.exitCode).toBe(EXIT_SUCCESS)
  })

  it('--warn-only forces exit 0 even when the hard-string gate is violated', () => {
    const result = evaluateGate(summary({
      findings: [{ file: 'a.ts', line: 1, column: 1, endLine: 1, endColumn: 2, text: 'x', source: 'js-string', languageId: 'typescript' }],
    }), { warnOnly: true })
    expect(result.exitCode).toBe(EXIT_SUCCESS)
  })

  it('exits 12 when parse errors exceed tolerance', () => {
    const result = evaluateGate(summary({
      filesSkipped: [
        { file: 'a.ts', reason: 'parse-error' },
        { file: 'b.ts', reason: 'parse-error' },
      ],
    }), { maxParseErrors: 1 })
    expect(result.exitCode).toBe(EXIT_PARSE_ERRORS_EXCEEDED)
  })

  it('does not count non-parse-error skips toward the parse-error tolerance', () => {
    const result = evaluateGate(summary({
      filesSkipped: [{ file: 'a.bin', reason: 'binary' }],
    }), { maxParseErrors: 0 })
    expect(result.exitCode).toBe(EXIT_SUCCESS)
  })
})
