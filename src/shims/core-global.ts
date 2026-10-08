// Implements the upstream i18n-ally `Global` / `Config` static-class ACCESS
// SHAPE (Config.rootpath, Global.getUsageMatchRegex(...), etc.) so vendored
// call sites (src/vendor/**) need zero changes. Backed by a module-level
// singleton installed via `installRuntime(ctx)`.
//
// See docs/shim-surface.md for the exact surface this must implement
// (Config: 21 members, Global: 10).
//
// IMPORTANT: accessing any member before `installRuntime()` throws — a
// silently-undefined matcher would disable scanning invisibly, which is the
// single highest risk in this design.
//
// TYPING: `Config`/`Global` are typed to PRECISELY match upstream's real
// declarations (/tmp/i18n-ally/src/core/{Global,Config}.ts), not just "the
// shape vendored code happens to use". Where upstream declares a
// non-optional type (e.g. `Config.displayLanguage: string`,
// `Global.getVisibleLocales(): string[]`), ours is non-optional too, with an
// explicit (and where the default masks missing user config, *warned-about*)
// fallback — never a silent `undefined` that would widen the type and leak
// into vendored code as `T | undefined`.

import { getExtOfLanguageId } from '../vendor/utils/LanguageId'
import { frameworks as ALL_FRAMEWORKS } from '../vendor/frameworks'
import { AvailableParsers, DefaultEnabledParsers } from '../vendor/parsers'
import { detectFrameworks } from '../runtime/FrameworkDetector'
import type { Framework } from '../vendor/frameworks/base'
import type { Parser } from '../vendor/parsers/base'
import type { OptionalFeatures } from '../vendor/core/types'
import type { KeyStyle } from '../runtime/types'
import type { ResolvedConfig } from '../runtime/types'

// ---------------------------------------------------------------------------
// normalizeUsageMatchRegex — replicated here (not imported from
// utils/Regex.ts) to avoid a circular dependency: Regex.ts imports Config
// from this module.
// ---------------------------------------------------------------------------
function normalizeUsageMatchRegex(reg: (string | RegExp)[], regexKey: string): RegExp[] {
  return reg
    .map((i) => {
      if (typeof i === 'string') {
        try {
          const interpolated = i.replace(/\{key\}/g, regexKey)
          return new RegExp(interpolated, 'gm')
        }
        catch (e) {
          // eslint-disable-next-line no-console
          console.error(`[shims/core-global] failed to parse custom regex: ${i}`, e)
          return undefined
        }
      }
      return i
    })
    .filter((i): i is RegExp => !!i)
}

export interface RuntimeContext {
  config: ResolvedConfig
}

let ctx: RuntimeContext | undefined
let warnedMissingSourceLanguage = false
let warnedEmptyFrameworks = false
let warnedMissingLocalesPaths = false

/**
 * Install the runtime context backing `Config` / `Global`. Must be called
 * once before any vendored code (src/vendor/**) runs.
 *
 * Returns a `Promise<void>` for backwards compatibility with existing
 * `await installRuntime(ctx)` call sites (previously needed for an async
 * parser warmup; parser resolution is now a synchronous static import, so
 * this resolves immediately — but keeping the async signature means no
 * caller needs to change).
 */
export function installRuntime(context: RuntimeContext): Promise<void> {
  ctx = context
  _usageMatchRegexCache.clear()
  _keysInUse = [...(context.config.keysInUse ?? [])]
  _detectedFrameworksCache = undefined
  warnedMissingSourceLanguage = false
  warnedEmptyFrameworks = false
  warnedMissingLocalesPaths = false
  return Promise.resolve()
}

/** Test-only: reset installed runtime (so tests don't leak state). */
export function _resetRuntimeForTests() {
  ctx = undefined
  _usageMatchRegexCache.clear()
  _keysInUse = []
  _detectedFrameworksCache = undefined
  warnedMissingSourceLanguage = false
  warnedEmptyFrameworks = false
  warnedMissingLocalesPaths = false
}

function requireCtx(name: string): RuntimeContext {
  if (!ctx) {
    throw new Error(
      `[shims/core-global] "${name}" was accessed before installRuntime() was called. `
      + `The runtime must be installed (with a resolved config) before any vendored `
      + `scanning code runs, or scanning would silently no-op.`,
    )
  }
  return ctx
}

