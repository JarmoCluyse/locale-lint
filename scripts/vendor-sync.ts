#!/usr/bin/env tsx
/**
 * vendor-sync.ts
 *
 * Reproduces src/vendor/** deterministically from an upstream checkout of
 * lokalise/i18n-ally. src/vendor/** is a MACHINE-GENERATED artifact — do not
 * hand-edit it. Re-run this script (or `npm run vendor:sync`) after
 * re-pointing --upstream at a new commit.
 *
 * Usage:
 *   tsx scripts/vendor-sync.ts [--upstream <path>] [--out <path>] [--with-sfc-loaders] [--check]
 *
 *   --upstream <path>     Path to upstream i18n-ally checkout (default: /tmp/i18n-ally)
 *   --out <path>           Destination vendor dir (default: src/vendor)
 *   --with-sfc-loaders     Include core/loaders/VueSfcLoader.ts and
 *                           core/loaders/FluentVueSfcLoader.ts (needs the
 *                           unmaintained vue-i18n-locale-message / fluent-vue-cli
 *                           packages). Off by default.
 *   --check                 Don't write anything; diff against --out and exit
 *                           non-zero if they differ (used by vendor:check / tests).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, posix } from 'node:path'
import { Project, QuoteKind, SyntaxKind } from 'ts-morph'

const HEADER_SHA = '4c504c93'
const HEADER = `// Vendored from lokalise/i18n-ally @${HEADER_SHA} — MIT. See NOTICE.`

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function parseArgs(argv: string[]) {
  const args = { upstream: '/tmp/i18n-ally', out: 'src/vendor', withSfcLoaders: false, check: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--upstream') args.upstream = argv[++i]
    else if (a === '--out') args.out = argv[++i]
    else if (a === '--with-sfc-loaders') args.withSfcLoaders = true
    else if (a === '--check') args.check = true
  }
  return args
}

// ---------------------------------------------------------------------------
// Include / deny lists
// ---------------------------------------------------------------------------
// Directories copied recursively (relative to <upstream>/src)
const INCLUDE_DIRS = [
  'extraction',
  'parsers',
  'frameworks',
  'packagesParsers',
  'core/loaders',
  'tagSystems',
]

// Individual files copied (relative to <upstream>/src)
const INCLUDE_FILES = [
  'meta.ts',
  'core/KeyDetector.ts',
  'core/Analyst.ts',
  'core/types.ts',
  'core/Nodes.ts',
  'core/Errors.ts',
  'core/Telemetry.ts',
  'core/Translator.ts',
  'utils/glob.ts',
  'utils/Log.ts',
  'utils/LanguageId.ts',
  'utils/utils.ts',
  'utils/UnicodeDecorator.ts',
  'utils/UnicodeProgressBar.ts',
  'utils/NodeHelper.ts',
  'utils/File.ts',
  'utils/Regex.ts',
  'utils/flat.ts',
  'utils/flags.ts',
  'utils/cache.ts',
  'utils/PathMatcher.ts',
  'utils/prompts.ts',
  'utils/shared.ts',
  'utils/keypathValidate.ts',
  'utils/index.ts',
]

// Optional files gated behind --with-sfc-loaders
const SFC_LOADER_FILES = [
  'core/loaders/VueSfcLoader.ts',
  'core/loaders/FluentVueSfcLoader.ts',
]

// Exact relative paths (posix, relative to <upstream>/src) that must NEVER
// be copied, regardless of INCLUDE_DIRS/INCLUDE_FILES.
const DENYLIST_EXACT = new Set([
  'core/Global.ts',
  'core/Config.ts',
  'core/CurrentFile.ts',
  'core/Telemetry.ts',
  'core/Translator.ts',
  'core/loaders/LocaleLoader.ts',
])

// Glob-ish denylist rules
function isDenylisted(relPath: string, withSfcLoaders: boolean): boolean {
  if (DENYLIST_EXACT.has(relPath))
    return true
  if (/Watcher/.test(relPath))
    return true
  if (/^(editor|commands|views|translators|i18n)\//.test(relPath))
    return true
  if (/^extension/.test(relPath))
    return true
  if (!withSfcLoaders && SFC_LOADER_FILES.includes(relPath))
    return true
  return false
}

// Names that get redirected to a shim instead of being vendored.
const SHIM_TARGET: Record<string, { module: string, exportName: string }> = {
  Global: { module: 'core-global', exportName: 'Global' },
  Config: { module: 'core-global', exportName: 'Config' },
  CurrentFile: { module: 'current-file', exportName: 'CurrentFile' },
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------
function walk(dir: string, base: string): string[] {
  const out: string[] = []
  if (!existsSync(dir))
    return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    const rel = posix.join(base, entry.name)
    if (entry.isDirectory())
      out.push(...walk(abs, rel))
    else if (entry.name.endsWith('.ts'))
      out.push(rel)
  }
  return out
}

function discoverIncludedFiles(upstreamSrc: string, withSfcLoaders: boolean): string[] {
  const files = new Set<string>()
  for (const dir of INCLUDE_DIRS) {
    for (const f of walk(join(upstreamSrc, dir), dir))
      files.add(f)
  }
  for (const f of INCLUDE_FILES)
    files.add(f)
  if (withSfcLoaders) {
    for (const f of SFC_LOADER_FILES)
      files.add(f)
  }
  return [...files].filter(f => !isDenylisted(f, withSfcLoaders)).sort()
}

// ---------------------------------------------------------------------------
// Import rewriting
// ---------------------------------------------------------------------------
function toPosix(p: string) {
  return p.split('\\').join('/')
}

function relImport(fromFile: string, toFileNoExt: string): string {
  // fromFile/toFileNoExt are posix paths relative to <out>
  let rel = toPosix(relative(dirname(fromFile), toFileNoExt))
  if (!rel.startsWith('.'))
    rel = `./${rel}`
  return rel
}

/** Resolve a relative import specifier (from `fromFile`) to a vendor-relative posix path with no extension, or null if it's not resolvable as a local file (bare specifier). */
function resolveRelativeSpecifier(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.'))
    return null
  const resolved = posix.normalize(posix.join(posix.dirname(fromFile), spec))
  return resolved
}

