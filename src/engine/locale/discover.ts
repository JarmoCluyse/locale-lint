// Locale directory discovery — ported (simplified: no watchers) from
// upstream lokalise/i18n-ally's `LocaleLoader.findLocaleDirs` /
// `loadDirectory` (/tmp/i18n-ally/src/core/loaders/LocaleLoader.ts:579-634).
// MIT. See NOTICE.
import { resolve } from 'node:path'
import fg from 'fast-glob'

/**
 * Resolve `localesPaths` globs (relative to `rootpath`) into absolute
 * locale-root directories. Mirrors upstream's `findLocaleDirs`, including
 * the `'.'` (rootpath itself) special case.
 */
export async function findLocaleDirs(rootpath: string, localesPaths: string[] | undefined): Promise<string[]> {
  if (!localesPaths || !localesPaths.length)
    return []

  const dirs = await fg(localesPaths, {
    cwd: rootpath,
    onlyDirectories: true,
  })

  if (localesPaths.includes('.'))
    dirs.push('.')

  return [...new Set(dirs.map(d => resolve(rootpath, d)))]
}

const DEFAULT_IGNORE = ['node_modules/**', 'vendors/**']

/** List immediate subdirectory names of `dir` (depth 1), used for dirStructure inference. */
export async function listSubdirNames(dir: string): Promise<string[]> {
  return fg('*', {
    onlyDirectories: true,
    cwd: dir,
    deep: 1,
    ignore: DEFAULT_IGNORE,
  })
}

/** List all files (relative paths) under `dir`, recursively. Mirrors upstream's `loadDirectory` glob. */
export async function listLocaleFiles(dir: string, ignore: string[] = []): Promise<string[]> {
  return fg('**/*.*', {
    cwd: dir,
    onlyFiles: true,
    ignore: [...DEFAULT_IGNORE, ...ignore],
  })
}
