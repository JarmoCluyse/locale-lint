// ConfigResolver — merges the four config layers (defaults, .vscode/settings.json,
// root config file, CLI flags) into a single frozen ResolvedConfig, with
// provenance tracking per dot-path.
//
// Layer precedence (lowest -> highest): DEFAULTS < vscode < config file < cli.

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import * as jsonc from 'jsonc-parser'
import yaml from 'js-yaml'
import * as toml from 'smol-toml'
import { frameworks as ALL_FRAMEWORKS } from '../vendor/frameworks'
import type {
  ArrayOp,
  LayerName,
  PartialResolvedConfig,
  ResolvedConfig,
} from './types'
import { isArrayOp } from './types'

// ---------------------------------------------------------------------------
// L0 — DEFAULTS
// ---------------------------------------------------------------------------
// Mirrors upstream i18n-ally's `contributes.configuration` defaults
// (package.json @ lokalise/i18n-ally), restricted to the keys this runtime
// actually consumes, plus CLI-only additions (usage/hardString/report/gate
// groups, concurrency, cache) that have no upstream equivalent.
export const DEFAULT_CONFIG: ResolvedConfig = {
  rootpath: process.cwd(),
  localesPaths: undefined,
  pathMatcher: undefined,
  namespace: false,
  dirStructure: undefined,
  encoding: 'utf-8',
  sourceLanguage: undefined,
  displayLanguage: undefined,
  ignoredLocales: [],
  keystyle: 'auto',
  frameworks: undefined,
  languageIdOverrides: {},
  languageTagSystem: 'bcp47', // matches upstream's `i18n-ally.languageTagSystem` default

  disabled: false,
  autoDetection: true,
  disablePathParsing: false,
  defaultNamespace: undefined,
  indent: 2,
  tabStyle: 'space',
  readonly: true, // CLI is always read-only, regardless of upstream default (false)
  keepFulfilled: false,
  translatePromptSource: false,
  keysInUse: [],
  extensionPath: '',
  parsersTypescriptTsNodePath: 'node_modules/ts-node/dist/bin.js',
  parsersTypescriptCompilerOption: {},
  parsersExtendFileExtensions: {},
  parserOptions: undefined,
  localeCountryMap: {},

  frameworksRubyRailsScopeRoot: 'app/views',

  regexKey: undefined,
  regexUsageMatch: undefined,
  regexUsageMatchAppend: [],

  refactorTemplates: [],

  extractParserHTMLOptions: {},
  extractParserBabelOptions: {},

  enabledFrameworks: undefined,
  enabledParsers: undefined,

  usage: {
    scanningIgnore: [],
    derivedKeyRules: [],
    include: undefined,
  },
  hardString: {
    keygenStrategy: 'slug',
    keygenStyle: 'default',
    keyPrefix: '',
    keyMaxLength: undefined,
    targetPickingStrategy: 'none',
    autoDetect: false,
    ignored: [],
    ignoredByFiles: {},
    ignoreGlobs: undefined,
  },
  report: {},
  gate: {},

  concurrency: 4,
  cache: true,
}

// ---------------------------------------------------------------------------
// Dot-path <-> nested object helpers
// ---------------------------------------------------------------------------

function setAtPath(obj: Record<string, any>, dotPath: string, value: unknown) {
  const parts = dotPath.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]
    if (typeof cur[p] !== 'object' || cur[p] === null)
      cur[p] = {}
    cur = cur[p]
  }
  cur[parts[parts.length - 1]] = value
}

/** Flatten a sparse nested object into dot-path => value entries (leaves only). */
function flattenToDotPaths(obj: Record<string, any>, prefix = ''): [string, unknown][] {
  const out: [string, unknown][] = []
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined)
      continue
    const path = prefix ? `${prefix}.${k}` : k
    if (
      v !== null
      && typeof v === 'object'
      && !Array.isArray(v)
      && !isArrayOp(v)
    ) {
      out.push(...flattenToDotPaths(v, path))
    }
    else {
      out.push([path, v])
    }
  }
  return out
}

// Map from our camelCase ResolvedConfig dot-paths — for L1/L2 we accept the
// *exact same* dot-path shape as the VS Code settings keys (after stripping
// the `i18n-ally.` prefix). There is intentionally no translation table.
// We build a PartialResolvedConfig by setting nested keys directly via
// dot-path, matching ResolvedConfig's own nesting (e.g. `usage.scanningIgnore`).

