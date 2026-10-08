// Freezes (or checks) `locale-lint`'s CLI output across a corpus of
// upstream i18n-ally example projects, vendored at
// `test/conformance/corpus/`. This is the "executable specification" the
// usage/hardstring scanners are held to — see `docs/conformance.md`.
//
// Usage:
//   tsx scripts/freeze-golden.ts            # write golden/**
//   tsx scripts/freeze-golden.ts --check     # diff against golden/**, exit 1 on mismatch
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, type Dirent } from 'node:fs'
import { join, relative, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
export const ROOT = join(__dirname, '..')
export const CORPUS_ROOT = join(ROOT, 'test/conformance/corpus')
export const GOLDEN_ROOT = join(ROOT, 'golden')
export const CLI_PATH = join(ROOT, 'dist/cli.cjs')

export const CATEGORIES = ['by-frameworks', 'by-features']
export const COMMANDS = ['usage', 'hardstring'] as const

const CHECK_MODE = process.argv.includes('--check')

export interface ProjectEntry {
  category: string
  /** Project path relative to the category dir, e.g. "path-matcher/locale-namespaces". */
  relPath: string
  absPath: string
}

// Marker files that identify a corpus leaf as "a project" (as opposed to an
// intermediate grouping directory, e.g. `path-matcher/` which holds two
// separate sub-projects and has no marker file of its own). Different
// frameworks in the corpus use different project-manifest conventions —
// `package.json` for JS/TS, but `composer.json` (Laravel/PHP), `pubspec.yaml`
// (Flutter), `Gemfile` (Rails/Jekyll), `manifest.json` (Chrome extension).
// `.vscode/settings.json` is the catch-all fallback for corpora (e.g.
// `php-po`) that have none of the above but still carry i18n-ally config.
const PROJECT_MARKERS = ['package.json', 'composer.json', 'pubspec.yaml', 'Gemfile', 'manifest.json']

function hasProjectMarker(dir: string, entries: Dirent[]): boolean {
  const fileNames = new Set(entries.filter(e => e.isFile()).map(e => e.name))
  if (PROJECT_MARKERS.some(marker => fileNames.has(marker)))
    return true
  return existsSync(join(dir, '.vscode', 'settings.json'))
}

function findProjects(categoryDir: string, category: string): ProjectEntry[] {
  const results: ProjectEntry[] = []

  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true })
    const subdirs = entries.filter(e => e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git' && e.name !== '.vscode' && e.name !== 'locales' && e.name !== 'lang' && e.name !== 'i18n' && e.name !== 'src' && e.name !== 'public' && e.name !== 'modules' && e.name !== 'app')

    if (hasProjectMarker(dir, entries)) {
      results.push({ category, relPath: relative(categoryDir, dir), absPath: dir })
      return
    }

    for (const sub of subdirs)
      walk(join(dir, sub.name))
  }

  walk(categoryDir)
  return results
}

export function discoverAllProjects(): ProjectEntry[] {
  const all: ProjectEntry[] = []
  for (const category of CATEGORIES) {
    const dir = join(CORPUS_ROOT, category)
    if (!existsSync(dir))
      continue
    all.push(...findProjects(dir, category))
  }
  all.sort((a, b) => (a.category === b.category ? a.relPath.localeCompare(b.relPath) : a.category.localeCompare(b.category)))
  return all
}

export interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

