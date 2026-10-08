// FrameworkDetector — headless framework auto-detection for a project root.
//
// Upstream resolves this via `workspace.workspaceFolders` + VS Code's
// workspace API (`src/vendor/frameworks/index.ts` `getPackageDependencies`,
// the ONE remaining `workspace` reference in the vendor tree — see
// `getPackageDependencies`'s `if (!projectUrl || !workspace.workspaceFolders)
// return result` guard). That guard makes the vendored function unusable
// headlessly: in a one-shot CLI there is no VS Code workspace, so it would
// always return `{}` and auto-detection would silently never fire — exactly
// the kind of invisible failure this codebase tries to avoid everywhere
// else. Per the task brief, we do NOT edit the vendor tree to work around
// this; instead we reimplement just that one small piece here.
//
// We do NOT reuse the vendored `packagesParsers/*` classes
// (`PackageJSONParser` et al), even though their `parserRaw` logic itself
// has no vscode dependency: `PackageParser.load()` unconditionally calls
// `Log.info(...)` (both on the "file not found" and "file found" paths —
// see `src/vendor/packagesParsers/base.ts`), and `Log` is backed by
// `window.createOutputChannel`/`appendLine` in the vscode shim, which is
// STILL a bare `notImplemented()` proxy as of this writing (that lane hasn't
// gotten to `window` yet). So calling `PackageJSONParser.load()` today
// throws unconditionally, regardless of root. Rather than block framework
// detection on a concurrent lane, we reimplement the (tiny, stable) manifest
// field-extraction logic directly below — each function's doc comment
// quotes the exact vendored `parserRaw` it mirrors, so this is easy to
// re-sync if upstream's parsing logic ever changes. `getEnabledFrameworks`
// itself (the actual detection-matching logic) IS reused from the vendor
// tree as-is — it's pure (no Log/vscode dependency) and is the part we
// most want to stay byte-for-byte in sync with upstream.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import yaml from 'js-yaml'
import {
  frameworks as ALL_FRAMEWORKS,
  getEnabledFrameworks,
} from '../vendor/frameworks'
import type { Framework, PackageDependencies } from '../vendor/frameworks'

const MANIFEST_FILENAMES = ['package.json', 'pubspec.yaml', 'composer.json', 'Gemfile']

function hasAnyManifest(dir: string): boolean {
  return MANIFEST_FILENAMES.some(name => existsSync(resolvePath(dir, name)))
}

function readFileIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

/** Mirrors `PackageJSONParser.parserRaw` (src/vendor/packagesParsers/packageJSON.ts). */
function readPackageJsonDeps(root: string): string[] | undefined {
  const raw = readFileIfExists(resolvePath(root, 'package.json'))
  if (raw === undefined)
    return undefined
  try {
    const { dependencies = {}, devDependencies = {}, peerDependencies = {} } = JSON.parse(raw)
    return [...Object.keys(dependencies), ...Object.keys(devDependencies), ...Object.keys(peerDependencies)]
  }
  catch {
    return undefined
  }
}

/** Mirrors `PubspecYAMLParser.parserRaw` (src/vendor/packagesParsers/pubspecYAML.ts). */
function readPubspecYamlDeps(root: string): string[] | undefined {
  const raw = readFileIfExists(resolvePath(root, 'pubspec.yaml'))
  if (raw === undefined)
    return undefined
  try {
    const { dependencies = {}, dev_dependencies: devDependencies = {} } = (yaml.load(raw) as any) ?? {}
    return [...Object.keys(dependencies), ...Object.keys(devDependencies)]
  }
  catch {
    return undefined
  }
}

/** Mirrors `ComposerJSONParser.parserRaw` (src/vendor/packagesParsers/composerJSON.ts). */
function readComposerJsonDeps(root: string): string[] | undefined {
  const raw = readFileIfExists(resolvePath(root, 'composer.json'))
  if (raw === undefined)
    return undefined
  try {
    const { require: requireDeps = {} } = JSON.parse(raw)
    return Object.keys(requireDeps)
  }
  catch {
    return undefined
  }
}

/** Mirrors `GemfileParser.parserRaw` (src/vendor/packagesParsers/gemfile.ts). */
function readGemfileDeps(root: string): string[] | undefined {
  const raw = readFileIfExists(resolvePath(root, 'Gemfile'))
  if (raw === undefined)
    return undefined
  return /gem ["']rails-i18n['"]/.test(raw) ? ['rails-i18n'] : []
}

/**
 * Headless reimplementation of upstream's `getPackageDependencies` minus the
 * `workspace.workspaceFolders` guard (see module doc comment for why the
 * individual manifest readers are also reimplemented rather than reused).
 */
function getPackageDependenciesHeadless(root: string): PackageDependencies {
  return {
    none: [],
    packageJSON: readPackageJsonDeps(root),
    pubspecYAML: readPubspecYamlDeps(root),
    composerJSON: readComposerJsonDeps(root),
    gemfile: readGemfileDeps(root),
  }
}


/**
 * Walk upward from `startDir` looking for the nearest directory containing a
 * recognised manifest file, stopping at (and including) `stopAtDir`. Used to
 * find the owning package root for a `localesPaths` entry in a monorepo,
 * without walking past the project root.
 */
function findNearestManifestRoot(startDir: string, stopAtDir: string): string | undefined {
  let dir = startDir
  const stop = resolvePath(stopAtDir)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (hasAnyManifest(dir))
      return dir
    if (resolvePath(dir) === stop)
      return undefined
    const parent = dirname(dir)
    if (parent === dir)
      return undefined // filesystem root, stopAtDir wasn't an ancestor
    dir = parent
  }
}

export interface FrameworkDetectionInput {
  rootpath: string
  localesPaths?: string[]
}

/**
 * Candidate roots to scan for manifests: always the project root, plus (for
 * minimal monorepo support) the nearest enclosing package for each
 * `localesPaths` entry that isn't already under the root's own manifest.
 * Deliberately simple — this does not attempt full workspace-graph
 * resolution (no `pnpm-workspace.yaml`/lerna parsing), just "does this
 * locales path live under a different package.json than the root".
 */
function candidateRoots(input: FrameworkDetectionInput): string[] {
  const root = resolvePath(input.rootpath)
  const roots = new Set<string>([root])

  for (const localesPath of input.localesPaths ?? []) {
    const abs = resolvePath(root, localesPath)
    const startDir = existsSync(abs) && !abs.endsWith('/') ? dirname(abs) : abs
    const found = findNearestManifestRoot(startDir, root)
    if (found)
      roots.add(found)
  }

  return [...roots]
}

/**
 * Detect which vendored frameworks apply to a project root (and, minimally,
 * monorepo sub-packages implied by `localesPaths`).
 *
 * Returns frameworks in the CANONICAL order they appear in the vendored
 * `frameworks` array (src/vendor/frameworks/index.ts), regardless of how
 * many candidate roots were scanned or in what order — this is what makes
 * detection deterministic across runs/machines, which matters for the
 * golden-output conformance suite.
 */
export function detectFrameworks(input: FrameworkDetectionInput): Framework[] {
  const detectedIds = new Set<string>()

  for (const root of candidateRoots(input)) {
    const dependencies = getPackageDependenciesHeadless(root)
    for (const framework of getEnabledFrameworks(dependencies, root))
      detectedIds.add(framework.id)
  }

  return ALL_FRAMEWORKS.filter(f => detectedIds.has(f.id))
}
