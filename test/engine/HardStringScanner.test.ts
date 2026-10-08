import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../../src/runtime/ConfigResolver'
import { scanProject } from '../../src/engine'

const PROJECTS = join(__dirname, '..', 'fixtures', 'projects')

function resolveFixtureConfig(name: string) {
  return resolveConfig({ root: join(PROJECTS, name), skipVscodeLayer: true, skipRootConfigLayer: true }).config
}

describe('scanProject — hard-string scanner fixtures', () => {
  it('finds the expected hard strings in the vue fixture, and ignores the rest', async () => {
    const config = resolveFixtureConfig('vue')
    const summary = await scanProject({ config })

    expect(summary.filesScanned).toBe(1)
    expect(summary.filesSkipped).toEqual([])

    const texts = summary.findings.map(f => f.text).sort()
    expect(texts).toEqual(['Add to cart', 'Click me to continue', 'Welcome to our store'])

    // ignored: placeholder="search" (all-lowercase, no space), the {{ count }}
    // mustache interpolation, "$9.99" (no letters), and the console.log arg.
    expect(texts).not.toContain('search')
    expect(texts.join(' ')).not.toContain('debug click handler fired')
    expect(texts.join(' ')).not.toContain('$9.99')
  })

  it('finds the expected hard strings in the react fixture, and ignores the rest', async () => {
    const config = resolveFixtureConfig('react')
    const summary = await scanProject({ config })

    expect(summary.filesScanned).toBe(1)
    expect(summary.filesSkipped).toEqual([])

    const texts = summary.findings.map(f => f.text).sort()
    expect(texts).toEqual(['Welcome back, friend', 'close dialog'])

    expect(texts.join(' ')).not.toContain('render header debug')
    expect(texts).not.toContain('ok')
  })

  it('reports absolute-free, rootpath-relative paths', async () => {
    const config = resolveFixtureConfig('vue')
    const summary = await scanProject({ config })
    for (const f of summary.findings) {
      expect(f.file.startsWith('/')).toBe(false)
      expect(f.file).not.toContain(config.rootpath)
    }
  })

  it('never exits success semantics upstream when 0 files matched (engine-level: filesScanned === 0)', async () => {
    const config = resolveFixtureConfig('vue')
    const summary = await scanProject({ config, patterns: ['**/*.nonexistent-ext'] })
    expect(summary.filesScanned).toBe(0)
    expect(summary.findings).toEqual([])
  })
})
