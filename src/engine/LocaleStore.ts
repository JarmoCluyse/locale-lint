// LocaleStore — headless, read-only replacement for upstream's
// `core/loaders/LocaleLoader.ts` (NOT vendored: ~40% VS Code I/O
// (`workspace.fs`, `window` dialogs, `RelativePattern` watchers) + ~200
// lines of write-path we don't need — see /tmp/i18n-ally/src/core/loaders/LocaleLoader.ts).
//
// This class extends the vendored abstract `Loader`
// (`src/vendor/core/loaders/Loader.ts`) rather than structurally
// implementing some ad-hoc interface, because `Loader` already implements
// the bulk of the read surface vendored code needs
// (`getNodeByKey`/`getValueByKey`/`getTreeNodeByKey`/`getTranslationsByKey`/
// `rewriteKeys`/`getShadowNodeByKey`/`getShadowLocales`/`getCoverage`, plus
// the protected `updateTree` tree-builder) purely in terms of
// `this.root`/`this.flattenLocaleTree`. Extending it means `CurrentFile.loader
// = new LocaleStore(...)` is a drop-in `Loader` for all 6 vendored call sites
// (`docs/shim-surface.md`: `core/Analyst.ts`, `core/KeyDetector.ts`,
// `core/Nodes.ts`, `utils/Regex.ts`, `utils/prompts.ts`) — we only need to
// supply the locale-file *discovery and parsing* machinery upstream's
// `LocaleLoader` provided, not re-derive the tree-query methods.
//
// Write path intentionally dropped entirely: `write()` throws, `canHandleWrites()`
// is the inherited `Loader` default (`false`) — this CLI is read-only
// (`Config.readonly` is hardcoded `true`, see `shims/core-global.ts`).
import { extname, relative, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { set as lodashSet } from 'lodash'
import { Loader } from '../vendor/core/loaders/Loader'
import { LocaleTree } from '../vendor/core/Nodes'
import { File } from '../vendor/utils/File'
import type { FileInfo, PendingWrite } from '../vendor/core/types'
import type { DirStructure, ResolvedConfig } from '../runtime/types'
import { findLocaleDirs, listLocaleFiles, listSubdirNames } from './locale/discover'
import { buildPathMatchers, guessDirStructureFromDirnames, type PathMatcherEntry } from './locale/pathMatcher'
import { enabledParserExts, getEnabledParsers, getMatchedParser } from './locale/parserRegistry'
import { parseLocaleFile } from './locale/parseLocaleFile'
import type { Diagnostic, ParsedLocaleFile } from './locale/types'
import type { Parser } from '../vendor/parsers/base'

function toRelative(root: string, absPath: string): string {
  return relative(root, absPath).split('\\').join('/')
}

export class LocaleStore extends Loader {
  private readonly config: ResolvedConfig
  private _files: Record<string, ParsedLocaleFile> = {}
  private _localeDirs: string[] = []
  private _pathMatchers: PathMatcherEntry[] = []
  private _dirStructure: DirStructure = 'file'
  private _parsers: Parser[]
  private _diagnostics: Diagnostic[] = []

  constructor(config: ResolvedConfig) {
    super(`[LOCALE]${config.rootpath}`)
    this.config = config
    this._parsers = getEnabledParsers(config.enabledParsers)
  }

  /** Parse-failure / discovery diagnostics accumulated by the last `load()`/`reloadFile()`. Never throws — see `loadFile`. */
  get diagnostics(): readonly Diagnostic[] {
    return this._diagnostics
  }

  get dirStructure(): DirStructure {
    return this._dirStructure
  }

  get files(): FileInfo[] {
    return Object.values(this._files)
  }

  get locales(): string[] {
    const source = this.config.sourceLanguage
    const display = this.config.displayLanguage
    const allLocales = [...new Set(Object.values(this._files).map(f => f.locale))].sort()

    const locales = allLocales.filter(i => i !== source && i !== display)

    if (display && allLocales.includes(display))
      locales.unshift(display)
    if (display !== source && source && allLocales.includes(source))
      locales.unshift(source)

    return locales
  }

  getNamespaceFromFilepath(filepath: string): string | undefined {
    return this._files[filepath]?.namespace
  }

  /**
   * Full (re)load: discover locale dirs, infer dirStructure, build path
   * matchers, parse every locale file, rebuild the tree. Safe to call more
   * than once (clears prior state first).
   */
  async load(): Promise<void> {
    this._diagnostics = []
    this._files = {}

    this._localeDirs = await findLocaleDirs(this.config.rootpath, this.config.localesPaths)

    this._dirStructure = await this.resolveDirStructure()
    this._pathMatchers = buildPathMatchers({
      pathMatcher: this.config.pathMatcher,
      namespace: this.config.namespace,
      dirStructure: this._dirStructure,
      enabledParserExts: enabledParserExts(this._parsers, this.config.parsersExtendFileExtensions),
    })

    for (const dir of this._localeDirs) {
      const relFiles = await listLocaleFiles(dir)
      for (const relFile of relFiles)
        await this.loadFile(dir, relFile)
    }

    this.rebuildTree()
  }

  /**
   * Re-read and re-parse a single locale file, patching it into the
   * existing tree, without rescanning the rest of the project. `reloadFile`
   * is unused by the one-shot CLI today (it only ever calls `load()`) but
   * must stay a real, correct operation: a future LSP server reloads
   * individual locale files on `didChange` and must not have to pay for a
   * full `load()` per keystroke.
   */
  async reloadFile(absPath: string): Promise<void> {
    const dirpath = this._localeDirs.find(d => absPath.startsWith(d))
    if (!dirpath) {
      // Not a tracked locale file (outside any discovered locale dir) — no-op,
      // matching upstream's `onFileChanged`'s "not tracking" early-return.
      return
    }
    const relPath = toRelative(dirpath, absPath)
    await this.loadFile(dirpath, relPath)
    this.rebuildTree()
  }

  private async resolveDirStructure(): Promise<DirStructure> {
    if (this.config.dirStructure && this.config.dirStructure !== 'auto')
      return this.config.dirStructure

    const dir = this._localeDirs[0]
    if (!dir)
      return 'file'

    const dirnames = await listSubdirNames(dir)
    return guessDirStructureFromDirnames(dirnames, this.config.languageTagSystem)
  }

  private getFileInfo(dirpath: string, relativePath: string): {
    locale: string
    parser: Parser | undefined
    ext: string
    namespace?: string
    fullpath: string
    matcher?: string
  } | undefined {
    const fullpath = resolve(dirpath, relativePath)
    const ext = extname(relativePath)

    let match: RegExpExecArray | null = null
    let matcher: string | undefined
    for (const entry of this._pathMatchers) {
      match = entry.regex.exec(relativePath)
      if (match) {
        matcher = entry.matcher
        break
      }
    }
    if (!match)
      return undefined

    let namespace = match.groups?.namespace
    if (namespace)
      namespace = namespace.replace(/\//g, '.')

    let locale = match.groups?.locale?.trim()
    if (!locale)
      locale = this.config.sourceLanguage

    if (!locale)
      return undefined

    const parser = getMatchedParser(ext, this._parsers, this.config.parsersExtendFileExtensions)

    return { locale, parser, ext, namespace, fullpath, matcher }
  }

  private async loadFile(dirpath: string, relativePath: string): Promise<void> {
    const info = this.getFileInfo(dirpath, relativePath)
    const fullpath = resolve(dirpath, relativePath)
    const relForDiagnostics = toRelative(this.config.rootpath, fullpath)

    if (!info || !info.parser) {
      // Doesn't match any configured path matcher / has no supported
      // parser — silently skipped, same as upstream (not every file under a
      // locales dir is necessarily a locale file).
      return
    }

    // Clear any stale diagnostic for this exact file before re-parsing —
    // both `load()` (fresh state) and `reloadFile()` (incremental,
    // LSP-style) must converge to the diagnostic state reflecting only the
    // current contents, not an ever-growing history of past failures.
    this._diagnostics = this._diagnostics.filter(d => d.file !== relForDiagnostics)

    try {
      const buffer = await readFile(fullpath)
      const { content } = File.decode(buffer, this.config.encoding)
      const value = await parseLocaleFile(content, info.parser, {
        disablePathParsing: this.config.disablePathParsing,
      })

      this._files[fullpath] = {
        filepath: fullpath,
        dirpath,
        locale: info.locale,
        value,
        mtime: 0,
        namespace: info.namespace,
        readonly: info.parser.readonly || this.config.readonly,
        matcher: info.matcher,
      }
    }
    catch (e) {
      // A malformed locale file must NOT crash the run, and must NOT be
      // silently ignored — surface it as a Diagnostic (the report/gate lane
      // can trip exit code 12 on these) and drop any stale parsed entry for
      // this path.
      delete this._files[fullpath]
      this._diagnostics.push({
        file: relForDiagnostics,
        severity: 'error',
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  private rebuildTree(): void {
    this._flattenLocaleTree = {}
    const root = new LocaleTree({ keypath: '' })

    if (this.config.namespace) {
      const namespaces = [...new Set(this.files.map(f => (f as ParsedLocaleFile).namespace))]
      for (const ns of namespaces) {
        const filesForNs = Object.values(this._files).filter(f => f.namespace === ns)
        for (const file of filesForNs) {
          const value = ns ? lodashSet({}, ns, file.value) : file.value
          this.updateTree(root, value, '', '', { ...file, meta: { namespace: file.namespace } })
        }
      }
    }
    else {
      for (const file of Object.values(this._files))
        this.updateTree(root, file.value, '', '', file)
    }

    this._localeTree = root
  }

  async write(_pendings: PendingWrite | PendingWrite[]): Promise<void> {
    throw new Error('[LocaleStore] This CLI is read-only; writes are not supported.')
  }

  canHandleWrites(): boolean {
    return false
  }
}
