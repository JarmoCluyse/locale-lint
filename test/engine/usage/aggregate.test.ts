import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveConfig } from '../../../src/runtime/ConfigResolver'
import { installRuntime, _resetRuntimeForTests } from '../../../src/shims/core-global'
import { CurrentFile, _resetCurrentFileForTests } from '../../../src/shims/current-file'
import { LocaleStore } from '../../../src/engine/LocaleStore'
import { aggregateUsage } from '../../../src/engine/usage/aggregate'
import type { KeyOccurrence } from '../../../src/engine/usage/types'

const PROJECTS = join(__dirname, '..', '..', 'fixtures', 'projects')

function occ(key: string, file = 'src/App.tsx', line = 1, column = 1): KeyOccurrence {
  return { key, file, line, column, endLine: line, endColumn: column + key.length }
}

async function makeStore(dir: string, cliFlags: Record<string, unknown> = {}) {
  const { config } = resolveConfig({
    root: join(PROJECTS, dir),
    skipVscodeLayer: true,
    skipRootConfigLayer: true,
    cliFlags: { localesPaths: ['locales'], frameworks: ['react-i18next'], ...cliFlags },
  })
  await installRuntime({ config })
  const store = new LocaleStore(config)
  CurrentFile.loader = store
  await store.load()
  return { store, config }
}

describe('aggregateUsage', () => {
  afterEach(() => {
    _resetRuntimeForTests()
    _resetCurrentFileForTests()
  })

  it('flags used-but-undefined keys as missing in every locale', async () => {
    const { store, config } = await makeStore('usage')
    const result = aggregateUsage(store, [occ('greeting'), occ('totally.made.up')], { keysInUse: config.keysInUse, rootpath: config.rootpath })
    const madeUp = result.missing.filter(m => m.key === 'totally.made.up')
    expect(madeUp.map(m => m.locale).sort()).toEqual(['en', 'fr'])
  })

  it('does not flag a used + fully-defined key as missing', async () => {
    const { store, config } = await makeStore('usage')
    const result = aggregateUsage(store, [occ('greeting')], { keysInUse: config.keysInUse, rootpath: config.rootpath })
    expect(result.missing.some(m => m.key === 'greeting')).toBe(false)
  })

  it('"keysInUse" glob allow-list suppresses matching keys from "unused"', async () => {
    const { store, config } = await makeStore('usage')
    const withoutAllowList = aggregateUsage(store, [], { keysInUse: [], rootpath: config.rootpath })
    expect(withoutAllowList.unused.map(u => u.key)).toContain('unused_key')

    const withAllowList = aggregateUsage(store, [], { keysInUse: ['unused_key'], rootpath: config.rootpath })
    expect(withAllowList.unused.map(u => u.key)).not.toContain('unused_key')
  })

  it('reports unused-key locale file paths as rootpath-relative', async () => {
    const { store, config } = await makeStore('usage')
    const result = aggregateUsage(store, [], { keysInUse: config.keysInUse, rootpath: config.rootpath })
    for (const u of result.unused) {
      expect(u.file.startsWith('/')).toBe(false)
      expect(u.file).not.toContain(config.rootpath)
    }
  })

  it('counts multiple occurrences of the same missing key', async () => {
    const { store, config } = await makeStore('usage')
    const result = aggregateUsage(
      store,
      [occ('a.b.c', 'x.ts', 1, 1), occ('a.b.c', 'x.ts', 5, 1), occ('a.b.c', 'y.ts', 2, 1)],
      { keysInUse: config.keysInUse, rootpath: config.rootpath },
    )
    const entries = result.missing.filter(m => m.key === 'a.b.c' && m.locale === 'en')
    expect(entries).toHaveLength(1)
    expect(entries[0].occurrenceCount).toBe(3)
    // first occurrence sorted by file -> line -> column
    expect(entries[0].file).toBe('x.ts')
    expect(entries[0].line).toBe(1)
  })
})
