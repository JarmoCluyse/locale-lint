import { describe, expect, it } from 'vitest'
import { CliArgError, parseArgs } from '../../src/cli/args'

describe('parseArgs', () => {
  it('parses a basic hardstring command with paths', () => {
    const args = parseArgs(['hardstring', 'src', 'lib'])
    expect(args.command).toBe('hardstring')
    expect(args.paths).toEqual(['src', 'lib'])
    expect(args.format).toBe('text')
  })

  it('parses "config explain"', () => {
    const args = parseArgs(['config', 'explain'])
    expect(args.command).toBe('config-explain')
  })

  it('rejects "config" without "explain"', () => {
    expect(() => parseArgs(['config', 'bogus'])).toThrow(CliArgError)
  })

  it('rejects unknown commands', () => {
    expect(() => parseArgs(['frobnicate'])).toThrow(CliArgError)
  })

  it('rejects empty argv', () => {
    expect(() => parseArgs([])).toThrow(CliArgError)
  })

  it('parses --format', () => {
    expect(parseArgs(['hardstring', '--format', 'json']).format).toBe('json')
    expect(() => parseArgs(['hardstring', '--format', 'xml'])).toThrow(CliArgError)
  })

  it('--ignore appends (repeatable)', () => {
    const args = parseArgs(['hardstring', '--ignore', '**/a/**', '--ignore', '**/b/**'])
    expect(args.ignoreAppend).toEqual(['**/a/**', '**/b/**'])
    expect(args.ignoreReplace).toBeUndefined()
  })

  it('--ignore-set replaces (repeatable, collects into one replace list)', () => {
    const args = parseArgs(['hardstring', '--ignore-set', '**/a/**', '--ignore-set', '**/b/**'])
    expect(args.ignoreReplace).toEqual(['**/a/**', '**/b/**'])
  })

  it('--ignore and --ignore-set are independent flags', () => {
    const args = parseArgs(['hardstring', '--ignore', '**/a/**', '--ignore-set', '**/b/**'])
    expect(args.ignoreAppend).toEqual(['**/a/**'])
    expect(args.ignoreReplace).toEqual(['**/b/**'])
  })

  it('parses --root, --config, --out, --concurrency', () => {
    const args = parseArgs(['hardstring', '--root', '/tmp/x', '--config', 'c.json', '--out', 'out.json', '--concurrency', '2'])
    expect(args.root).toBe('/tmp/x')
    expect(args.config).toBe('c.json')
    expect(args.out).toBe('out.json')
    expect(args.concurrency).toBe(2)
  })

  it('rejects invalid --concurrency', () => {
    expect(() => parseArgs(['hardstring', '--concurrency', '0'])).toThrow(CliArgError)
    expect(() => parseArgs(['hardstring', '--concurrency', 'nope'])).toThrow(CliArgError)
  })

  it('parses --max-hard-strings and --warn-only', () => {
    const args = parseArgs(['hardstring', '--max-hard-strings', '5', '--warn-only'])
    expect(args.maxHardStrings).toBe(5)
    expect(args.warnOnly).toBe(true)
  })

  it('parses --no-vscode-config, --quiet, --verbose, --explain-config', () => {
    const args = parseArgs(['hardstring', '--no-vscode-config', '--quiet', '--verbose', '--explain-config'])
    expect(args.noVscodeConfig).toBe(true)
    expect(args.quiet).toBe(true)
    expect(args.verbose).toBe(true)
    expect(args.explainConfig).toBe(true)
  })

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['hardstring', '--bogus'])).toThrow(CliArgError)
  })

  it('parses "usage" and "scan" commands', () => {
    expect(parseArgs(['usage', 'src']).command).toBe('usage')
    expect(parseArgs(['scan', 'src']).command).toBe('scan')
  })

  it('parses --max-missing as a count', () => {
    expect(parseArgs(['usage', '--max-missing', '5']).maxMissing).toEqual({ kind: 'count', value: 5 })
  })

  it('parses --max-missing as a percentage', () => {
    expect(parseArgs(['usage', '--max-missing', '5%']).maxMissing).toEqual({ kind: 'percent', value: 5 })
  })

  it('rejects invalid --max-missing', () => {
    expect(() => parseArgs(['usage', '--max-missing', 'nope'])).toThrow(CliArgError)
    expect(() => parseArgs(['usage', '--max-missing', 'nope%'])).toThrow(CliArgError)
  })

  it('parses --max-unused and --min-coverage', () => {
    const args = parseArgs(['usage', '--max-unused', '3', '--min-coverage', '90'])
    expect(args.maxUnused).toBe(3)
    expect(args.minCoverage).toBe(90)
  })

  it('rejects out-of-range --min-coverage', () => {
    expect(() => parseArgs(['usage', '--min-coverage', '101'])).toThrow(CliArgError)
    expect(() => parseArgs(['usage', '--min-coverage', '-1'])).toThrow(CliArgError)
  })

  it('parses --per-locale', () => {
    expect(parseArgs(['usage', '--per-locale']).perLocale).toBe(true)
  })

  it('parses --ignore-keys (repeatable, append-only)', () => {
    const args = parseArgs(['usage', '--ignore-keys', 'errors.*', '--ignore-keys', 'legacy.*'])
    expect(args.ignoreKeysAppend).toEqual(['errors.*', 'legacy.*'])
  })

  it('parses --baseline and --update-baseline', () => {
    const args = parseArgs(['usage', '--baseline', 'baseline.json', '--update-baseline'])
    expect(args.baseline).toBe('baseline.json')
    expect(args.updateBaseline).toBe(true)
  })
})
