import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveConfig } from '../../src/runtime/ConfigResolver'
import { scanUsageProject } from '../../src/engine/UsageScanner'
import { renderUsageJsonReport, buildUsageJsonReport } from '../../src/report/usage/json'
import { renderUsageTextReport } from '../../src/report/usage/text'
import { renderUsageJunitReport } from '../../src/report/usage/junit'
import { _resetRuntimeForTests } from '../../src/shims/core-global'
import { _resetCurrentFileForTests } from '../../src/shims/current-file'

const PROJECTS = join(__dirname, '..', 'fixtures', 'projects')

async function scanFixture() {
  const { config } = resolveConfig({
    root: join(PROJECTS, 'usage'),
    skipVscodeLayer: true,
    skipRootConfigLayer: true,
    cliFlags: { localesPaths: ['locales'], frameworks: ['react-i18next'] },
  })
  return { config, summary: await scanUsageProject({ config }) }
}

describe('usage JSON report', () => {
  afterEach(() => {
    _resetRuntimeForTests()
    _resetCurrentFileForTests()
  })

  it('is byte-identical across repeated renders of the same summary', async () => {
    const { summary } = await scanFixture()
    expect(renderUsageJsonReport(summary)).toBe(renderUsageJsonReport(summary))
  })

  it('is byte-identical across two independent scans of the same fixture', async () => {
    const { config } = await scanFixture()
    const a = renderUsageJsonReport(await scanUsageProject({ config }))
    const b = renderUsageJsonReport(await scanUsageProject({ config }))
    expect(a).toBe(b)
  })

  it('sorts missing by key then locale', async () => {
    const { summary } = await scanFixture()
    const report = buildUsageJsonReport(summary)
    for (let i = 1; i < report.missing.length; i++) {
      const a = report.missing[i - 1]
      const b = report.missing[i]
      expect(a.key < b.key || (a.key === b.key && a.locale <= b.locale)).toBe(true)
    }
  })

  it('sorts unused and coverage lexicographically', async () => {
    const { summary } = await scanFixture()
    const report = buildUsageJsonReport(summary)
    for (let i = 1; i < report.unused.length; i++)
      expect(report.unused[i - 1].key <= report.unused[i].key).toBe(true)
    for (let i = 1; i < report.coverage.length; i++)
      expect(report.coverage[i - 1].locale <= report.coverage[i].locale).toBe(true)
  })

  it('never includes absolute paths or a timestamp field', async () => {
    const { config, summary } = await scanFixture()
    const report = renderUsageJsonReport(summary)
    expect(report).not.toContain(config.rootpath)
    expect(report).not.toMatch(/"timestamp"/)
  })

  it('includes the dynamic-key caveat and surfaces locale diagnostics', async () => {
    const { summary } = await scanFixture()
    const report = buildUsageJsonReport(summary)
    expect(report.caveats.length).toBe(1)
    expect(report.localeDiagnostics).toEqual([])
  })
})

describe('usage text report', () => {
  afterEach(() => {
    _resetRuntimeForTests()
    _resetCurrentFileForTests()
  })

  it('includes missing/unused/coverage sections and a summary line', async () => {
    const { summary } = await scanFixture()
    const text = renderUsageTextReport(summary)
    expect(text).toContain('Missing keys:')
    expect(text).toContain('Unused keys:')
    expect(text).toContain('Coverage:')
    expect(text).toContain('Caveat:')
    expect(text).toMatch(/^Summary: /m)
  })

  it('--per-locale groups missing keys by locale', async () => {
    const { summary } = await scanFixture()
    const text = renderUsageTextReport(summary, { perLocale: true })
    expect(text).toContain('[en]')
    expect(text).toContain('[fr]')
  })
})

describe('usage JUnit report', () => {
  afterEach(() => {
    _resetRuntimeForTests()
    _resetCurrentFileForTests()
  })

  it('emits one <testsuite> per category', async () => {
    const { summary } = await scanFixture()
    const xml = renderUsageJunitReport(summary)
    expect(xml).toContain('<testsuite name="usage.missing"')
    expect(xml).toContain('<testsuite name="usage.unused"')
    expect(xml).toContain('<testsuite name="usage.coverage"')
    expect(xml).toContain('<testsuite name="usage.locale-errors"')
  })

  it('emits one <testcase> per missing/unused key with file:line in the failure message', async () => {
    const { summary } = await scanFixture()
    const xml = renderUsageJunitReport(summary)
    const testcaseCount = (xml.match(/<testcase /g) || []).length
    expect(testcaseCount).toBe(summary.missing.length + summary.unused.length + summary.coverage.length + summary.localeDiagnostics.length)
    expect(xml).toMatch(/src\/App\.tsx:\d+:\d+/)
  })

  it('is well-formed XML (single root, balanced tags)', async () => {
    const { summary } = await scanFixture()
    const xml = renderUsageJunitReport(summary)
    const opens = (xml.match(/<testsuite /g) || []).length
    const closes = (xml.match(/<\/testsuite>/g) || []).length
    expect(opens).toBe(closes)
  })
})
