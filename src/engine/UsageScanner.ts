// UsageScanner — orchestrates FileEnumerator -> DocumentFactory -> Scheduler
// -> `usage/scanFile.ts` (pure per-file key-occurrence scan) -> LocaleStore
// (loaded independently/concurrently) -> `usage/aggregate.ts` (the one place
// allowed to cross-reference occurrences against the locale tree).
import { installRuntime } from '../shims/core-global'
import { CurrentFile } from '../shims/current-file'
import { loadDocument } from './DocumentFactory'
import { enumerateFiles, toRelative } from './FileEnumerator'
import { runPoolStreaming } from './Scheduler'
import { computeSourcePatterns } from '../runtime/SourceGlob'
import { LocaleStore } from './LocaleStore'
import { scanFileForUsages } from './usage/scanFile'
import { aggregateUsage } from './usage/aggregate'
import type { DynamicKeyUsage, KeyOccurrence, UsageSummary } from './usage/types'
import type { SkippedFile } from './types'
import type { ResolvedConfig } from '../runtime/types'

export interface ScanUsageOptions {
  config: ResolvedConfig
  /** Paths (relative to config.rootpath, or absolute) to restrict scanning to. */
  paths?: string[]
  patterns?: string[]
  useGitignore?: boolean
  extraIgnore?: string[]
}

/**
 * Dynamic keys (`` t(`err.${code}`) ``) are statically undecidable: the
 * scanner cannot enumerate which concrete locale keys such a call resolves
 * to at runtime. When any are detected, the "unused" bucket may contain
 * false positives (keys that ARE used, just not through a literal string the
 * regex scanner can see) — so we attach a caveat to the report instead of
 * silently reporting (and failing CI on) a number that may be wrong. This is
 * surfaced, not swallowed: reporting dynamic-key usages as "unused" and
 * failing the build on them is exactly the kind of result that destroys
 * trust in the tool on day one.
 */
function buildDynamicKeyCaveat(dynamicKeyUsages: DynamicKeyUsage[]): string | undefined {
  if (!dynamicKeyUsages.length)
    return undefined
  const fileCount = new Set(dynamicKeyUsages.map(d => d.file)).size
  return `${dynamicKeyUsages.length} dynamic key usage(s) detected in ${fileCount} file(s) — unused-key results may be incomplete.`
}

export async function scanUsageProject(options: ScanUsageOptions): Promise<UsageSummary> {
  const { config } = options
  const root = config.rootpath
  const started = Date.now()

  const store = new LocaleStore(config)
  // Assign before `installRuntime`/scanning: vendored `handleRegexMatch`
  // (via `Analyst` -> `KeyDetector` -> `regexFindKeys`) calls
  // `CurrentFile.loader.rewriteKeys(...)`, which only consults
  // config/framework-level logic (never `store.root`/`flattenLocaleTree`) —
  // see `usage/scanFile.ts`'s purity note. Safe to assign before `.load()`.
  CurrentFile.loader = store
  await installRuntime({ config })

  const ignore = [...config.usage.scanningIgnore, ...(options.extraIgnore ?? [])]
  const patterns = options.patterns ?? config.usage.include ?? computeSourcePatterns(config)
  const source = enumerateFiles({
    root,
    paths: options.paths,
    patterns,
    ignore,
    useGitignore: options.useGitignore,
  })

  const skipped: SkippedFile[] = []
  const occurrences: KeyOccurrence[] = []
  const dynamicKeyUsages: DynamicKeyUsage[] = []
  let filesScanned = 0

  async function worker(absPath: string): Promise<void> {
    const relPath = toRelative(root, absPath)
    const loaded = await loadDocument(absPath, relPath, { encoding: config.encoding, languageIdOverrides: config.languageIdOverrides })
    if (!loaded.ok) {
      skipped.push(loaded.skip)
      return
    }
    filesScanned++
    try {
      const result = await scanFileForUsages(relPath, loaded.text)
      occurrences.push(...result.occurrences)
      dynamicKeyUsages.push(...result.dynamicKeyUsages)
    }
    catch (e) {
      skipped.push({ file: relPath, reason: 'parse-error', detail: e instanceof Error ? e.message : String(e) })
    }
  }

  const [, ] = await Promise.all([
    runPoolStreaming(source, worker, { concurrency: config.concurrency }),
    store.load(),
  ])

  const { missing, unused, coverage, overallCoverage, usedKeyCount } = aggregateUsage(store, occurrences, {
    keysInUse: config.keysInUse,
    rootpath: root,
  })

  const caveat = buildDynamicKeyCaveat(dynamicKeyUsages)

  return {
    filesScanned,
    filesSkipped: skipped,
    localeDiagnostics: [...store.diagnostics],
    missing,
    unused,
    coverage,
    overallCoverage,
    dynamicKeyUsages,
    caveats: caveat ? [caveat] : [],
    usedKeyCount,
    durationMs: Date.now() - started,
  }
}

export * from './usage/types'
export { scanFileForUsages } from './usage/scanFile'
export { detectDynamicKeyUsages } from './usage/dynamicKeys'
export { aggregateUsage } from './usage/aggregate'
