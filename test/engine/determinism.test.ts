import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../../src/runtime/ConfigResolver'
import { scanProject } from '../../src/engine'
import { renderJsonReport } from '../../src/report/json'

const PROJECTS = join(__dirname, '..', 'fixtures', 'projects')

describe('JSON report determinism', () => {
  it('produces byte-identical output across repeated runs', async () => {
    const config = resolveConfig({ root: join(PROJECTS, 'vue'), skipVscodeLayer: true, skipRootConfigLayer: true }).config

    const first = renderJsonReport(await scanProject({ config }))
    const second = renderJsonReport(await scanProject({ config }))

    expect(first).toBe(second)
  })

  it('sorts findings by file, then line, then column', async () => {
    const config = resolveConfig({ root: join(PROJECTS, 'react'), skipVscodeLayer: true, skipRootConfigLayer: true }).config
    const report = JSON.parse(renderJsonReport(await scanProject({ config })))

    const findings = report.findings
    for (let i = 1; i < findings.length; i++) {
      const a = findings[i - 1]
      const b = findings[i]
      const key = (f: any) => [f.file, f.line, f.column]
      expect(key(a) <= key(b) || a.file < b.file).toBeTruthy()
    }
  })

  it('never includes absolute paths or timestamps', async () => {
    const config = resolveConfig({ root: join(PROJECTS, 'vue'), skipVscodeLayer: true, skipRootConfigLayer: true }).config
    const report = renderJsonReport(await scanProject({ config }))
    expect(report).not.toContain(config.rootpath)
    expect(report).not.toMatch(/"durationMs"|"timestamp"/)
  })
})
