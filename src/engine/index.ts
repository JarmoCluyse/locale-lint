// Orchestrates FileEnumerator -> DocumentFactory -> HardStringScanner ->
// Scheduler into a single `scanProject` entry point used by the CLI.
import { loadDocument } from './DocumentFactory'
import { enumerateFiles, toRelative } from './FileEnumerator'
import { scanFile } from './HardStringScanner'
import { runPoolStreaming } from './Scheduler'
import { computeSourcePatterns } from '../runtime/SourceGlob'
import type { ScanSummary, SkippedFile, HardStringFinding } from './types'
import type { ResolvedConfig } from '../runtime/types'

export interface ScanProjectOptions {
  config: ResolvedConfig
  /** Paths (relative to config.rootpath, or absolute) to restrict scanning to. */
  paths?: string[]
  patterns?: string[]
  useGitignore?: boolean
  /** Additional ignore globs, appended to config.usage.scanningIgnore. */
  extraIgnore?: string[]
}

export async function scanProject(options: ScanProjectOptions): Promise<ScanSummary> {
  const { config } = options
  const root = config.rootpath
  const started = Date.now()

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
  const findings: HardStringFinding[] = []
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
      const fileFindings = scanFile(relPath, loaded.text, config)
      findings.push(...fileFindings)
    }
    catch (e) {
      skipped.push({ file: relPath, reason: 'parse-error', detail: e instanceof Error ? e.message : String(e) })
    }
  }

  await runPoolStreaming(source, worker, { concurrency: config.concurrency })

  return {
    filesScanned,
    filesSkipped: skipped,
    findings,
    durationMs: Date.now() - started,
  }
}

export * from './types'
export { scanFile } from './HardStringScanner'
export { enumerateFiles, toRelative, DEFAULT_SCAN_PATTERNS } from './FileEnumerator'
export { runPool, runPoolStreaming, defaultConcurrency } from './Scheduler'