/** Is this a "core barrel" import: `~/core`, or a `.`/`..` import that resolves to core/index.ts? */
function isCoreBarrelSpecifier(fromFile: string, spec: string): boolean {
  if (spec === '~/core')
    return true
  if (spec === '.' || spec === './index') {
    const resolved = resolveRelativeSpecifier(fromFile, spec)
    return resolved === 'core/index' || resolved === 'core'
  }
  if (spec === '..' || spec === '../index') {
    const resolved = resolveRelativeSpecifier(fromFile, spec)
    return resolved === 'core/index' || resolved === 'core'
  }
  return false
}

interface RewriteStats {
  vscodeRewrites: number
  shimRewrites: number
  barrelSplits: number
}

// ---------------------------------------------------------------------------
// Targeted write-path patches
// ---------------------------------------------------------------------------
// ComposedLoader.ts references two write-path-only symbols that we never
// vendor: `Translator` (a denylisted core singleton) and
// `FulfillAllMissingKeys` (from the non-vendored `commands/manipulations`
// module). This CLI is read-only, so we strip both the imports and their
// call sites rather than vendoring write-path machinery. Implemented as a
// small versioned patch (not a regex) so upstream re-syncs stay cheap to
// review: if upstream restructures this file enough that the patch no
// longer applies, `getImportDeclaration`/`getClassOrThrow` etc. below will
// throw loudly instead of silently no-op'ing.
function patchComposedLoader(project: Project, stageDir: string) {
  const relPath = 'core/loaders/ComposedLoader.ts'
  const abs = join(stageDir, relPath)
  const sf = project.getSourceFile(abs)
  if (!sf)
    return // file not vendored in this configuration (shouldn't happen; it's in INCLUDE_DIRS)

  // Remove `import { Translator } from '../Translator'`
  const translatorImport = sf.getImportDeclaration(d => d.getModuleSpecifierValue() === '../Translator')
  translatorImport?.remove()

  // Remove `import { FulfillAllMissingKeys } from '../../commands/manipulations'`
  const fulfillImport = sf.getImportDeclaration(d => d.getModuleSpecifierValue() === '../../commands/manipulations')
  fulfillImport?.remove()

  const cls = sf.getClass('ComposedLoader')
  if (!cls) {
    throw new Error(`[vendor-sync] patchComposedLoader: expected class ComposedLoader in ${relPath} — codemod needs updating for the new upstream shape`)
  }

  // Strip the `this._disposables.push(Translator.onDidChange(...))` call in
  // the constructor.
  const ctor = cls.getConstructors()[0]
  if (ctor) {
    const body = ctor.getBodyText() ?? ''
    if (body.includes('Translator.onDidChange')) {
      ctor.setBodyText(body.replace(/this\._disposables\.push\(\s*Translator\.onDidChange\([^]*?\),\s*\)\n?/, ''))
    }
  }

  // Strip the `Config.keepFulfilled` branch in `write()` that calls
  // FulfillAllMissingKeys, replacing it with a no-op passthrough (pendings
  // unchanged) — upstream's write-path "keep fulfilled keys" feature has no
  // meaning in a read-only CLI.
  const writeMethod = cls.getMethod('write')
  if (writeMethod) {
    const text = writeMethod.getBodyText() ?? ''
    if (text.includes('FulfillAllMissingKeys')) {
      const patched = text.replace(
        /if \(Config\.keepFulfilled[^]*?\n\s*\}\n/,
        '// write-path "keepFulfilled" (FulfillAllMissingKeys) stripped by vendor-sync codemod: read-only CLI.\n',
      )
      if (patched === text) {
        throw new Error('[vendor-sync] patchComposedLoader: FulfillAllMissingKeys call site pattern not found — codemod needs updating')
      }
      writeMethod.setBodyText(patched)
    }
  }
}

