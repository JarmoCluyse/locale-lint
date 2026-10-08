import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveConfig } from '../../../src/runtime/ConfigResolver'
import { scanUsageProject } from '../../../src/engine/UsageScanner'
import { _resetRuntimeForTests } from '../../../src/shims/core-global'
import { _resetCurrentFileForTests } from '../../../src/shims/current-file'

const PROJECTS = join(__dirname, '..', '..', 'fixtures', 'projects')

function resolveFixtureConfig(name: string, cliFlags: Record<string, unknown> = {}) {
  return resolveConfig({
    root: join(PROJECTS, name),
    skipVscodeLayer: true,
    skipRootConfigLayer: true,
    cliFlags: { localesPaths: ['locales'], frameworks: ['react-i18next'], ...cliFlags },
  }).config
}

describe('scanUsageProject — usage fixture', () => {
  afterEach(() => {
    _resetRuntimeForTests()
    _resetCurrentFileForTests()
  })

  it('finds known missing keys, per-locale', async () => {
    const config = resolveFixtureConfig('usage')
    const summary = await scanUsageProject({ config })

    const missingByKeyLocale = summary.missing.map(m => `${m.key}@${m.locale}`).sort()
    expect(missingByKeyLocale).toEqual([
      'farewell@fr',
      'missing.key@en',
      'missing.key@fr',
      'only.in.block.comment@en',
      'only.in.block.comment@fr',
      'only.in.line.comment@en',
      'only.in.line.comment@fr',
    ])
  })

  it('"farewell" is missing ONLY in fr (present + used in en)', async () => {
    const config = resolveFixtureConfig('usage')
    const summary = await scanUsageProject({ config })
    const farewell = summary.missing.filter(m => m.key === 'farewell')
    expect(farewell).toHaveLength(1)
    expect(farewell[0].locale).toBe('fr')
  })

  it('finds known unused keys', async () => {
    const config = resolveFixtureConfig('usage')
    const summary = await scanUsageProject({ config })
    expect(summary.unused.map(u => u.key).sort()).toEqual(['errors.notFound', 'errors.timeout', 'unused_key'])
  })

  it('"greeting" is neither missing nor unused (used + defined in both locales)', async () => {
    const config = resolveFixtureConfig('usage')
    const summary = await scanUsageProject({ config })
    expect(summary.missing.some(m => m.key === 'greeting')).toBe(false)
    expect(summary.unused.some(u => u.key === 'greeting')).toBe(false)
  })

  it('computes per-locale and overall coverage', async () => {
    const config = resolveFixtureConfig('usage')
    const summary = await scanUsageProject({ config })
    const byLocale = Object.fromEntries(summary.coverage.map(c => [c.locale, c]))
    expect(byLocale.en.percentage).toBe(100)
    expect(byLocale.fr.percentage).toBe(80)
    expect(summary.overallCoverage).toBe(90)
  })

  it('detects the documented dynamic-key usage and emits a caveat', async () => {
    const config = resolveFixtureConfig('usage')
    const summary = await scanUsageProject({ config })
    expect(summary.dynamicKeyUsages).toHaveLength(1)
    expect(summary.dynamicKeyUsages[0].snippet).toContain('errors.${code}')
    expect(summary.caveats).toHaveLength(1)
    expect(summary.caveats[0]).toMatch(/1 dynamic key usage\(s\) detected in 1 file\(s\)/)
  })

  it('reports rootpath-relative paths only (no absolute paths anywhere)', async () => {
    const config = resolveFixtureConfig('usage')
    const summary = await scanUsageProject({ config })
    const json = JSON.stringify(summary)
    expect(json).not.toContain(config.rootpath)
  })

  describe('comment-counting regression (CRITICAL — do not "fix" by stripping comments)', () => {
    it('counts a key referenced ONLY inside a `//` line comment as used', async () => {
      const config = resolveFixtureConfig('usage')
      const summary = await scanUsageProject({ config })
      // "used" here means: it shows up as a MISSING-key usage (undefined in
      // locales) rather than being invisible to the scanner entirely. If a
      // future change stripped comments before scanning, this key would
      // vanish from `missing` and from occurrence counts altogether.
      const entries = summary.missing.filter(m => m.key === 'only.in.line.comment')
      expect(entries.length).toBeGreaterThan(0)
      expect(entries.every(e => e.occurrenceCount === 1)).toBe(true)
    })

    it('counts a key referenced ONLY inside a `/* */` block comment as used', async () => {
      const config = resolveFixtureConfig('usage')
      const summary = await scanUsageProject({ config })
      const entries = summary.missing.filter(m => m.key === 'only.in.block.comment')
      expect(entries.length).toBeGreaterThan(0)
      expect(entries.every(e => e.occurrenceCount === 1)).toBe(true)
    })
  })

  it('never exits success semantics at engine level when 0 files matched (filesScanned === 0)', async () => {
    const config = resolveFixtureConfig('usage')
    const summary = await scanUsageProject({ config, patterns: ['**/*.nonexistent-ext'] })
    expect(summary.filesScanned).toBe(0)
    expect(summary.missing).toEqual([])
  })
})
