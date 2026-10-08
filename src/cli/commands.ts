// `locale-lint hardstring [paths...]`, `locale-lint usage [paths...]`,
// `locale-lint scan [paths...]` (both scanners, merged report), and
// `locale-lint config explain` command implementations.
import { writeFile, readFile } from 'node:fs/promises'
import { resolveConfig } from '../runtime/ConfigResolver'
import type { LayerName, ResolvedConfig } from '../runtime/types'
import { scanProject } from '../engine'
import { scanUsageProject } from '../engine/UsageScanner'
import type { ScanSummary } from '../engine/types'
import type { UsageSummary } from '../engine/usage/types'
import {
  renderJsonReport, renderJunitReport, renderTextReport, evaluateGate,
  EXIT_CONFIG_ERROR, EXIT_INTERNAL_ERROR, EXIT_SUCCESS,
  EXIT_NO_FILES_MATCHED, EXIT_PARSE_ERRORS_EXCEEDED, EXIT_HARD_STRING_GATE,
} from '../report'
import { buildJsonReport } from '../report/json'
import {
  renderUsageJsonReport, renderUsageTextReport, renderUsageJunitReport, evaluateUsageGate,
  EXIT_MISSING_GATE, EXIT_UNUSED_GATE, EXIT_MULTIPLE_GATE,
} from '../report/usage'
import { buildUsageJsonReport } from '../report/usage/json'
import { buildBaselineFromSummary, filterSummaryAgainstBaseline, parseBaseline, renderBaseline, EMPTY_BASELINE } from '../report/baseline'
import { setLogLevel, setWorkspaceRootpath } from '../shims/vscode'
import type { LogLevel } from '../shims/vscode'
import type { ParsedArgs } from './args'

export interface CliOutput {
  exitCode: number
  stdout: string
  stderr: string
}

function buildCliFlags(args: ParsedArgs): Record<string, unknown> {
  const flags: Record<string, unknown> = {}
  if (args.concurrency !== undefined)
    flags.concurrency = args.concurrency
  if (args.ignoreReplace && args.ignoreReplace.length)
    flags['usage.scanningIgnore'] = { $replace: args.ignoreReplace }
  else if (args.ignoreAppend.length)
    flags['usage.scanningIgnore'] = { $append: args.ignoreAppend }
  if (args.ignoreKeysAppend.length)
    flags.keysInUse = { $append: args.ignoreKeysAppend }
  return flags
}

/**
 * Wire the vscode shim's process-wide bits that depend on the resolved
 * config/CLI flags, once per invocation, right after config resolution:
 *
 * - `setWorkspaceRootpath(config.rootpath)`: so `workspace.workspaceFolders`
 *   resolves correctly if any vendored path reaches it (e.g.
 *   `frameworks/index.ts:86`'s `getPackageDependencies` fallback) — without
 *   this it would silently read as "no folder open" instead of the actual
 *   scan root.
 * - `setLogLevel(...)` from `--quiet`/`--verbose`: `--quiet` suppresses
 *   everything but hard failures (`'error'`), `--verbose` surfaces
 *   everything (`'verbose'`), otherwise default `'warn'`. Diagnostics raised
 *   this way are routed to stderr only by the shim itself — stdout stays
 *   reserved for the report (so `--format json | jq` etc. keeps working).
 */
function wireVscodeShimRuntime(config: ResolvedConfig, args: Pick<ParsedArgs, 'quiet' | 'verbose'>): void {
  setWorkspaceRootpath(config.rootpath)

  const level: LogLevel = args.quiet ? 'error' : args.verbose ? 'verbose' : 'warn'
  setLogLevel(level)
}

export async function runHardstring(args: ParsedArgs): Promise<CliOutput> {
  let resolved
  try {
    resolved = resolveConfig({
      root: args.root,
      cliFlags: buildCliFlags(args),
      skipVscodeLayer: args.noVscodeConfig,
    })
  }
  catch (e) {
    return { exitCode: EXIT_CONFIG_ERROR, stdout: '', stderr: `Config error: ${e instanceof Error ? e.message : String(e)}\n` }
  }

  const { config } = resolved
  wireVscodeShimRuntime(config, args)

  let summary
  try {
    summary = await scanProject({
      config,
      paths: args.paths.length ? args.paths : undefined,
      useGitignore: true,
    })
  }
  catch (e) {
    return { exitCode: EXIT_INTERNAL_ERROR, stdout: '', stderr: `Internal error during scan: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n` }
  }

  const report = args.format === 'json'
    ? renderJsonReport(summary)
    : args.format === 'junit'
      ? renderJunitReport(summary)
      : renderTextReport(summary)

  const gate = evaluateGate(summary, {
    maxHardStrings: args.maxHardStrings,
    warnOnly: args.warnOnly,
  })

  let stdout = ''
  let stderr = ''
  if (args.out) {
    await writeFile(args.out, report, 'utf8')
    if (!args.quiet)
      stdout = `Wrote report to ${args.out}\n`
  }
  else if (!args.quiet) {
    stdout = report
  }

  if (!args.quiet && gate.exitCode !== 0)
    stderr = `${gate.reason}\n`
  else if (args.verbose)
    stdout += `${gate.reason}\n`

  return { exitCode: gate.exitCode, stdout, stderr }
}

