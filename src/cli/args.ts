// Hand-rolled CLI argument parser — no heavy dependency. Supports
// `hardstring [paths...]`, `usage [paths...]`, `scan [paths...]` (runs both),
// and `config explain`, plus shared global flags.
import type { MaxMissingThreshold } from '../report/usage/gate'

export interface ParsedArgs {
  command: 'hardstring' | 'usage' | 'scan' | 'config-explain'
  paths: string[]
  root?: string
  config?: string
  noVscodeConfig: boolean
  format: 'json' | 'junit' | 'text'
  out?: string
  /** Ignore globs appended to whatever the config resolves. */
  ignoreAppend: string[]
  /** Ignore globs that replace the config's resolved ignore list entirely. */
  ignoreReplace?: string[]
  /** Appended to `Config.keysInUse` (glob allow-list for "don't flag as unused") — see UsageScanner's doc comment. */
  ignoreKeysAppend: string[]
  concurrency?: number
  quiet: boolean
  verbose: boolean
  explainConfig: boolean
  maxHardStrings?: number
  maxMissing?: MaxMissingThreshold
  maxUnused?: number
  minCoverage?: number
  perLocale: boolean
  warnOnly: boolean
  baseline?: string
  updateBaseline: boolean
}

export class CliArgError extends Error {}

const FORMATS = new Set(['json', 'junit', 'text'])

function parseMaxMissing(raw: string): MaxMissingThreshold {
  if (raw.endsWith('%')) {
    const value = Number(raw.slice(0, -1))
    if (!Number.isFinite(value) || value < 0)
      throw new CliArgError(`Invalid --max-missing percentage: ${raw}`)
    return { kind: 'percent', value }
  }
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0)
    throw new CliArgError(`Invalid --max-missing value: ${raw}. Expected a non-negative integer or a percentage like "5%".`)
  return { kind: 'count', value: Math.floor(value) }
}

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0)
    throw new CliArgError('Missing command. Usage: locale-lint <hardstring|usage|scan|config> [...]')

  const [rawCommand, ...rest] = argv

  let command: ParsedArgs['command']
  let args = rest

  if (rawCommand === 'hardstring' || rawCommand === 'usage' || rawCommand === 'scan') {
    command = rawCommand
  }
  else if (rawCommand === 'config') {
    if (rest[0] !== 'explain')
      throw new CliArgError(`Unknown "config" subcommand: ${rest[0] ?? '(none)'}. Only "config explain" is supported.`)
    command = 'config-explain'
    args = rest.slice(1)
  }
  else {
    throw new CliArgError(`Unknown command: ${rawCommand}. Usage: locale-lint <hardstring|usage|scan|config> [...]`)
  }

  const result: ParsedArgs = {
    command,
    paths: [],
    noVscodeConfig: false,
    format: 'text',
    ignoreAppend: [],
    ignoreKeysAppend: [],
    quiet: false,
    verbose: false,
    explainConfig: false,
    perLocale: false,
    warnOnly: false,
    updateBaseline: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    const takeValue = (flag: string): string => {
      const next = args[++i]
      if (next === undefined)
        throw new CliArgError(`Flag ${flag} requires a value.`)
      return next
    }

    switch (arg) {
      case '--root':
        result.root = takeValue(arg)
        break
      case '--config':
        result.config = takeValue(arg)
        break
      case '--no-vscode-config':
        result.noVscodeConfig = true
        break
      case '--format': {
        const value = takeValue(arg)
        if (!FORMATS.has(value))
          throw new CliArgError(`Invalid --format value: ${value}. Expected one of json|junit|text.`)
        result.format = value as ParsedArgs['format']
        break
      }
      case '--out':
        result.out = takeValue(arg)
        break
      case '--ignore':
        result.ignoreAppend.push(takeValue(arg))
        break
      case '--ignore-set':
        (result.ignoreReplace ??= []).push(takeValue(arg))
        break
      case '--ignore-keys':
        result.ignoreKeysAppend.push(takeValue(arg))
        break
      case '--concurrency': {
        const value = Number(takeValue(arg))
        if (!Number.isFinite(value) || value < 1)
          throw new CliArgError('Invalid --concurrency value: expected a positive integer.')
        result.concurrency = Math.floor(value)
        break
      }
      case '--quiet':
        result.quiet = true
        break
      case '--verbose':
        result.verbose = true
        break
      case '--explain-config':
        result.explainConfig = true
        break
      case '--max-hard-strings': {
        const value = Number(takeValue(arg))
        if (!Number.isFinite(value) || value < 0)
          throw new CliArgError('Invalid --max-hard-strings value: expected a non-negative integer.')
        result.maxHardStrings = Math.floor(value)
        break
      }
      case '--max-missing':
        result.maxMissing = parseMaxMissing(takeValue(arg))
        break
      case '--max-unused': {
        const value = Number(takeValue(arg))
        if (!Number.isFinite(value) || value < 0)
          throw new CliArgError('Invalid --max-unused value: expected a non-negative integer.')
        result.maxUnused = Math.floor(value)
        break
      }
      case '--min-coverage': {
        const value = Number(takeValue(arg))
        if (!Number.isFinite(value) || value < 0 || value > 100)
          throw new CliArgError('Invalid --min-coverage value: expected a number between 0 and 100.')
        result.minCoverage = value
        break
      }
      case '--per-locale':
        result.perLocale = true
        break
      case '--warn-only':
        result.warnOnly = true
        break
      case '--baseline':
        result.baseline = takeValue(arg)
        break
      case '--update-baseline':
        result.updateBaseline = true
        break
      default:
        if (arg.startsWith('--'))
          throw new CliArgError(`Unknown flag: ${arg}`)
        result.paths.push(arg)
    }
  }

  return result
}
