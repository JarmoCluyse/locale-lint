import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Config, Global, _resetRuntimeForTests, installRuntime } from '../../src/shims/core-global'
import { DEFAULT_CONFIG } from '../../src/runtime/ConfigResolver'
import type { ResolvedConfig } from '../../src/runtime/types'

const FIXTURES = join(__dirname, '..', 'fixtures', 'frameworks')

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  // Default to a fixture root with no manifest at all, so tests that don't
  // care about framework (auto-)detection aren't accidentally sensitive to
  // this repo's own package.json dependencies.
  return { ...DEFAULT_CONFIG, rootpath: join(FIXTURES, 'does-not-exist'), ...overrides } as ResolvedConfig
}

describe('shims/core-global', () => {
  beforeEach(() => {
    _resetRuntimeForTests()
  })

  it('throws a clear, actionable error naming the member when accessed before installRuntime', () => {
    expect(() => Config.sourceLanguage).toThrow(/Config\.sourceLanguage.*installRuntime/s)
    expect(() => Global.rootpath).toThrow(/Global\.rootpath.*installRuntime/s)
  })

  it('Config.readonly is always true', () => {
    installRuntime({ config: makeConfig({ readonly: false as any }) })
    expect(Config.readonly).toBe(true)
  })

  it('Config.regexKey falls back to KEY_REG_DEFAULT / KEY_REG_ALL', () => {
    installRuntime({ config: makeConfig({ disablePathParsing: false }) })
    expect(Config.regexKey).toBe('[\\w\\d\\. \\-\\[\\]\\/:]*?')

    installRuntime({ config: makeConfig({ disablePathParsing: true }) })
    expect(Config.regexKey).toBe('.*?')

    installRuntime({ config: makeConfig({ regexKey: 'custom-{x}' }) })
    expect(Config.regexKey).toBe('custom-{x}')
  })

  it('Global.getUsageMatchRegex memoises per languageId and interpolates {key}', () => {
    installRuntime({
      config: makeConfig({
        regexUsageMatch: ['t\\((\'{key}\')\\)'],
        regexKey: 'K+',
      }),
    })

    const first = Global.getUsageMatchRegex('javascript', '/a.js')
    const second = Global.getUsageMatchRegex('javascript', '/a.js')
    expect(first).toBe(second) // same reference => memoised

    // {key} interpolated with regexKey
    expect(first[0].source).toContain('K+')
  })

  it('Global.getUsageMatchRegex recomputes for a different languageId when no custom regexUsageMatch is set', () => {
    // frameworks: [] falls through to auto-detection (empty at this
    // fixture root), which would now throw per the must-fix empty-regex
    // guard — supply regexUsageMatchAppend so there's always ≥1 pattern,
    // keeping this test about per-languageId memoisation, not emptiness.
    installRuntime({ config: makeConfig({ frameworks: [], regexUsageMatchAppend: ['t\\((\'{key}\')\\)'] }) })
    const a = Global.getUsageMatchRegex('javascript', '/a.js')
    const b = Global.getUsageMatchRegex('typescript', '/b.ts')
    expect(a).not.toBe(b)
  })

  it('Global.getUsageMatchRegex throws (never silently returns []) when no frameworks and no custom regex are configured', () => {
    installRuntime({ config: makeConfig({ frameworks: [] }) })
    expect(() => Global.getUsageMatchRegex('javascript', '/a.js')).toThrow(/getUsageMatchRegex.*empty regex list/s)
  })

  it('Global.getUsageMatchRegex throws if every custom regex.usageMatch pattern fails to parse', () => {
    installRuntime({ config: makeConfig({ regexUsageMatch: ['[unclosed('] }) })
    expect(() => Global.getUsageMatchRegex()).toThrow(/regex\.usageMatch.*invalid patterns/s)
  })

  it('Global.enabledFrameworks resolves from config.frameworks, empty by default', () => {
    installRuntime({ config: makeConfig() })
    expect(Global.enabledFrameworks).toEqual([])

    installRuntime({ config: makeConfig({ frameworks: ['vue'] }) })
    expect(Global.enabledFrameworks.map((f: any) => f.id)).toEqual(['vue'])
  })

  it('Global.enabledFrameworks auto-detects from the project root when config.frameworks is unset', () => {
    installRuntime({ config: makeConfig({ rootpath: join(FIXTURES, 'vue') }) })
    expect(Global.enabledFrameworks.map((f: any) => f.id)).toContain('vue')
  })

  it('explicit config.frameworks always wins over auto-detection, even if detection would disagree', () => {
    // root clearly detects as "vue", but an explicit list should override it
    installRuntime({ config: makeConfig({ rootpath: join(FIXTURES, 'vue'), frameworks: ['react-i18next'] }) })
    expect(Global.enabledFrameworks.map((f: any) => f.id)).toEqual(['react-i18next'])
  })

  it('auto-detection runs ONCE per process (memoised), not per access', () => {
    installRuntime({ config: makeConfig({ rootpath: join(FIXTURES, 'vue') }) })
    const first = Global.enabledFrameworks
    const second = Global.enabledFrameworks
    expect(first).toBe(second) // same array reference => detection cached, not re-run

    // a fresh installRuntime() must re-detect (cache invalidated)
    installRuntime({ config: makeConfig({ rootpath: join(FIXTURES, 'react-i18next') }) })
    const third = Global.enabledFrameworks
    expect(third).not.toBe(first)
    expect(third.map((f: any) => f.id)).toContain('react-i18next')
  })

  it('Global.update is no longer part of the shim surface', () => {
    installRuntime({ config: makeConfig() })
    expect(() => (Global as any).update).toThrow(/Global\.update.*not implemented/s)
  })

  it('Config.keysInUse is settable and read back', () => {
    installRuntime({ config: makeConfig({ keysInUse: ['a.b'] }) })
    expect(Config.keysInUse).toEqual(['a.b'])
    Config.keysInUse = ['c.d']
    expect(Config.keysInUse).toEqual(['c.d'])
  })

  it('Config.localeCountryMap defaults to {} and reflects config', () => {
    installRuntime({ config: makeConfig() })
    expect(Config.localeCountryMap).toEqual({})

    installRuntime({ config: makeConfig({ localeCountryMap: { en: 'us' } }) })
    expect(Config.localeCountryMap).toEqual({ en: 'us' })
  })

  describe('Global.enabledParsers (BUG 1 regression)', () => {
    it('resolves a non-empty list containing JSON and YAML parsers by default', () => {
      installRuntime({ config: makeConfig() })
      const ids = Global.enabledParsers.map((p: any) => p.id)
      expect(ids.length).toBeGreaterThan(0)
      expect(ids).toContain('json')
      expect(ids).toContain('yaml')
    })

    it('honours an explicit config.enabledParsers list', () => {
      installRuntime({ config: makeConfig({ enabledParsers: ['json'] }) })
      expect(Global.enabledParsers.map((p: any) => p.id)).toEqual(['json'])
    })

    it('throws (never silently returns []) when config.enabledParsers names only unknown ids', () => {
      installRuntime({ config: makeConfig({ enabledParsers: ['totally-not-a-real-parser'] }) })
      expect(() => Global.enabledParsers).toThrow(/enabledParsers.*empty list/s)
    })
  })

  describe('silent-degradation audit (BUG 2)', () => {
    it('Global.enabledFrameworks warns once (does not throw) when it resolves empty', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      installRuntime({ config: makeConfig() })
      expect(Global.enabledFrameworks).toEqual([])
      expect(Global.enabledFrameworks).toEqual([]) // accessed twice
      const matching = warnSpy.mock.calls.filter(args => String(args[0]).includes('Global.enabledFrameworks resolved to an empty list'))
      expect(matching.length).toBe(1) // warned exactly once, not per access
      warnSpy.mockRestore()
    })

    it('Global.localesPaths warns once when unset', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      installRuntime({ config: makeConfig({ localesPaths: undefined }) })
      expect(Global.localesPaths).toBeUndefined()
      expect(Global.localesPaths).toBeUndefined()
      const matching = warnSpy.mock.calls.filter(args => String(args[0]).includes('Global.localesPaths is unset'))
      expect(matching.length).toBe(1)
      warnSpy.mockRestore()
    })

    it('Global.localesPaths does not warn when set', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      installRuntime({ config: makeConfig({ localesPaths: ['locales'] }) })
      expect(Global.localesPaths).toEqual(['locales'])
      const matching = warnSpy.mock.calls.filter(args => String(args[0]).includes('Global.localesPaths is unset'))
      expect(matching.length).toBe(0)
      warnSpy.mockRestore()
    })
  })
})