async function loadBaselineFile(path: string | undefined) {
  if (!path)
    return undefined
  try {
    const raw = await readFile(path, 'utf8')
    return parseBaseline(raw)
  }
  catch {
    // Missing/unreadable baseline file: treat as empty (first run) rather
    // than erroring — matches the "establish a baseline" UX of similar
    // tools (every finding is "new" until a baseline exists).
    return EMPTY_BASELINE
  }
}

export async function runUsage(args: ParsedArgs): Promise<CliOutput> {
  let resolved
  try {
    resolved = resolveConfig({
      root: args.root,
      cliFlags: buildCliFlags(args),
      skipVscodeLayer: args.noVscodeConfig,
    })
  }
  catch (e) {
    return { exitCode: EXIT_CONFIG_ERROR, stdout: '', stderr: `Config error: ${e instanceof Error ? e.message : String(e)}\n` }
  }

  const { config } = resolved
  wireVscodeShimRuntime(config, args)

  let summary: UsageSummary
  try {
    summary = await scanUsageProject({
      config,
      paths: args.paths.length ? args.paths : undefined,
      useGitignore: true,
    })
  }
  catch (e) {
    return { exitCode: EXIT_INTERNAL_ERROR, stdout: '', stderr: `Internal error during scan: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n` }
  }

  let stdout = ''
  let stderr = ''

  if (args.updateBaseline) {
    if (!args.baseline)
      return { exitCode: EXIT_CONFIG_ERROR, stdout: '', stderr: '--update-baseline requires --baseline <file>.\n' }
    await writeFile(args.baseline, renderBaseline(buildBaselineFromSummary(summary)), 'utf8')
    if (!args.quiet)
      stdout = `Wrote baseline to ${args.baseline}\n`
    return { exitCode: EXIT_SUCCESS, stdout, stderr }
  }

  const report = args.format === 'json'
    ? renderUsageJsonReport(summary)
    : args.format === 'junit'
      ? renderUsageJunitReport(summary, { perLocale: args.perLocale })
      : renderUsageTextReport(summary, { perLocale: args.perLocale })

  const baseline = await loadBaselineFile(args.baseline)
  const gateSummary = baseline ? filterSummaryAgainstBaseline(summary, baseline) : summary

  const gate = evaluateUsageGate(gateSummary, {
    maxMissing: args.maxMissing,
    maxUnused: args.maxUnused,
    minCoverage: args.minCoverage,
    warnOnly: args.warnOnly,
  })

  if (args.out) {
    await writeFile(args.out, report, 'utf8')
    if (!args.quiet)
      stdout = `Wrote report to ${args.out}\n`
  }
  else if (!args.quiet) {
    stdout = report
  }

  if (!args.quiet && gate.exitCode !== 0)
    stderr = `${gate.reasons.join(' ')}\n`
  else if (args.verbose)
    stdout += `${gate.reasons.join(' ')}\n`

  return { exitCode: gate.exitCode, stdout, stderr }
}

/**
 * Combine the hard-string gate's exit code with the usage gate's, for the
 * merged `scan` command. Scan-level failures (internal error, config error,
 * zero files matched, parse-error tolerance exceeded) take priority over
 * plain threshold violations; if BOTH a hard-string violation (3) and a
 * usage violation (1/2/4) are present with no higher-priority code, the
 * combined result is 4 ("multiple categories violated").
 */
function combineExitCodes(hardStringCode: number, usageCode: number): number {
  const fatalPriority = [EXIT_INTERNAL_ERROR, EXIT_CONFIG_ERROR, EXIT_NO_FILES_MATCHED, EXIT_PARSE_ERRORS_EXCEEDED]
  for (const code of fatalPriority) {
    if (hardStringCode === code || usageCode === code)
      return code
  }

  const hardStringViolated = hardStringCode === EXIT_HARD_STRING_GATE
  const usageViolated = usageCode === EXIT_MISSING_GATE || usageCode === EXIT_UNUSED_GATE || usageCode === EXIT_MULTIPLE_GATE

  if (hardStringViolated && usageViolated)
    return EXIT_MULTIPLE_GATE
  if (hardStringViolated)
    return EXIT_HARD_STRING_GATE
  if (usageViolated)
    return usageCode

  return EXIT_SUCCESS
}