// ---------------------------------------------------------------------------
// Analyst.ts — editor-lifecycle orchestration (file-watch cache invalidation,
// `workspace.textDocuments`/`openTextDocument` lookups, the usage-report
// EventEmitter) has no meaning in a one-shot CI process: there is no editor,
// nothing to watch, and no cache to invalidate across runs. By design this
// CLI's (future) UsageScanner lane owns enumerating files, building
// `document`s (via `TextDocument.fromFile`), and aggregating a report;
// `Analyst` is stripped down to its PURE per-document occurrence extractor
// so it stays a pure function of (document, config) — required for
// worker-thread parallelism and a future LSP server alike.
//
// Kept: `getOccurrencesOfFile` (now takes a `TextDocument` instead of
// resolving one via `workspace.textDocuments`/`openTextDocument`),
// `getOccurrencesOfText`, `normalizeKey`.
// Removed: `_cache`, `_onDidUsageReportChanged`/`onDidUsageReportChanged`,
// `invalidateCache`, `invalidateCacheOf`, `watch`, `hasCache`, `refresh`,
// `updateCache`, `enumerateDocumentPaths`, `getAllOccurrences`,
// `getAllOccurrenceLocations`, `getLocationOf`, `analyzeUsage`.
function patchAnalyst(project: Project, stageDir: string) {
  const relPath = 'core/Analyst.ts'
  const abs = join(stageDir, relPath)
  const sf = project.getSourceFile(abs)
  if (!sf)
    return

  const cls = sf.getClass('Analyst')
  if (!cls) {
    throw new Error(`[vendor-sync] patchAnalyst: expected class Analyst in ${relPath} — codemod needs updating for the new upstream shape`)
  }

  const requiredKept = ['getOccurrencesOfFile', 'getOccurrencesOfText', 'normalizeKey']
  for (const name of requiredKept) {
    if (!cls.getMethod(name)) {
      throw new Error(`[vendor-sync] patchAnalyst: expected to find method "${name}" on Analyst — codemod needs updating for the new upstream shape`)
    }
  }

  const propertiesToRemove = ['_cache', '_onDidUsageReportChanged', 'onDidUsageReportChanged']
  for (const name of propertiesToRemove) {
    const prop = cls.getProperty(name)
    if (!prop)
      throw new Error(`[vendor-sync] patchAnalyst: expected property "${name}" on Analyst — codemod needs updating`)
    prop.remove()
  }

  const methodsToRemove = [
    'invalidateCache',
    'invalidateCacheOf',
    'watch',
    'hasCache',
    'refresh',
    'updateCache',
    'enumerateDocumentPaths',
    'getAllOccurrences',
    'getAllOccurrenceLocations',
    'getLocationOf',
    'analyzeUsage',
  ]
  for (const name of methodsToRemove) {
    const method = cls.getMethod(name)
    if (!method)
      throw new Error(`[vendor-sync] patchAnalyst: expected method "${name}" on Analyst — codemod needs updating`)
    method.remove()
  }

  // Rewrite getOccurrencesOfFile to take a TextDocument directly instead of
  // resolving one via `workspace.textDocuments`/`workspace.openTextDocument`.
  const getOccurrencesOfFile = cls.getMethodOrThrow('getOccurrencesOfFile')
  const oldSig = getOccurrencesOfFile.getText()
  if (!oldSig.includes('workspace.textDocuments') || !oldSig.includes('workspace.openTextDocument')) {
    throw new Error('[vendor-sync] patchAnalyst: getOccurrencesOfFile no longer matches the expected workspace-lookup shape — codemod needs updating')
  }
  getOccurrencesOfFile.setBodyText('return this.getOccurrencesOfText(document, document.uri.fsPath)')
  getOccurrencesOfFile.getParameters().forEach(p => p.remove())
  getOccurrencesOfFile.addParameter({ name: 'document', type: 'TextDocument' })
  getOccurrencesOfFile.setIsAsync(true)
  // Exposed as the future UsageScanner lane's per-document extraction entry
  // point, so it must be callable from outside the class (upstream had it
  // `private` since only its own removed orchestration called it).
  getOccurrencesOfFile.setScope(undefined)
  const getOccurrencesOfText = cls.getMethodOrThrow('getOccurrencesOfText')
  getOccurrencesOfText.setScope(undefined)

  // Imports: drop everything only needed by the removed orchestration code,
  // keep only what the pure extractor needs.
  sf.getImportDeclaration(d => d.getModuleSpecifierValue().endsWith('shims/vscode'))?.remove()
  sf.addImportDeclaration({ moduleSpecifier: relImport(abs, 'src/shims/vscode'), namedImports: ['TextDocument'] })

  sf.getImportDeclaration(d => d.getModuleSpecifierValue().endsWith('shims/core-global') && d.getNamedImports().some(n => n.getName() === 'Global'))?.remove()
  sf.getImportDeclaration(d => d.getModuleSpecifierValue().endsWith('shims/core-global') && d.getNamedImports().some(n => n.getName() === 'Config'))?.remove()
  sf.getImportDeclaration(d => d.getModuleSpecifierValue().endsWith('shims/current-file'))?.remove()
  sf.getImportDeclaration(d => d.getModuleSpecifierValue() === 'micromatch')?.remove()
  sf.getImportDeclaration(d => d.getModuleSpecifierValue() === 'lodash')?.remove()
  sf.getImportDeclaration(d => d.getModuleSpecifierValue() === 'fs')?.remove()
  sf.getImportDeclaration(d => d.getModuleSpecifierValue() === './types')?.remove()
  sf.getImportDeclaration(d => d.getModuleSpecifierValue() === '~/utils')?.remove()
  sf.getImportDeclaration(d => d.getModuleSpecifierValue() === '~/utils/glob')?.remove()

  // `import { KeyDetector, KeyOccurrence, KeyUsage } from '.'` -> drop the
  // now-unused `KeyUsage` (only used by the removed `analyzeUsage`).
  const barrelImport = sf.getImportDeclaration(d => d.getModuleSpecifierValue() === '.')
  if (barrelImport) {
    const kept = barrelImport.getNamedImports().filter(n => n.getName() !== 'KeyUsage').map(n => n.getName())
    barrelImport.removeNamedImports()
    barrelImport.addNamedImports(kept.map(name => ({ name })))
  }
}