// `Config.keysInUse` needs a settable backing store — Analyst.ts writes to
// it (read-modify via spread, never mutates in place, but we mirror upstream's
// mutable-property shape for API compatibility).
let _keysInUse: string[] = []

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Precise shape of the `Config` ACCESS SURFACE as consumed by src/vendor/**
 * (docs/shim-surface.md), typed to match upstream's real
 * `/tmp/i18n-ally/src/core/Config.ts` declarations member-for-member.
 */
export interface ConfigShim {
  readonly _keyStyle: KeyStyle
  readonly defaultNamespace: string | undefined
  readonly disablePathParsing: boolean
  /** Upstream: `string` (non-optional) — normalizeLocale('') falls back to ''. */
  readonly displayLanguage: string
  readonly encoding: string
  readonly extensionPath: string
  readonly extractParserBabelOptions: Record<string, unknown>
  readonly extractParserHTMLOptions: Record<string, unknown>
  readonly frameworksRubyRailsScopeRoot: string
  readonly indent: number
  /** Settable backing store — Analyst.ts writes to it. */
  keysInUse: string[]
  /**
   * Upstream default: `{ ...DEFAULT_LOCALE_COUNTRY_MAP, ...userOverride }`
   * (a sizeable built-in map, used only by `BCP47.toFlagname` for flag-emoji
   * display). Defaults to `{}` here per task direction — this headless CLI
   * never calls `toFlagname`/`getFlagName`, so the built-in map isn't worth
   * vendoring; an empty map just means flag lookups fall through to
   * `language || ''`, which is inert dead code for us either way.
   */
  readonly localeCountryMap: Record<string, string>
  readonly namespace: boolean
  /** Upstream: `getConfig<any>('parserOptions') ?? {}` — intentionally `any`. */
  readonly parserOptions: any
  readonly parsersTypescriptCompilerOption: Record<string, unknown>
  readonly parsersTypescriptTsNodePath: string
  readonly readonly: boolean
  readonly regexKey: string
  /** Upstream: `string` (non-optional) — falls back to displayLanguage, then 'en'. */
  readonly sourceLanguage: string
  readonly tabStyle: 'space' | 'tab'
  readonly translatePromptSource: boolean
  readonly usageScanningIgnore: string[]
}

const configHandlers: Record<string, () => unknown> = {
  _keyStyle: () => requireCtx('Config._keyStyle').config.keystyle,
  defaultNamespace: () => requireCtx('Config.defaultNamespace').config.defaultNamespace,
  disablePathParsing: () => requireCtx('Config.disablePathParsing').config.disablePathParsing,
  displayLanguage: () => {
    // Upstream falls back to '' (not sourceLanguage) at this property; the
    // sourceLanguage->displayLanguage fallback lives on the *sourceLanguage*
    // getter, not here. Mirror that precisely.
    const { config } = requireCtx('Config.displayLanguage')
    return config.displayLanguage ?? ''
  },
  encoding: () => requireCtx('Config.encoding').config.encoding,
  extensionPath: () => requireCtx('Config.extensionPath').config.extensionPath,
  extractParserBabelOptions: () => requireCtx('Config.extractParserBabelOptions').config.extractParserBabelOptions,
  extractParserHTMLOptions: () => requireCtx('Config.extractParserHTMLOptions').config.extractParserHTMLOptions,
  frameworksRubyRailsScopeRoot: () => requireCtx('Config.frameworksRubyRailsScopeRoot').config.frameworksRubyRailsScopeRoot,
  indent: () => requireCtx('Config.indent').config.indent,
  keysInUse: () => _keysInUse,
  localeCountryMap: () => requireCtx('Config.localeCountryMap').config.localeCountryMap,
  namespace: () => requireCtx('Config.namespace').config.namespace,
  parserOptions: () => requireCtx('Config.parserOptions').config.parserOptions ?? {},
  parsersTypescriptCompilerOption: () => requireCtx('Config.parsersTypescriptCompilerOption').config.parsersTypescriptCompilerOption,
  parsersTypescriptTsNodePath: () => requireCtx('Config.parsersTypescriptTsNodePath').config.parsersTypescriptTsNodePath,
  readonly: () => true, // always true: this CLI never writes locale files
  regexKey: () => {
    const { config } = requireCtx('Config.regexKey')
    return config.regexKey ?? (config.disablePathParsing ? '.*?' : '[\\w\\d\\. \\-\\[\\]\\/:]*?')
  },
  sourceLanguage: () => {
    // Upstream: normalizeLocale(sourceLanguage) || displayLanguage || 'en'.
    // `sourceLanguage` is load-bearing for every locale-file write-path and
    // for NodeHelper.isSource(); silently defaulting to 'en' without telling
    // the user is exactly the kind of invisible failure this shim exists to
    // avoid, so we warn once per installRuntime() when we have to fall back.
    const { config } = requireCtx('Config.sourceLanguage')
    if (config.sourceLanguage)
      return config.sourceLanguage
    if (config.displayLanguage)
      return config.displayLanguage
    if (!warnedMissingSourceLanguage) {
      warnedMissingSourceLanguage = true
      // eslint-disable-next-line no-console
      console.warn(
        '[shims/core-global] Config.sourceLanguage is not set (no `sourceLanguage` in any config layer); '
        + 'falling back to "en" to match upstream i18n-ally behavior. Set `sourceLanguage` explicitly to silence this warning.',
      )
    }
    return 'en'
  },
  tabStyle: () => requireCtx('Config.tabStyle').config.tabStyle,
  translatePromptSource: () => requireCtx('Config.translatePromptSource').config.translatePromptSource,
  usageScanningIgnore: () => requireCtx('Config.usageScanningIgnore').config.usage.scanningIgnore,
}