export async function runScan(args: ParsedArgs): Promise<CliOutput> {
  let resolved
  try {
    resolved = resolveConfig({
      root: args.root,
      cliFlags: buildCliFlags(args),
      skipVscodeLayer: args.noVscodeConfig,
    })
  }
  catch (e) {
    return { exitCode: EXIT_CONFIG_ERROR, stdout: '', stderr: `Config error: ${e instanceof Error ? e.message : String(e)}\n` }
  }

  const { config } = resolved
  wireVscodeShimRuntime(config, args)

  let hardStringSummary: ScanSummary
  let usageSummary: UsageSummary
  try {
    [hardStringSummary, usageSummary] = await Promise.all([
      scanProject({ config, paths: args.paths.length ? args.paths : undefined, useGitignore: true }),
      scanUsageProject({ config, paths: args.paths.length ? args.paths : undefined, useGitignore: true }),
    ])
  }
  catch (e) {
    return { exitCode: EXIT_INTERNAL_ERROR, stdout: '', stderr: `Internal error during scan: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n` }
  }

  const baseline = await loadBaselineFile(args.baseline)
  const usageGateSummary = baseline ? filterSummaryAgainstBaseline(usageSummary, baseline) : usageSummary

  const hardStringGate = evaluateGate(hardStringSummary, { maxHardStrings: args.maxHardStrings, warnOnly: args.warnOnly })
  const usageGate = evaluateUsageGate(usageGateSummary, {
    maxMissing: args.maxMissing,
    maxUnused: args.maxUnused,
    minCoverage: args.minCoverage,
    warnOnly: args.warnOnly,
  })

  const report = args.format === 'json'
    ? renderScanJsonReport(hardStringSummary, usageSummary)
    : args.format === 'junit'
      ? renderScanJunitReport(hardStringSummary, usageSummary, args.perLocale)
      : renderScanTextReport(hardStringSummary, usageSummary, args.perLocale)

  const exitCode = args.warnOnly ? EXIT_SUCCESS : combineExitCodes(hardStringGate.exitCode, usageGate.exitCode)

  let stdout = ''
  let stderr = ''
  if (args.out) {
    await writeFile(args.out, report, 'utf8')
    if (!args.quiet)
      stdout = `Wrote report to ${args.out}\n`
  }
  else if (!args.quiet) {
    stdout = report
  }

  if (!args.quiet && exitCode !== 0) {
    stderr = `${hardStringGate.reason}\n${usageGate.reasons.join(' ')}\n`
  }
  else if (args.verbose) {
    stdout += `${hardStringGate.reason}\n${usageGate.reasons.join(' ')}\n`
  }

  return { exitCode, stdout, stderr }
}

function renderScanJsonReport(hardStringSummary: ScanSummary, usageSummary: UsageSummary): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    hardString: buildJsonReport(hardStringSummary),
    usage: buildUsageJsonReport(usageSummary),
  }, null, 2)}\n`
}

function renderScanTextReport(hardStringSummary: ScanSummary, usageSummary: UsageSummary, perLocale: boolean): string {
  return [
    '== Hard-coded strings ==',
    renderTextReport(hardStringSummary),
    '== Usage (missing/unused keys + coverage) ==',
    renderUsageTextReport(usageSummary, { perLocale }),
  ].join('\n')
}

function renderScanJunitReport(hardStringSummary: ScanSummary, usageSummary: UsageSummary, perLocale: boolean): string {
  const hardStringXml = renderJunitReport(hardStringSummary)
  const usageXml = renderUsageJunitReport(usageSummary, { perLocale })

  const extractSuites = (xml: string): string => {
    const match = xml.match(/<testsuites>([\s\S]*)<\/testsuites>/)
    return match ? match[1].trim() : ''
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testsuites>',
    extractSuites(hardStringXml),
    extractSuites(usageXml),
    '</testsuites>',
    '',
  ].join('\n')
}

export async function runConfigExplain(args: ParsedArgs): Promise<CliOutput> {
  try {
    const { config, provenance } = resolveConfig({
      root: args.root,
      skipVscodeLayer: args.noVscodeConfig,
    })
    wireVscodeShimRuntime(config, args)

    const lines: string[] = []
    const entries = [...provenance.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    for (const [path, layer] of entries)
      lines.push(`${path} = ${JSON.stringify(getAtPath(config, path))}  (${layer satisfies LayerName})`)

    return { exitCode: 0, stdout: `${lines.join('\n')}\n`, stderr: '' }
  }
  catch (e) {
    return { exitCode: EXIT_CONFIG_ERROR, stdout: '', stderr: `Config error: ${e instanceof Error ? e.message : String(e)}\n` }
  }
}

function getAtPath(obj: Record<string, any>, dotPath: string): unknown {
  return dotPath.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj as any)
}