// ---------------------------------------------------------------------------
// KeyDetector.ts — `static init(ctx: ExtensionContext)` wires a
// `workspace.onDidChangeTextDocument` cache-invalidation hook, which only
// makes sense for a long-lived editor session. A one-shot CI process never
// edits documents after reading them, so there's nothing to invalidate;
// `_get_keys_cache` becomes a plain process-lifetime cache instead (still
// keyed by filepath, as upstream keys it — each file is read/scanned once
// per run regardless).
function patchKeyDetector(project: Project, stageDir: string) {
  const relPath = 'core/KeyDetector.ts'
  const abs = join(stageDir, relPath)
  const sf = project.getSourceFile(abs)
  if (!sf)
    return

  const cls = sf.getClass('KeyDetector')
  if (!cls) {
    throw new Error(`[vendor-sync] patchKeyDetector: expected class KeyDetector in ${relPath} — codemod needs updating for the new upstream shape`)
  }

  const initMethod = cls.getMethod('init')
  if (!initMethod) {
    throw new Error('[vendor-sync] patchKeyDetector: expected method "init" on KeyDetector — codemod needs updating for the new upstream shape')
  }
  if (!initMethod.getText().includes('workspace.onDidChangeTextDocument')) {
    throw new Error('[vendor-sync] patchKeyDetector: "init" no longer matches the expected workspace.onDidChangeTextDocument shape — codemod needs updating')
  }
  initMethod.remove()

  // `workspace` and `ExtensionContext` are (after removing init) only
  // imported for that method; drop them from the vscode shim import.
  const vscodeImport = sf.getImportDeclaration(d => d.getModuleSpecifierValue().endsWith('shims/vscode'))
  if (!vscodeImport) {
    throw new Error('[vendor-sync] patchKeyDetector: expected a vscode shim import — codemod needs updating')
  }
  const toDrop = new Set(['workspace', 'ExtensionContext'])
  const remainingNamed = vscodeImport.getNamedImports().filter(n => !toDrop.has(n.getName()))
  if (remainingNamed.length === vscodeImport.getNamedImports().length) {
    throw new Error('[vendor-sync] patchKeyDetector: expected "workspace"/"ExtensionContext" in the vscode shim import — codemod needs updating')
  }
  const remainingNames = remainingNamed.map(n => n.getName())
  vscodeImport.removeNamedImports()
  vscodeImport.addNamedImports(remainingNames.map(name => ({ name })))

  // `_get_keys_cache` was invalidated by `init()`'s file-change hook; without
  // it, it's simply a plain process-lifetime cache (still keyed by filepath,
  // same as upstream — each file is read/scanned once per run regardless).
  // Converted from a plain object to a Map for clarity that it's a cache,
  // not config state.
  const cacheProp = cls.getProperty('_get_keys_cache')
  if (!cacheProp) {
    throw new Error('[vendor-sync] patchKeyDetector: expected property "_get_keys_cache" on KeyDetector — codemod needs updating')
  }
  if (cacheProp.getText() !== 'private static _get_keys_cache: Record<string, KeyInDocument[]> = {}') {
    throw new Error('[vendor-sync] patchKeyDetector: "_get_keys_cache" no longer matches the expected shape — codemod needs updating')
  }
  cacheProp.replaceWithText('private static _get_keys_cache: Map<string, KeyInDocument[]> = new Map()')

  const getKeysMethod = cls.getMethodOrThrow('getKeys')
  const body = getKeysMethod.getBodyText() ?? ''
  if (!body.includes('this._get_keys_cache[filepath]')) {
    throw new Error('[vendor-sync] patchKeyDetector: "getKeys" no longer matches the expected _get_keys_cache access shape — codemod needs updating')
  }
  const patchedBody = body
    .replace(/if \(this\._get_keys_cache\[filepath\]\)\s*\n\s*return this\._get_keys_cache\[filepath\]/, 'if (this._get_keys_cache.has(filepath))\n        return this._get_keys_cache.get(filepath)!')
    .replace(/this\._get_keys_cache\[filepath\] = keys/, 'this._get_keys_cache.set(filepath, keys)')
  if (patchedBody === body || patchedBody.includes('_get_keys_cache[filepath]')) {
    throw new Error('[vendor-sync] patchKeyDetector: failed to rewrite all "_get_keys_cache[filepath]" accesses — codemod needs updating')
  }
  getKeysMethod.setBodyText(patchedBody)
}

