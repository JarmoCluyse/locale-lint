// Config shape for the headless locale-lint runtime.
//
// This mirrors (a subset + superset of) upstream i18n-ally's
// `contributes.configuration` defaults, flattened into camelCase dot-paths
// with the `i18n-ally.` prefix stripped. See docs/shim-surface.md for the
// exact vendored call-site contract this must satisfy.

export type DirStructure = 'auto' | 'file' | 'dir'
export type KeyStyle = 'auto' | 'nested' | 'flat'

export interface RefactorTemplate {
  templates: string[]
  source?: string
  include?: string[]
  exclude?: string[]
}

export interface UsageConfig {
  scanningIgnore: string[]
  derivedKeyRules: string[]
  /**
   * Explicit override for the source-file discovery glob (fast-glob
   * patterns, e.g. `["**\/*.{php,blade.php}"]`). When unset, the glob is
   * derived from detected/configured frameworks' `languageIds` — see
   * `src/runtime/SourceGlob.ts`. Set this to bypass derivation entirely
   * (e.g. for a framework this engine doesn't vendor, or to narrow scanning
   * to a subset of extensions).
   */
  include?: string[]
}

export interface HardStringConfig {
  keygenStrategy: string
  keygenStyle: string
  keyPrefix: string
  keyMaxLength?: number
  targetPickingStrategy: string
  autoDetect: boolean
  /**
   * Exact *strings* to ignore (e.g. specific hard-coded literals that are
   * intentionally not translated, like a brand name). NOT file globs — see
   * `ignoreGlobs` for that. Do not conflate the two.
   */
  ignored: string[]
  ignoredByFiles: Record<string, string[]>
  /**
   * FILE-level ignore globs for the hard-string scan specifically (e.g.
   * `**\/*.stories.tsx`). Distinct from `ignored` (exact *string* values to
   * ignore wherever found) and from `usage.scanningIgnore` (the usage-scan's
   * file ignore list, semantically a different scan).
   *
   * When unset, the hard-string scanner falls back to `usage.scanningIgnore`
   * so existing configs that only set the usage ignore list keep the same
   * behavior. Set this explicitly to diverge the two scans' ignore lists.
   */
  ignoreGlobs?: string[]
}

export interface ReportConfig {
  // CLI-specific reporting knobs (no upstream equivalent); kept permissive.
  format?: string
  outFile?: string
}

export interface GateConfig {
  // CLI-specific CI gate thresholds (no upstream equivalent).
  failOnMissing?: boolean
  failOnIdle?: boolean
  failOnHardStrings?: boolean
  /**
   * Fail the gate if the hard-string scan finds more than this many
   * occurrences. Flows through all four config layers (previously
   * `--max-hard-strings` was CLI-only and bypassed ConfigResolver entirely).
   */
  maxHardStrings?: number
}

export interface ResolvedConfig {
  // --- root / paths ---
  rootpath: string
  localesPaths: string[] | undefined
  pathMatcher: string | undefined
  namespace: boolean
  dirStructure: DirStructure | undefined
  encoding: string
  sourceLanguage: string | undefined
  displayLanguage: string | undefined
  ignoredLocales: string[]
  keystyle: KeyStyle
  frameworks: string[] | undefined
  languageIdOverrides: Record<string, string>
  /**
   * Upstream `Config.tagSystem` selector (`i18n-ally.languageTagSystem`,
   * default `'bcp47'`): which `src/vendor/tagSystems/*` implementation to
   * use for locale-code normalisation/validation (e.g. classifying whether
   * a directory name "looks like" a real locale code). `'legacy'` is the
   * pre-v2 i18n-ally behavior (looser); `'none'` disables normalisation.
   */
  languageTagSystem: 'bcp47' | 'legacy' | 'none'

  // --- misc toplevel (shim-surface members) ---
  disabled: boolean
  autoDetection: boolean
  disablePathParsing: boolean
  defaultNamespace: string | undefined
  indent: number
  tabStyle: 'space' | 'tab'
  readonly: boolean
  keepFulfilled: boolean
  translatePromptSource: boolean
  keysInUse: string[]
  extensionPath: string
  parsersTypescriptTsNodePath: string
  parsersTypescriptCompilerOption: Record<string, unknown>
  parsersExtendFileExtensions: Record<string, string>
  parserOptions: Record<string, unknown> | undefined
  /**
   * Upstream `Config.localeCountryMap` (default `{}`): maps a language
   * subtag (e.g. `en`) to a country/region code, used only by
   * `BCP47.toFlagname` for flag-emoji display — not consumed by this
   * headless CLI's own code, only present because it's part of the
   * vendored `tagSystems/bcp47.ts` type surface.
   */
  localeCountryMap: Record<string, string>

  frameworksRubyRailsScopeRoot: string

  regexKey: string | undefined
  regexUsageMatch: (string | RegExp)[] | undefined
  regexUsageMatchAppend: (string | RegExp)[]

  refactorTemplates: RefactorTemplate[]

  extractParserHTMLOptions: Record<string, unknown>
  extractParserBabelOptions: Record<string, unknown>

  enabledFrameworks: string[] | undefined
  enabledParsers: string[] | undefined

  // --- grouped sections ---
  usage: UsageConfig
  hardString: HardStringConfig
  report: ReportConfig
  gate: GateConfig

  concurrency: number
  cache: boolean
}

/** Sparse partial — `undefined` means "absent / not set by this layer". */
export type PartialResolvedConfig = {
  [K in keyof ResolvedConfig]?: ResolvedConfig[K] extends Array<infer _T>
    ? ResolvedConfig[K] | { $append: ResolvedConfig[K] } | { $replace: ResolvedConfig[K] }
    : ResolvedConfig[K]
}

export type ArrayOp<T> = { $append: T[] } | { $replace: T[] }

export function isArrayOp(v: unknown): v is ArrayOp<unknown> {
  return !!v && typeof v === 'object' && ('$append' in (v as any) || '$replace' in (v as any))
}

export type LayerName = 'default' | 'vscode' | 'config' | 'cli'

export interface ConfigLayer {
  name: LayerName
  values: PartialResolvedConfig
}