function buildPartialFromFlat(flat: Record<string, unknown>): PartialResolvedConfig {
  const result: Record<string, any> = {}
  for (const [dotPath, value] of Object.entries(flat)) {
    if (value === undefined)
      continue
    setAtPath(result, dotPath, value)
  }
  return result as PartialResolvedConfig
}

// ---------------------------------------------------------------------------
// L1 — .vscode/settings.json
// ---------------------------------------------------------------------------

export function loadVscodeLayer(root: string): PartialResolvedConfig {
  const file = join(root, '.vscode', 'settings.json')
  if (!existsSync(file))
    return {}

  const raw = readFileSync(file, 'utf8')
  const errors: jsonc.ParseError[] = []
  const parsed = jsonc.parse(raw, errors, { allowTrailingComma: true, disallowComments: false }) as Record<string, unknown> | undefined
  if (!parsed)
    return {}

  const flat: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.startsWith('i18n-ally.'))
      continue
    const stripped = key.slice('i18n-ally.'.length)
    flat[stripped] = value
  }

  return buildPartialFromFlat(flat)
}

// ---------------------------------------------------------------------------
// L2 — root config file
// ---------------------------------------------------------------------------

const CONFIG_FILE_CANDIDATES = [
  'locale-lint.config.json',
  'locale-lint.config.yaml',
  'locale-lint.config.yml',
  'locale-lint.config.toml',
]

export function findRootConfigFile(root: string): string | undefined {
  for (const name of CONFIG_FILE_CANDIDATES) {
    const p = join(root, name)
    if (existsSync(p))
      return p
  }
  return undefined
}

function parseConfigFile(path: string): Record<string, unknown> {
  const raw = readFileSync(path, 'utf8')
  if (path.endsWith('.json'))
    return JSON.parse(raw)
  if (path.endsWith('.yaml') || path.endsWith('.yml'))
    return (yaml.load(raw) as Record<string, unknown>) || {}
  if (path.endsWith('.toml'))
    return toml.parse(raw) as Record<string, unknown>
  throw new Error(`[ConfigResolver] Unsupported config file extension: ${path}`)
}

export function loadRootConfigLayer(root: string): PartialResolvedConfig {
  const file = findRootConfigFile(root)
  if (file) {
    const parsed = parseConfigFile(file)
    const flat = flattenToDotPathsPreserveArrayOps(parsed)
    return buildPartialFromFlat(flat)
  }

  // Fallback: `localeLint` key in package.json
  const pkgPath = join(root, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      if (pkg && typeof pkg === 'object' && pkg.localeLint && typeof pkg.localeLint === 'object') {
        const flat = flattenToDotPathsPreserveArrayOps(pkg.localeLint)
        return buildPartialFromFlat(flat)
      }
    }
    catch {
      // ignore malformed package.json; not our concern here
    }
  }

  return {}
}

/**
 * Like flattenToDotPaths, but treats `{ $append: [...] }` / `{ $replace: [...] }`
 * objects as leaf values (not nested objects to recurse into).
 */
function flattenToDotPathsPreserveArrayOps(obj: Record<string, any>, prefix = ''): Record<string, unknown> {
  const entries = flattenToDotPaths(obj, prefix)
  return Object.fromEntries(entries)
}

// ---------------------------------------------------------------------------
// L3 — CLI flags
// ---------------------------------------------------------------------------

export function loadCliLayer(flags: Record<string, unknown>): PartialResolvedConfig {
  // Flat object keyed by the same dot-paths; CLI wiring lane passes argv
  // mapped onto this shape. We just filter out `undefined`s.
  const flat: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(flags)) {
    if (v !== undefined)
      flat[k] = v
  }
  return buildPartialFromFlat(flat)
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

function resolveArrayValue<T>(current: T[] | undefined, incoming: T[] | ArrayOp<T>): T[] {
  if (isArrayOp(incoming)) {
    if ('$append' in incoming)
      return [...(current ?? []), ...incoming.$append]
    return incoming.$replace
  }
  return incoming
}

/** Deep-merge `patch` (sparse) onto `base`, with array-replace-by-default semantics. */
function deepMergeInto(base: Record<string, any>, patch: Record<string, any>, provenance: Map<string, LayerName>, layer: LayerName, prefix = '') {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined)
      continue
    const path = prefix ? `${prefix}.${key}` : key

    if (Array.isArray(value) || isArrayOp(value)) {
      base[key] = resolveArrayValue(base[key], value as any)
      provenance.set(path, layer)
    }
    else if (value !== null && typeof value === 'object') {
      if (typeof base[key] !== 'object' || base[key] === null || Array.isArray(base[key]))
        base[key] = {}
      deepMergeInto(base[key], value, provenance, layer, path)
    }
    else {
      base[key] = value
      provenance.set(path, layer)
    }
  }
}