export function runCli(command: string, cwd: string): RunResult {
  try {
    const stdout = execFileSync('node', [CLI_PATH, command, '.', '--format', 'json'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { exitCode: 0, stdout, stderr: '' }
  }
  catch (e: any) {
    // execFileSync throws on non-zero exit; the stdout/stderr are still on the error object.
    return {
      exitCode: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout ? e.stdout.toString('utf8') : '',
      stderr: e.stderr ? e.stderr.toString('utf8') : '',
    }
  }
}

/**
 * The vendored engine's config resolver stamps `config.rootpath` with the
 * literal CWD the CLI was invoked from (there's no `--root` override here),
 * and a handful of diagnostic messages embed it verbatim. That CWD is the
 * project's *absolute* path inside this checkout, which differs across
 * machines/clones — so it must be scrubbed before anything is committed as
 * a deterministic golden snapshot.
 */
export function normalize(text: string, projectAbsPath: string): string {
  if (!text)
    return text
  const escaped = projectAbsPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.split(new RegExp(escaped, 'g')).join('<PROJECT_ROOT>')
}

export function goldenPath(entry: ProjectEntry, command: string): string {
  const safeName = entry.relPath.split(sep).join('__')
  return join(GOLDEN_ROOT, entry.category, `${safeName}.${command}.json`)
}

export interface GoldenFile {
  project: string
  command: string
  exitCode: number
  stdout: string
  stderr: string
}

export function buildGolden(entry: ProjectEntry, command: string): GoldenFile {
  const raw = runCli(command, entry.absPath)
  return {
    project: `${entry.category}/${entry.relPath}`,
    command,
    exitCode: raw.exitCode,
    stdout: normalize(raw.stdout, entry.absPath),
    stderr: normalize(raw.stderr, entry.absPath),
  }
}

export function serialize(golden: GoldenFile): string {
  return `${JSON.stringify(golden, null, 2)}\n`
}

function main(): void {
  if (!existsSync(CLI_PATH))
    throw new Error(`CLI binary not found at ${CLI_PATH}. Run \`npm run build\` first.`)

  const projects = discoverAllProjects()
  if (projects.length === 0)
    throw new Error(`No corpus projects found under ${CORPUS_ROOT}. Did the corpus get copied in?`)

  let mismatches = 0
  let written = 0

  interface CensusRow {
    project: string
    command: string
    exitCode: number
    empty: boolean
    error: boolean
  }
  const census: CensusRow[] = []

  for (const entry of projects) {
    for (const command of COMMANDS) {
      const golden = buildGolden(entry, command)
      const serialized = serialize(golden)
      const outPath = goldenPath(entry, command)

      let parsedStdout: any
      try {
        parsedStdout = JSON.parse(golden.stdout)
      }
      catch {
        parsedStdout = undefined
      }
      const isEmpty = command === 'usage'
        ? !!parsedStdout && (parsedStdout.summary?.filesScanned ?? 0) > 0 && (parsedStdout.missing?.length ?? 0) === 0 && (parsedStdout.unused?.length ?? 0) === 0 && (parsedStdout.summary?.usedKeyCount ?? 0) === 0
        : !!parsedStdout && (parsedStdout.summary?.filesScanned ?? 0) > 0 && (parsedStdout.findings?.length ?? 0) === 0
      // 10/11/12 = config error / no files matched / parse-errors-exceeded; 70 = internal error.
      const isError = [10, 11, 12, 70].includes(golden.exitCode) || parsedStdout === undefined

      census.push({ project: golden.project, command, exitCode: golden.exitCode, empty: isEmpty, error: isError })

      if (CHECK_MODE) {
        if (!existsSync(outPath)) {
          console.error(`MISSING golden file: ${relative(ROOT, outPath)}`)
          mismatches++
          continue
        }
        const existing = readFileSync(outPath, 'utf8')
        if (existing !== serialized) {
          console.error(`MISMATCH: ${relative(ROOT, outPath)}`)
          mismatches++
        }
      }
      else {
        mkdirSync(join(outPath, '..'), { recursive: true })
        writeFileSync(outPath, serialized, 'utf8')
        written++
      }
    }
  }

  console.log(`\n${CHECK_MODE ? 'Checked' : 'Froze'} ${projects.length} corpus projects x ${COMMANDS.length} commands.`)

  console.log('\n-- Coverage census --')
  for (const row of census) {
    const flags = [row.empty && 'EMPTY', row.error && 'ERROR'].filter(Boolean).join(',')
    console.log(`${flags ? `[${flags}]`.padEnd(14) : ''.padEnd(14)} ${row.project} (${row.command}) exit=${row.exitCode}`)
  }

  const emptyCount = census.filter(r => r.empty).length
  const errorCount = census.filter(r => r.error).length
  console.log(`\n${census.length} total runs, ${emptyCount} empty, ${errorCount} error (exit>=70 or unparsable stdout).`)

  if (CHECK_MODE) {
    if (mismatches > 0) {
      console.error(`\n${mismatches} golden mismatch(es). Run \`npm run golden:freeze\` and review the diff before committing.`)
      process.exit(1)
    }
    console.log('\nAll golden snapshots match.')
  }
  else {
    console.log(`\nWrote ${written} golden snapshot(s) to ${relative(ROOT, GOLDEN_ROOT)}/`)
  }
}

// Only run when executed directly (`tsx scripts/freeze-golden.ts`), not when
// imported for its exports (e.g. by `test/conformance/golden.test.ts`).
const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolvePath(process.argv[1])
if (invokedDirectly)
  main()
