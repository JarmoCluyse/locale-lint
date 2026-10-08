import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../../src/runtime/ConfigResolver'

const FIXTURES = join(__dirname, '..', 'fixtures', 'config')

describe('resolveConfig', () => {
  it('L0 defaults only (no files)', () => {
    const { config, provenance } = resolveConfig({ root: join(FIXTURES, 'does-not-exist') })
    expect(config.encoding).toBe('utf-8')
    expect(config.readonly).toBe(true)
    expect(provenance.get('encoding')).toBe('default')
  })

  it('L1-only: .vscode/settings.json overrides defaults', () => {
    const { config, provenance } = resolveConfig({ root: join(FIXTURES, 'l1-only') })
    expect(config.sourceLanguage).toBe('en')
    expect(config.displayLanguage).toBe('fr')
    expect(config.usage.scanningIgnore).toEqual(['**/editor-ignore/**'])
    expect(provenance.get('sourceLanguage')).toBe('vscode')
  })

  it('L2-only: root config file overrides defaults', () => {
    const { config, provenance } = resolveConfig({ root: join(FIXTURES, 'l2-only') })
    expect(config.sourceLanguage).toBe('en')
    expect(config.namespace).toBe(true)
    expect(provenance.get('sourceLanguage')).toBe('config')
  })

  it('L1+L2 partial: L2 wins on overlapping key, L1 survives on others', () => {
    const { config, provenance } = resolveConfig({ root: join(FIXTURES, 'l1-l2-partial') })
    expect(config.sourceLanguage).toBe('en') // from L1 only
    expect(config.displayLanguage).toBe('ja') // L2 overrides L1's "de"
    expect(config.namespace).toBe(true) // from L2 only
    expect(provenance.get('sourceLanguage')).toBe('vscode')
    expect(provenance.get('displayLanguage')).toBe('config')
  })

  it('reads JSON config file format', () => {
    const { config } = resolveConfig({ root: join(FIXTURES, 'json-format') })
    expect(config.sourceLanguage).toBe('en')
  })

  it('reads YAML config file format', () => {
    const { config } = resolveConfig({ root: join(FIXTURES, 'yaml-format') })
    expect(config.sourceLanguage).toBe('en')
    expect(config.namespace).toBe(true)
  })

  it('reads TOML config file format', () => {
    const { config } = resolveConfig({ root: join(FIXTURES, 'toml-format') })
    expect(config.sourceLanguage).toBe('en')
    expect(config.namespace).toBe(true)
  })

  it('reads localeLint key from package.json as fallback', () => {
    const { config } = resolveConfig({ root: join(FIXTURES, 'package-json-format') })
    expect(config.sourceLanguage).toBe('en')
    expect(config.namespace).toBe(true)
  })

  it('$append merges CI extras onto the editor list', () => {
    const { config } = resolveConfig({ root: join(FIXTURES, 'array-append') })
    expect(config.usage.scanningIgnore).toEqual(['**/editor-ignore/**', '**/ci-extra/**'])
  })

  it('$replace fully replaces the lower-layer array', () => {
    const { config } = resolveConfig({ root: join(FIXTURES, 'array-replace') })
    expect(config.usage.scanningIgnore).toEqual(['**/ci-only/**'])
  })

  it('arrays replace by default (no $append/$replace wrapper)', () => {
    const { config } = resolveConfig({
      root: join(FIXTURES, 'l1-only'),
      cliFlags: { usage: { scanningIgnore: ['**/cli-only/**'] } },
    })
    expect(config.usage.scanningIgnore).toEqual(['**/cli-only/**'])
  })

  it('parses .vscode/settings.json with comments and trailing commas without throwing', () => {
    expect(() => resolveConfig({ root: join(FIXTURES, 'vscode-comments') })).not.toThrow()
    const { config } = resolveConfig({ root: join(FIXTURES, 'vscode-comments') })
    expect(config.sourceLanguage).toBe('en')
    expect(config.displayLanguage).toBe('fr')
  })

  it('undefined in a higher layer never clobbers a lower layer value', () => {
    const { config } = resolveConfig({
      root: join(FIXTURES, 'no-clobber'),
      cliFlags: { displayLanguage: undefined, sourceLanguage: undefined },
    })
    expect(config.sourceLanguage).toBe('en')
    expect(config.displayLanguage).toBe('fr')
  })

  it('rootpath is always resolved CWD / explicit root, never from a config file', () => {
    const { config, provenance } = resolveConfig({ root: join(FIXTURES, 'l2-only') })
    expect(config.rootpath).toBe(join(FIXTURES, 'l2-only'))
    expect(provenance.get('rootpath')).toBe('cli')
  })

  it('CLI flags win over config file and vscode settings', () => {
    const { config, provenance } = resolveConfig({
      root: join(FIXTURES, 'l1-l2-partial'),
      cliFlags: { displayLanguage: 'zh' },
    })
    expect(config.displayLanguage).toBe('zh')
    expect(provenance.get('displayLanguage')).toBe('cli')
  })

  describe('hardString.ignoreGlobs', () => {
    it('falls back to the final resolved usage.scanningIgnore when unset', () => {
      const { config, provenance } = resolveConfig({ root: join(FIXTURES, 'hardstring-ignoreglobs-fallback') })
      expect(config.usage.scanningIgnore).toEqual(['**/usage-ignore/**'])
      expect(config.hardString.ignoreGlobs).toEqual(['**/usage-ignore/**'])
      // it's a computed default, not a layer value — no provenance entry
      expect(provenance.get('hardString.ignoreGlobs')).toBeUndefined()
    })

    it('overrides the usage.scanningIgnore fallback when set explicitly', () => {
      const { config, provenance } = resolveConfig({ root: join(FIXTURES, 'hardstring-ignoreglobs-override') })
      expect(config.usage.scanningIgnore).toEqual(['**/usage-ignore/**'])
      expect(config.hardString.ignoreGlobs).toEqual(['**/hardstring-ignore/**'])
      expect(provenance.get('hardString.ignoreGlobs')).toBe('config')
    })

    it('still distinct from hardString.ignored (exact strings, not globs)', () => {
      const { config } = resolveConfig({
        root: join(FIXTURES, 'does-not-exist'),
        cliFlags: { hardString: { ignored: ['Submit'], ignoreGlobs: ['**/*.stories.tsx'] } },
      })
      expect(config.hardString.ignored).toEqual(['Submit'])
      expect(config.hardString.ignoreGlobs).toEqual(['**/*.stories.tsx'])
    })

    it('supports $append/$replace like other arrays', () => {
      const { config } = resolveConfig({
        root: join(FIXTURES, 'hardstring-ignoreglobs-override'),
        cliFlags: { hardString: { ignoreGlobs: { $append: ['**/cli-extra/**'] } } },
      })
      expect(config.hardString.ignoreGlobs).toEqual(['**/hardstring-ignore/**', '**/cli-extra/**'])
    })
  })

  describe('gate.maxHardStrings', () => {
    it('flows through the .vscode/settings.json layer', () => {
      const { config, provenance } = resolveConfig({ root: join(FIXTURES, 'gate-maxhardstrings') })
      expect(config.gate.maxHardStrings).toBe(5)
      expect(provenance.get('gate.maxHardStrings')).toBe('vscode')
    })

    it('flows through the config-file layer', () => {
      const { config, provenance } = resolveConfig({
        root: join(FIXTURES, 'does-not-exist'),
        cliFlags: {},
      })
      expect(config.gate.maxHardStrings).toBeUndefined()
      expect(provenance.get('gate.maxHardStrings')).toBeUndefined()
    })

    it('CLI still wins over config-file/vscode for gate.maxHardStrings', () => {
      const { config, provenance } = resolveConfig({
        root: join(FIXTURES, 'gate-maxhardstrings'),
        cliFlags: { gate: { maxHardStrings: 42 } },
      })
      expect(config.gate.maxHardStrings).toBe(42)
      expect(provenance.get('gate.maxHardStrings')).toBe('cli')
    })
  })
})
