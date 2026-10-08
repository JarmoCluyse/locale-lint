import { afterEach, describe, expect, it } from 'vitest'
import { parseLocaleFile } from '../../../src/engine/locale/parseLocaleFile'
import { enabledParserExts, getEnabledParsers, getMatchedParser } from '../../../src/engine/locale/parserRegistry'
import { installRuntime, _resetRuntimeForTests } from '../../../src/shims/core-global'
import { DEFAULT_CONFIG } from '../../../src/runtime/ConfigResolver'

afterEach(() => {
  _resetRuntimeForTests()
})

describe('getEnabledParsers', () => {
  it('defaults to json/yaml/json5 when no ids given', () => {
    const parsers = getEnabledParsers(undefined)
    expect(parsers.map(p => p.id).sort()).toEqual(['json', 'json5', 'yaml'])
  })

  it('filters by explicit ids', () => {
    const parsers = getEnabledParsers(['json'])
    expect(parsers.map(p => p.id)).toEqual(['json'])
  })
})

describe('getMatchedParser', () => {
  it('resolves by extension', () => {
    const parsers = getEnabledParsers(['json', 'yaml'])
    expect(getMatchedParser('.json', parsers)?.id).toBe('json')
    expect(getMatchedParser('foo/en.yml', parsers)?.id).toBe('yaml')
  })

  it('honours parsersExtendFileExtensions overrides', () => {
    const parsers = getEnabledParsers(['json5'])
    expect(getMatchedParser('.custom', parsers, { custom: 'json5' })?.id).toBe('json5')
  })

  it('returns undefined for unsupported extensions', () => {
    const parsers = getEnabledParsers(['json'])
    expect(getMatchedParser('.exe', parsers)).toBeUndefined()
  })
})

describe('enabledParserExts', () => {
  it('joins supportedExts with a pipe', () => {
    const parsers = getEnabledParsers(['json', 'yaml'])
    const exts = enabledParserExts(parsers)
    expect(exts).toContain('json')
    expect(exts).toContain('ya?ml')
  })
})

describe('parseLocaleFile', () => {
  it('parses flat JSON and leaves it as-is when disablePathParsing is true', async () => {
    const parsers = getEnabledParsers(['json'])
    const value = await parseLocaleFile('{"a.b": "c"}', parsers[0], { disablePathParsing: true })
    expect(value).toEqual({ 'a.b': 'c' })
  })

  it('unflattens dotted keys when disablePathParsing is false', async () => {
    const parsers = getEnabledParsers(['json'])
    const value = await parseLocaleFile('{"a.b": "c"}', parsers[0], { disablePathParsing: false })
    expect(value).toEqual({ a: { b: 'c' } })
  })

  it('throws on malformed JSON (caller turns this into a Diagnostic)', async () => {
    const parsers = getEnabledParsers(['json'])
    await expect(parseLocaleFile('{"a": ', parsers[0], { disablePathParsing: false })).rejects.toThrow()
  })

  it('parses YAML', async () => {
    // YamlParser.parse() reads `Config.parserOptions` (vendored
    // src/vendor/parsers/yaml.ts) — unlike the JSON parser, it is not fully
    // independent of the installed runtime context.
    await installRuntime({ config: DEFAULT_CONFIG })
    const parsers = getEnabledParsers(['yaml'])
    const value = await parseLocaleFile('hello: world\n', parsers[0], { disablePathParsing: false })
    expect(value).toEqual({ hello: 'world' })
  })
})