export const Config: ConfigShim = new Proxy({} as ConfigShim, {
  get(_t, prop) {
    if (prop === 'keysInUse') {
      // allow array mutation (`Config.keysInUse.push(...)`-style) by always
      // returning the live backing array
      return _keysInUse
    }
    const handler = configHandlers[prop as string]
    if (!handler)
      throw new Error(`[shims/core-global] "Config.${String(prop)}" is not implemented. See docs/shim-surface.md.`)
    return handler()
  },
  set(_t, prop, value) {
    if (prop === 'keysInUse') {
      _keysInUse = value
      return true
    }
    throw new Error(`[shims/core-global] "Config.${String(prop)}" is read-only in this runtime.`)
  },
})

// ---------------------------------------------------------------------------
// Global
// ---------------------------------------------------------------------------

function getEnabledFrameworksImpl(): Framework[] {
  const { config } = requireCtx('Global.enabledFrameworks')
  let result: Framework[]

  // Explicit `config.frameworks` always wins — users need an escape hatch
  // when auto-detection is wrong (wrong monorepo root, unusual deps, etc).
  if (config.frameworks && config.frameworks.length > 0) {
    result = ALL_FRAMEWORKS.filter(f => config.frameworks!.includes(f.id))
  }
  else {
    // Auto-detection must run ONCE per process (it does real fs work —
    // reading/parsing package.json et al — across possibly multiple
    // monorepo candidate roots), not once per scanned file. Cached for the
    // lifetime of the installed runtime; cleared by installRuntime()/
    // _resetRuntimeForTests() so a fresh `installRuntime` call re-detects
    // against the new config/root.
    if (!_detectedFrameworksCache) {
      _detectedFrameworksCache = detectFrameworks({
        rootpath: config.rootpath,
        localesPaths: config.localesPaths,
      })
    }
    result = _detectedFrameworksCache
  }

  // Silent-degradation audit (BUG 2): an empty framework list is the root
  // cause of several other members silently degrading (getUsageMatchRegex,
  // isLanguageIdSupported, getSupportLangGlob, namespaceEnabled). It's not
  // ALWAYS wrong — e.g. a locale-file-only lint with no source-code usage
  // scanning intended — so we warn once rather than throw here;
  // `getUsageMatchRegex` is the member that actually throws, since that's
  // the point where "found nothing" would otherwise masquerade as a clean
  // scan.
  if (result.length === 0 && !warnedEmptyFrameworks) {
    warnedEmptyFrameworks = true
    // eslint-disable-next-line no-console
    console.warn(
      '[shims/core-global] Global.enabledFrameworks resolved to an empty list: no vendored i18n '
      + `framework was detected under "${config.rootpath}", and no explicit "frameworks" config key `
      + 'was set. Usage-code scanning will find zero keys. If this is unexpected, set `frameworks` '
      + 'explicitly (e.g. `frameworks: ["vue"]`) to bypass auto-detection.',
    )
  }

  return result
}

let _detectedFrameworksCache: Framework[] | undefined

const _usageMatchRegexCache = new Map<string, RegExp[]>()