export interface ResolveConfigOptions {
  /** Explicit root; defaults to process.cwd(). Never read from a config file. */
  root?: string
  cliFlags?: Record<string, unknown>
  /** Skip reading .vscode/settings.json (mainly for tests). */
  skipVscodeLayer?: boolean
  /** Skip reading the root config file (mainly for tests). */
  skipRootConfigLayer?: boolean
}

export interface ResolvedConfigResult {
  config: Readonly<ResolvedConfig>
  provenance: Map<string, LayerName>
}

export function resolveConfig(options: ResolveConfigOptions = {}): ResolvedConfigResult {
  const root = options.root
    ? (isAbsolute(options.root) ? options.root : resolve(process.cwd(), options.root))
    : process.cwd()

  const provenance = new Map<string, LayerName>()

  // Start from a deep-cloned DEFAULTS, tagging every leaf as 'default'.
  const merged: Record<string, any> = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
  for (const [path] of flattenToDotPaths(merged))
    provenance.set(path, 'default')

  const vscodeLayer = options.skipVscodeLayer ? {} : loadVscodeLayer(root)
  deepMergeInto(merged, vscodeLayer as Record<string, any>, provenance, 'vscode')

  const configLayer = options.skipRootConfigLayer ? {} : loadRootConfigLayer(root)
  deepMergeInto(merged, configLayer as Record<string, any>, provenance, 'config')

  const cliLayer = loadCliLayer(options.cliFlags ?? {})
  deepMergeInto(merged, cliLayer as Record<string, any>, provenance, 'cli')

  // rootpath is special: always resolved CWD or explicit --root, never from
  // a config file layer.
  merged.rootpath = root
  provenance.set('rootpath', options.root ? 'cli' : 'default')

  // `hardString.ignoreGlobs` falls back to the final resolved
  // `usage.scanningIgnore` when no layer set it explicitly — so existing
  // configs that only configure the usage-scan ignore list keep identical
  // hard-string-scan behavior. This is a computed default, not a layer
  // value, so it deliberately does NOT get a provenance entry (provenance
  // reflects which *layer* set a value; this value is derived from another
  // key's final resolution instead).
  if (merged.hardString.ignoreGlobs === undefined)
    merged.hardString.ignoreGlobs = merged.usage.scanningIgnore

  // `enabledFrameworks` is the actual upstream vscode setting name
  // (`i18n-ally.enabledFrameworks`) several corpus/real-world configs set —
  // see e.g. `test/conformance/corpus/by-frameworks/php-po/.vscode/settings.json`.
  // The shim (`src/shims/core-global.ts`'s `getEnabledFrameworksImpl`) reads
  // `config.frameworks`, not `config.enabledFrameworks` (a distinct field
  // that otherwise goes completely unread). Bridge the two here — explicit
  // `frameworks` (however it was set, e.g. directly via a non-vscode config
  // layer or CLI flag) still wins if both are set; this only fills
  // `frameworks` in when it's empty, so `enabledFrameworks` acts as an alias
  // rather than a silent override.
  //
  // Guarded by "every requested id is a real vendored framework id": some
  // real-world (and one corpus — `by-features/custom-scope-range`) configs
  // set `enabledFrameworks` to upstream-UI-only labels that aren't actual
  // framework ids (e.g. `"react"`, `"i18next"` instead of `"react-i18next"`).
  // Bridging unconditionally would silently narrow `frameworks` down to
  // just the subset that DOES match a real id (here, just `"custom"`),
  // discarding the correctly auto-detected `react-i18next` framework and
  // regressing that project's usage-scan results. If any requested id is
  // unrecognised, skip the bridge entirely and let auto-detection run
  // instead — the same "don't silently do something worse than before"
  // principle the rest of this shim/config layer follows throughout.
  if ((!merged.frameworks || merged.frameworks.length === 0) && merged.enabledFrameworks && merged.enabledFrameworks.length) {
    const knownFrameworkIds = new Set(ALL_FRAMEWORKS.map(f => f.id))
    const allKnown = (merged.enabledFrameworks as string[]).every(id => knownFrameworkIds.has(id))
    if (allKnown) {
      merged.frameworks = merged.enabledFrameworks
      const sourceLayer = provenance.get('enabledFrameworks')
      if (sourceLayer)
        provenance.set('frameworks', sourceLayer)
    }
  }

  const config = Object.freeze(merged) as ResolvedConfig
  return { config, provenance }
}