// ---------------------------------------------------------------------------
// frameworks/custom.ts — `startWatch`/`this.watcher` live-reload the user's
// custom framework YAML file on change via a `FileSystemWatcher`. In a
// one-shot CLI run the file is read once at startup (`load()`); there is no
// live session to reload into, so the watcher plumbing (and the
// `Global.update()` reload it triggers) is dead weight that also happens to
// not type-check against the vscode shim's `FileSystemWatcher | undefined`
// field.
function patchCustomFramework(project: Project, stageDir: string) {
  const relPath = 'frameworks/custom.ts'
  const abs = join(stageDir, relPath)
  const sf = project.getSourceFile(abs)
  if (!sf)
    return

  const cls = sf.getClass('CustomFramework')
  if (!cls) {
    throw new Error(`[vendor-sync] patchCustomFramework: expected class CustomFramework in ${relPath} — codemod needs updating for the new upstream shape`)
  }

  const startWatch = cls.getMethod('startWatch')
  if (!startWatch) {
    throw new Error('[vendor-sync] patchCustomFramework: expected method "startWatch" on CustomFramework — codemod needs updating')
  }
  if (!startWatch.getText().includes('workspace.createFileSystemWatcher')) {
    throw new Error('[vendor-sync] patchCustomFramework: "startWatch" no longer matches the expected FileSystemWatcher shape — codemod needs updating')
  }
  startWatch.remove()

  for (const name of ['watchingFor', 'watcher']) {
    const prop = cls.getProperty(name)
    if (!prop)
      throw new Error(`[vendor-sync] patchCustomFramework: expected property "${name}" on CustomFramework — codemod needs updating`)
    prop.remove()
  }

  const loadMethod = cls.getMethodOrThrow('load')
  const loadBody = loadMethod.getBodyText() ?? ''
  if (!loadBody.includes('this.startWatch(root)')) {
    throw new Error('[vendor-sync] patchCustomFramework: "load" no longer calls "this.startWatch(root)" — codemod needs updating')
  }
  loadMethod.setBodyText(loadBody.replace(/\s*this\.startWatch\(root\)\n?/, '\n'))

  // Drop now-unused imports: `workspace`/`FileSystemWatcher` (only used by
  // startWatch) and `Global` (only used by startWatch's reload callback).
  const vscodeImport = sf.getImportDeclaration(d => d.getModuleSpecifierValue().endsWith('shims/vscode'))
  if (vscodeImport) {
    const toDrop = new Set(['workspace', 'FileSystemWatcher'])
    const remaining = vscodeImport.getNamedImports().filter(n => !toDrop.has(n.getName())).map(n => n.getName())
    vscodeImport.removeNamedImports()
    vscodeImport.addNamedImports(remaining.map(name => ({ name })))
  }

  const globalImport = sf.getImportDeclaration(d => d.getModuleSpecifierValue().endsWith('shims/core-global') && d.getNamedImports().some(n => n.getName() === 'Global'))
  globalImport?.remove()
}