function getUsageMatchRegexImpl(languageId?: string, filepath?: string): RegExp[] {
  const { config } = requireCtx('Global.getUsageMatchRegex')
  const regexKey = Config.regexKey

  if (config.regexUsageMatch && config.regexUsageMatch.length) {
    const cacheKey = '__custom__'
    if (!_usageMatchRegexCache.has(cacheKey)) {
      const resolved = normalizeUsageMatchRegex(
        [...config.regexUsageMatch, ...config.regexUsageMatchAppend],
        regexKey,
      )
      // Same must-fix guard as below: if every supplied custom regex failed
      // to parse (normalizeUsageMatchRegex drops unparseable patterns), the
      // user's `regex.usageMatch` config is broken, not merely unset — fail
      // loudly rather than scan with zero patterns.
      if (resolved.length === 0) {
        throw new Error(
          '[shims/core-global] "Global.getUsageMatchRegex" resolved to an empty regex list even though '
          + '"regex.usageMatch" was configured — every supplied pattern failed to parse as a RegExp. '
          + 'Check the "regex.usageMatch"/"regex.usageMatchAppend" config keys for invalid patterns.',
        )
      }
      _usageMatchRegexCache.set(cacheKey, resolved)
    }
    return _usageMatchRegexCache.get(cacheKey)!
  }

  const cacheKey = `${languageId}_${filepath}`
  if (!_usageMatchRegexCache.has(cacheKey)) {
    const enabledFrameworks = getEnabledFrameworksImpl()
    const frameworkRegexes: (string | RegExp)[] = enabledFrameworks.flatMap((f) => {
      const r = f.getUsageMatchRegex(languageId, filepath)
      return Array.isArray(r) ? r : [r]
    })
    const resolved = normalizeUsageMatchRegex(
      [...frameworkRegexes, ...config.regexUsageMatchAppend],
      regexKey,
    )

    // BUG 2 must-fix case: an empty usage-match regex list means zero keys
    // will EVER be found by usage-code scanning — the scan would complete,
    // report no missing/idle keys, and look like a clean pass while having
    // scanned nothing. That is strictly worse than failing loudly, so this
    // is one of the few members in this shim that throws instead of
    // returning an empty array (see docs/shim-surface.md audit). Not cached
    // as empty — recomputing (and rethrowing) on every call is the correct
    // behavior here, since there's nothing safe to memoize.
    if (resolved.length === 0) {
      throw new Error(
        `[shims/core-global] "Global.getUsageMatchRegex(${JSON.stringify(languageId)}, ${JSON.stringify(filepath)})" `
        + 'resolved to an empty regex list, which would silently find zero usage keys and report a '
        + `false-clean scan. This happens when no framework is detected/configured (enabledFrameworks `
        + 'is empty) and neither "regex.usageMatch" nor "regex.usageMatchAppend" supplies a pattern. '
        + 'Set `frameworks` explicitly, or provide `regex.usageMatch`/`regex.usageMatchAppend`, to fix '
        + 'this — or, if scanning source code usage is genuinely not wanted for this project, don\'t '
        + 'call usage scanning at all rather than running it against an empty pattern set.',
      )
    }

    _usageMatchRegexCache.set(cacheKey, resolved)
  }
  return _usageMatchRegexCache.get(cacheKey)!
}

function getEnabledParsersImpl(): Parser[] {
  const { config } = requireCtx('Global.enabledParsers')
  const ids = config.enabledParsers?.length ? config.enabledParsers : DefaultEnabledParsers
  const result = AvailableParsers.filter(p => ids.includes(p.id))

  // BUG 1 fix: an empty parser list must NEVER happen silently — it would
  // make every locale-file parse/annotation lookup (and KeyDetector's
  // parser-based paths) quietly do nothing while reporting a clean scan.
  // If this is ever reachable, it means `enabledParsers` in config names IDs
  // that don't exist among the vendored parsers (typo, or a parser that was
  // never vendored) — fail loudly and name the mismatch rather than return
  // `[]`.
  if (result.length === 0) {
    throw new Error(
      `[shims/core-global] "Global.enabledParsers" resolved to an empty list, which would `
      + `silently disable all locale-file parsing. Requested parser id(s): ${JSON.stringify(ids)}. `
      + `Available vendored parsers: ${AvailableParsers.map(p => p.id).join(', ')}. `
      + `Check the "enabledParsers" config key for typos, or unset it to use the defaults `
      + `(${DefaultEnabledParsers.join(', ')}).`,
    )
  }
  return result
}

/**
 * Precise shape of the `Global` ACCESS SURFACE as consumed by src/vendor/**
 * (docs/shim-surface.md), typed to match upstream's real
 * `/tmp/i18n-ally/src/core/Global.ts` declarations member-for-member.
 */
