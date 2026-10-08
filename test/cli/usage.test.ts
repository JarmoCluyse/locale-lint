import { join } from 'node:path'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args'
import { runUsage, runScan } from '../../src/cli/commands'
import { EXIT_SUCCESS, EXIT_NO_FILES_MATCHED } from '../../src/report/gate'
import { EXIT_MISSING_GATE, EXIT_UNUSED_GATE, EXIT_MULTIPLE_GATE } from '../../src/report/usage/gate'
import { EXIT_HARD_STRING_GATE } from '../../src/report/gate'
import { _resetRuntimeForTests } from '../../src/shims/core-global'
import { _resetCurrentFileForTests } from '../../src/shims/current-file'

const PROJECTS = join(__dirname, '..', 'fixtures', 'projects')
const USAGE_ROOT = join(PROJECTS, 'usage')

function baseUsageArgs(extra: string[] = []) {
  return parseArgs(['usage', '--root', USAGE_ROOT, '--no-vscode-config', ...extra])
}

describe('cli usage command', () => {
  afterEach(() => {
    _resetRuntimeForTests()
    _resetCurrentFileForTests()
  })

  it('exits 1 by default (missing keys present, strict default)', async () => {
    const result = await runUsage(baseUsageArgs())
    expect(result.exitCode).toBe(EXIT_MISSING_GATE)
  })

  it('exits 0 when --max-missing is generous and unused is left at default (warn)', async () => {
    const result = await runUsage(baseUsageArgs(['--max-missing', '100']))
    expect(result.exitCode).toBe(EXIT_SUCCESS)
  })

  it('exits 2 when unused gate is opted into and violated, with missing suppressed', async () => {
    const result = await runUsage(baseUsageArgs(['--max-missing', '100', '--max-unused', '0']))
    expect(result.exitCode).toBe(EXIT_UNUSED_GATE)
  })

  it('exits 4 when both missing and unused gates are violated', async () => {
    const result = await runUsage(baseUsageArgs(['--max-unused', '0']))
    expect(result.exitCode).toBe(EXIT_MULTIPLE_GATE)
  })

  it('--warn-only forces exit 0 while still emitting the report', async () => {
    const result = await runUsage(baseUsageArgs(['--warn-only', '--format', 'json']))
    expect(result.exitCode).toBe(EXIT_SUCCESS)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.summary.missingCount).toBeGreaterThan(0)
  })

  it('exits 11 when no files match', async () => {
    const result = await runUsage(parseArgs(['usage', '--root', USAGE_ROOT, 'no-such-dir', '--no-vscode-config', '--quiet']))
    expect(result.exitCode).toBe(EXIT_NO_FILES_MATCHED)
  })

  it('emits valid, parseable JSON on stdout with --format json', async () => {
    const result = await runUsage(baseUsageArgs(['--format', 'json', '--max-missing', '100']))
    const parsed = JSON.parse(result.stdout)
    expect(parsed.schemaVersion).toBe(1)
    expect(Array.isArray(parsed.missing)).toBe(true)
    expect(Array.isArray(parsed.unused)).toBe(true)
  })

  it('a second identical run is byte-identical (determinism)', async () => {
    const a = await runUsage(baseUsageArgs(['--format', 'json', '--max-missing', '100']))
    const b = await runUsage(baseUsageArgs(['--format', 'json', '--max-missing', '100']))
    expect(a.stdout).toBe(b.stdout)
  })

  describe('baseline', () => {
    let dir: string

    afterEach(async () => {
      if (dir)
        await rm(dir, { recursive: true, force: true })
    })

    it('--update-baseline writes a baseline file and exits 0', async () => {
      dir = await mkdtemp(join(tmpdir(), 'locale-lint-baseline-'))
      const baselinePath = join(dir, 'baseline.json')
      const result = await runUsage(baseUsageArgs(['--baseline', baselinePath, '--update-baseline']))
      expect(result.exitCode).toBe(EXIT_SUCCESS)
      const raw = await readFile(baselinePath, 'utf8')
      const parsed = JSON.parse(raw)
      expect(parsed.missing.length).toBeGreaterThan(0)
    })

    it('a subsequent run against that baseline has no NEW violations and exits 0', async () => {
      dir = await mkdtemp(join(tmpdir(), 'locale-lint-baseline-'))
      const baselinePath = join(dir, 'baseline.json')
      await runUsage(baseUsageArgs(['--baseline', baselinePath, '--update-baseline']))

      const result = await runUsage(baseUsageArgs(['--baseline', baselinePath]))
      expect(result.exitCode).toBe(EXIT_SUCCESS)
    })

    it('a run against a non-existent baseline file treats it as empty (first-run UX)', async () => {
      dir = await mkdtemp(join(tmpdir(), 'locale-lint-baseline-'))
      const baselinePath = join(dir, 'does-not-exist.json')
      const result = await runUsage(baseUsageArgs(['--baseline', baselinePath]))
      expect(result.exitCode).toBe(EXIT_MISSING_GATE)
    })
  })
})

describe('cli scan command', () => {
  afterEach(() => {
    _resetRuntimeForTests()
    _resetCurrentFileForTests()
  })

  it('runs both scanners and merges into one JSON report', async () => {
    const args = parseArgs(['scan', '--root', USAGE_ROOT, '--no-vscode-config', '--format', 'json', '--max-missing', '100', '--max-hard-strings', '100'])
    const result = await runScan(args)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.hardString).toBeDefined()
    expect(parsed.usage).toBeDefined()
    expect(parsed.hardString.schemaVersion).toBe(1)
    expect(parsed.usage.schemaVersion).toBe(1)
  })

  it('exits 4 when both a hard-string violation and a usage violation are present', async () => {
    const args = parseArgs(['scan', '--root', USAGE_ROOT, '--no-vscode-config', '--max-unused', '0'])
    const result = await runScan(args)
    expect(result.exitCode).toBe(EXIT_MULTIPLE_GATE)
  })

  it('merged JUnit report has testsuites from both scanners under one root', async () => {
    const args = parseArgs(['scan', '--root', USAGE_ROOT, '--no-vscode-config', '--format', 'junit', '--max-missing', '100', '--max-hard-strings', '100'])
    const result = await runScan(args)
    expect(result.stdout).toContain('<testsuite name="hardstring"')
    expect(result.stdout).toContain('<testsuite name="usage.missing"')
    const opens = (result.stdout.match(/<testsuites>/g) || []).length
    expect(opens).toBe(1)
  })

  it('a second identical run is byte-identical (determinism)', async () => {
    const args = parseArgs(['scan', '--root', USAGE_ROOT, '--no-vscode-config', '--format', 'json', '--max-missing', '100', '--max-hard-strings', '100'])
    const a = await runScan(args)
    const b = await runScan(args)
    expect(a.stdout).toBe(b.stdout)
  })
})
