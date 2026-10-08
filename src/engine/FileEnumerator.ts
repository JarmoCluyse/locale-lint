// FileEnumerator — streaming file discovery for the scanner.
//
// We considered reusing `src/vendor/utils/glob.ts` (`gitignoredGlob`), but it
// hard-depends on the `Global`/`Config` shims (via `installRuntime`) and
// materialises the full file list into memory via `glob-gitignore`'s
// `glob()` (not a stream) before returning. Since this engine's purity
// constraint (see HardStringScanner) means we do NOT want to require
// `installRuntime()` just to enumerate files, and we specifically want a
// streaming enumerator (not "collect everything, then return an array"), we
// reimplement the glob + .gitignore-merge logic directly against
// `fast-glob`'s stream API instead.
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import fg from 'fast-glob'
// @ts-expect-error — no types shipped
import parseGitIgnore from 'parse-gitignore'

export interface FileEnumeratorOptions {
  /** Absolute root directory to scan. */
  root: string
  /** One or more paths (relative to root, or absolute) to restrict scanning to. */
  paths?: string[]
  /** Glob patterns for files to include. Defaults to common source extensions. */
  patterns?: string[]
  /** Additional ignore globs (merged with .gitignore + defaults). */
  ignore?: string[]
  /** Set to false to skip honouring the root .gitignore. Default: true. */
  useGitignore?: boolean
}

export const DEFAULT_SCAN_PATTERNS = ['**/*.{js,jsx,ts,tsx,vue,html,svelte}']
const DEFAULT_IGNORE = ['**/node_modules/**', '**/dist/**', '**/.git/**']

function loadGitignorePatterns(root: string): string[] {
  const gitignorePath = join(root, '.gitignore')
  if (!existsSync(gitignorePath))
    return []
  try {
    const parsed = parseGitIgnore(readFileSync(gitignorePath)) as { patterns: string[] }
    return parsed.patterns ?? []
  }
  catch {
    return []
  }
}

/**
 * Stream absolute file paths under `options.root` (optionally restricted to
 * `options.paths`) matching `options.patterns`, honouring .gitignore and
 * caller-supplied ignore globs. Does not materialise the full list — callers
 * iterate with `for await`.
 */
export async function* enumerateFiles(options: FileEnumeratorOptions): AsyncGenerator<string> {
  const {
    root,
    paths,
    patterns = DEFAULT_SCAN_PATTERNS,
    ignore = [],
    useGitignore = true,
  } = options

  const gitignore = useGitignore ? loadGitignorePatterns(root) : []
  const ignorePatterns = [...DEFAULT_IGNORE, ...gitignore, ...ignore]

  const cwds = paths && paths.length ? paths : [root]

  const seen = new Set<string>()

  for (const cwdCandidate of cwds) {
    const cwd = isAbsolutePath(cwdCandidate) ? cwdCandidate : join(root, cwdCandidate)
    const stream = fg.stream(patterns, {
      cwd,
      ignore: ignorePatterns,
      absolute: true,
      onlyFiles: true,
      dot: false,
      followSymbolicLinks: false,
    })

    for await (const entry of stream) {
      const abs = entry.toString()
      if (seen.has(abs))
        continue
      seen.add(abs)
      yield abs
    }
  }
}

function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)
}

/** Convert an absolute path to a rootpath-relative, forward-slash path. */
export function toRelative(root: string, absPath: string): string {
  return relative(root, absPath).split('\\').join('/')
}

// Re-exported for DocumentFactory's benefit (avoid a second fs import style).
export { createReadStream, readFile }