export interface GlobalShim {
  readonly derivedKeyRules: RegExp[]
  readonly enabledFrameworks: Framework[]
  readonly enabledParsers: Parser[]
  readonly rootpath: string
  readonly localesPaths: string[] | undefined
  readonly namespaceEnabled: boolean
  getUsageMatchRegex: (languageId?: string, filepath?: string) => RegExp[]
  getVisibleLocales: (locales: string[]) => string[]
  hasFeatureEnabled: (name: keyof OptionalFeatures) => boolean
  isLanguageIdSupported: (languageId: string) => boolean
  getSupportLangGlob: () => string
  interpretRefactorTemplates: (keypath: string, args?: string[], document?: unknown, detection?: unknown) => string[]
}

const globalHandlers: Record<string, () => unknown> = {
  derivedKeyRules: () => {
    const { config } = requireCtx('Global.derivedKeyRules')
    const rules = config.usage.derivedKeyRules.length
      ? config.usage.derivedKeyRules
      : getEnabledFrameworksImpl().flatMap(f => f.derivedKeyRules || [])
    return [...new Set(rules)].map((rule) => {
      const reg = rule.replace(/\./g, '\\.').replace(/\{key\}/, '(.+)')
      return new RegExp(`^${reg}$`)
    })
  },
  enabledFrameworks: () => getEnabledFrameworksImpl(),
  enabledParsers: () => getEnabledParsersImpl(),
  rootpath: () => requireCtx('Global.rootpath').config.rootpath,
  localesPaths: () => {
    const { config } = requireCtx('Global.localesPaths')
    if (config.localesPaths === undefined && !warnedMissingLocalesPaths) {
      warnedMissingLocalesPaths = true
      // eslint-disable-next-line no-console
      console.warn(
        '[shims/core-global] Global.localesPaths is unset (no `localesPaths` in any config layer). '
        + 'No locale files will be discovered. Set `localesPaths` to your locale directory/directories '
        + '(e.g. `localesPaths: ["locales"]`) to fix this.',
      )
    }
    return config.localesPaths
  },
  namespaceEnabled: () => {
    const { config } = requireCtx('Global.namespaceEnabled')
    return config.namespace || getEnabledFrameworksImpl().some(f => f.enableFeatures?.namespace === true)
  },
}

const globalMethods: Record<string, (...args: any[]) => unknown> = {
  getUsageMatchRegex: (languageId?: string, filepath?: string) => getUsageMatchRegexImpl(languageId, filepath),
  getVisibleLocales: (locales: string[]) => {
    // Upstream: `locales.filter(locale => !ignored.includes(locale))` —
    // non-optional `string[]` return, never undefined.
    const { config } = requireCtx('Global.getVisibleLocales')
    if (!config.ignoredLocales.length)
      return locales
    return locales.filter(l => !config.ignoredLocales.includes(l))
  },
  hasFeatureEnabled: (name: keyof OptionalFeatures) => {
    return getEnabledFrameworksImpl()
      .map(f => f.enableFeatures)
      .filter((f): f is OptionalFeatures => !!f)
      .some(f => !!f[name])
  },
  isLanguageIdSupported: (languageId: string) => {
    return getEnabledFrameworksImpl().flatMap(f => f.languageIds as string[]).includes(languageId)
  },
  getSupportLangGlob: () => {
    const exts = [...new Set(getEnabledFrameworksImpl().flatMap(f => f.languageIds).flatMap(id => getExtOfLanguageId(id)))]
    if (!exts.length)
      return ''
    if (exts.length === 1)
      return `**/*.${exts[0]}`
    return `**/*.{${exts.join(',')}}`
  },
  interpretRefactorTemplates: () => {
    // Only reachable from `utils/prompts.ts` `promptTemplates()`, a
    // write-path/interactive-UI helper never invoked by headless scanning.
    throw new Error('[shims/core-global] "Global.interpretRefactorTemplates" is a write-path/UI-only helper, not implemented for headless scanning.')
  },
}

export const Global: GlobalShim = new Proxy({} as GlobalShim, {
  get(_t, prop) {
    const key = String(prop)
    if (key in globalMethods)
      return globalMethods[key]
    const handler = globalHandlers[key]
    if (!handler)
      throw new Error(`[shims/core-global] "Global.${key}" is not implemented. See docs/shim-surface.md.`)
    return handler()
  },
})