function rewriteImports(project: Project, filePath: string, stageDir: string, stats: RewriteStats) {
  const sf = project.getSourceFileOrThrow(filePath)
  const relFile = toPosix(relative(stageDir, filePath)) // e.g. core/loaders/ComposedLoader.ts

  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue()

    // 1. vscode -> shim
    if (spec === 'vscode') {
      imp.setModuleSpecifier(relImport(filePath, 'src/shims/vscode'))
      stats.vscodeRewrites++
      continue
    }

    // 1b. ~/i18n -> shim (extension UI-string localisation; only used for
    //     error/prompt message strings in vendored code)
    if (spec === '~/i18n') {
      imp.setModuleSpecifier(relImport(filePath, 'src/shims/i18n'))
      stats.vscodeRewrites++
      continue
    }

    // 2. Direct relative imports of denylisted core singletons
    if (spec.startsWith('.')) {
      const resolved = resolveRelativeSpecifier(relFile, spec)
      if (resolved === 'core/Global' || resolved === 'core/Config') {
        imp.setModuleSpecifier(relImport(filePath, 'src/shims/core-global'))
        stats.shimRewrites++
        continue
      }
      if (resolved === 'core/CurrentFile') {
        imp.setModuleSpecifier(relImport(filePath, 'src/shims/current-file'))
        stats.shimRewrites++
        continue
      }
    }

    // 3. `~/core` barrel or `.`/`..` barrel within core/**: split shimmed
    //    names (Global/Config/CurrentFile) out to their shim module, leave
    //    the rest pointing at the vendored barrel.
    if (isCoreBarrelSpecifier(relFile, spec)) {
      const namedImports = imp.getNamedImports()
      const shimmedNames: { name: string, alias?: string, target: string }[] = []
      const keptNames: typeof namedImports = []

      for (const ni of namedImports) {
        const name = ni.getName()
        if (name in SHIM_TARGET) {
          shimmedNames.push({ name, alias: ni.getAliasNode()?.getText(), target: SHIM_TARGET[name].module })
        }
        else {
          keptNames.push(ni)
        }
      }

      if (shimmedNames.length === 0)
        continue // nothing to split, leave pointing at vendored barrel

      stats.barrelSplits++

      // Group shimmed names by target shim module
      const byTarget = new Map<string, string[]>()
      for (const s of shimmedNames) {
        const text = s.alias ? `${s.name} as ${s.alias}` : s.name
        byTarget.set(s.target, [...(byTarget.get(s.target) ?? []), text])
      }

      const insertIndex = imp.getChildIndex()
      for (const [target, names] of byTarget) {
        sf.insertStatements(insertIndex, `import { ${names.join(', ')} } from '${relImport(filePath, `src/shims/${target}`)}'\n`)
      }

      if (keptNames.length === 0) {
        imp.remove()
      }
      else {
        const keptInfo = keptNames.map(ni => ({ name: ni.getName(), alias: ni.getAliasNode()?.getText() }))
        imp.removeNamedImports()
        imp.addNamedImports(keptInfo)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Reachability (dead-weight report)
// ---------------------------------------------------------------------------
const ENTRY_POINTS = [
  'core/KeyDetector.ts',
  'core/Analyst.ts',
  'core/loaders/Loader.ts',
  'core/loaders/ComposedLoader.ts',
  'frameworks/index.ts',
  'parsers/index.ts',
  'extraction/index.ts',
  'packagesParsers/index.ts',
  'utils/glob.ts',
  'utils/index.ts',
  // Not consumed from within src/vendor/** itself — consumed directly by
  // src/engine/locale/** (outside the vendor tree) for locale-directory-name
  // classification. Listed here so it isn't misreported as dead weight.
  'tagSystems/index.ts',
]

function computeReachable(project: Project, outDir: string, includedSet: Set<string>, withSfcLoaders: boolean): Set<string> {
  const entries = [...ENTRY_POINTS]
  if (withSfcLoaders)
    entries.push('core/loaders/VueSfcLoader.ts', 'core/loaders/FluentVueSfcLoader.ts')

  const visited = new Set<string>()
  const queue = entries.filter(e => includedSet.has(e))

  while (queue.length) {
    const rel = queue.pop()!
    if (visited.has(rel) || !includedSet.has(rel))
      continue
    visited.add(rel)
    const sf = project.getSourceFile(join(outDir, rel))
    if (!sf)
      continue
    const specs = [
      ...sf.getImportDeclarations().map(d => d.getModuleSpecifierValue()),
      ...sf.getExportDeclarations().map(d => d.getModuleSpecifierValue()).filter((s): s is string => !!s),
    ]
    for (const spec of specs) {
      let resolved: string | null = null
      if (spec.startsWith('.')) {
        resolved = resolveRelativeSpecifier(rel, spec)
      }
      else if (spec.startsWith('~/')) {
        resolved = spec.slice(2)
      }
      if (!resolved)
        continue
      // try resolved, resolved.ts, resolved/index
      const candidates = [resolved, `${resolved}/index`]
      for (const c of candidates) {
        const withExt = `${c}.ts`
        if (includedSet.has(withExt) && !visited.has(withExt))
          queue.push(withExt)
      }
    }
  }
  return visited
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const upstreamSrc = join(args.upstream, 'src')
  const outDir = args.out

  if (!existsSync(upstreamSrc)) {
    console.error(`Upstream src not found at ${upstreamSrc}`)
    process.exit(1)
  }

  const included = discoverIncludedFiles(upstreamSrc, args.withSfcLoaders)
  const includedSet = new Set(included)

  // Stage into a temp dir first so --check can diff without mutating --out.
  const stageDir = args.check ? `${outDir}.__stage__` : outDir
  if (existsSync(stageDir))
    rmSync(stageDir, { recursive: true, force: true })
  mkdirSync(stageDir, { recursive: true })

  for (const rel of included) {
    const src = join(upstreamSrc, rel)
    const dest = join(stageDir, rel)
    mkdirSync(dirname(dest), { recursive: true })
    const content = readFileSync(src, 'utf8')
    writeFileSync(dest, `${HEADER}\n${content}`)
  }
  writeFileSync(join(stageDir, '.sha'), `${HEADER_SHA}\n`)

  // core/index.ts + utils/index.ts barrels (generated, not copied verbatim
  // for core since upstream's core/index.ts re-exports Global/Config/
  // CurrentFile/Telemetry/Translator/loaders/LocaleLoader, all of which are
  // denylisted here).
  const coreBarrelExports = [
    './types',
    './KeyDetector',
    './Analyst',
    './Errors',
    './Nodes',
    './loaders/Loader',
    './loaders/ComposedLoader',
  ]
  if (args.withSfcLoaders) {
    coreBarrelExports.push('./loaders/VueSfcLoader', './loaders/FluentVueSfcLoader')
  }
  const coreIndexPath = join(stageDir, 'core/index.ts')
  mkdirSync(dirname(coreIndexPath), { recursive: true })
  writeFileSync(
    coreIndexPath,
    `${HEADER}\n// Generated barrel — re-exports only the symbols actually vendored.\n${coreBarrelExports.map(e => `export * from '${e}'`).join('\n')}\n`,
  )
  includedSet.add('core/index.ts')

  // Rewrite imports with ts-morph
  const project = new Project({
    compilerOptions: { allowJs: false },
    skipAddingFilesFromTsConfig: true,
    manipulationSettings: { quoteKind: QuoteKind.Single },
  })
  for (const rel of [...includedSet])
    project.addSourceFileAtPath(join(stageDir, rel))

  const stats: RewriteStats = { vscodeRewrites: 0, shimRewrites: 0, barrelSplits: 0 }
  for (const rel of [...includedSet].filter(r => r !== 'core/index.ts'))
    rewriteImports(project, join(stageDir, rel), stageDir, stats)

  patchComposedLoader(project, stageDir)
  patchAnalyst(project, stageDir)
  patchKeyDetector(project, stageDir)
  patchCustomFramework(project, stageDir)

  await project.save()

  // Reachability / dead-weight report
  const reachable = computeReachable(project, stageDir, includedSet, args.withSfcLoaders)
  const deadWeight = [...includedSet].filter(f => f !== 'core/index.ts' && !reachable.has(f)).sort()

  console.log(`[vendor-sync] upstream=${args.upstream} sha=${HEADER_SHA} withSfcLoaders=${args.withSfcLoaders}`)
  console.log(`[vendor-sync] vendored files: ${includedSet.size}`)
  console.log(`[vendor-sync] vscode rewrites: ${stats.vscodeRewrites}, direct shim rewrites: ${stats.shimRewrites}, barrel splits: ${stats.barrelSplits}`)
  if (deadWeight.length) {
    console.log(`[vendor-sync] DEAD WEIGHT (included but unreachable from entry points):`)
    for (const f of deadWeight)
      console.log(`  - ${f}`)
  }
  else {
    console.log('[vendor-sync] no dead weight detected')
  }

  if (args.check) {
    const { execSync } = await import('node:child_process')
    try {
      execSync(`diff -rq "${stageDir}" "${outDir}"`, { stdio: 'pipe' })
      console.log('[vendor-sync] --check: OK, vendor tree matches regenerated output')
      rmSync(stageDir, { recursive: true, force: true })
    }
    catch (e: any) {
      console.error('[vendor-sync] --check: MISMATCH')
      console.error(e.stdout?.toString() ?? e.message)
      rmSync(stageDir, { recursive: true, force: true })
      process.exit(1)
    }
  }
}

main()
