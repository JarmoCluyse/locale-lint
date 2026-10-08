// SourceGlob — derives the file-enumeration glob pattern(s) for the
// scanners from the DETECTED/CONFIGURED frameworks' declared `languageIds`,
// instead of the previous hardcoded JS/TS/Vue/Svelte-only default.
//
// Why this exists: `src/vendor/frameworks/**` ships framework definitions
// (languageIds, usageMatchRegex, locale-file parsers) for ~33 frameworks,
// including several whose source files are not JS/TS at all (Laravel/PHP,
// Ruby on Rails, Flutter/Dart, Ember/Handlebars, PHP-gettext). Framework
// *detection* (`FrameworkDetector.ts`) correctly identifies these projects,
// but the file enumerator was never told to look for `.php`/`.rb`/`.dart`/
// `.hbs` files, so detection succeeded and then scanning found nothing
// (`EXIT_NO_FILES_MATCHED`). This module closes that gap.
//
// We evaluated reusing `Global.getSupportLangGlob()` (`src/shims/core-global.ts`)
// — it already exists and is wired to `getExtOfLanguageId`
// (`src/vendor/utils/LanguageId.ts`) — but it's inadequate for file
// *discovery* for one framework: `blade` maps to extension `php` there
// (correct for upstream's "what annotation language is this document"
// use-case, where the document's languageId is already known to be
// `blade`), which would under-glob `.blade.php` files if `.blade.php` were
// NOT already a strict suffix-superset of `.php` — it happens to still
// match via `**/*.php`, but relying on that coincidence is fragile, and
// `handlebars` isn't in that map's extension output in a glob-safe way
// either path (`getExtOfLanguageId('handlebars')` → `'hbs'`, which IS fine,
// actually — the real inadequacy is that `Global.getSupportLangGlob` throws
// if `installRuntime()` hasn't been called, which the hard-string scanner
// deliberately avoids for purity reasons — see `FileEnumerator.ts`'s module
// doc comment). So: a local, dependency-free mapping here, callable by both
// scanners without requiring the shim runtime to be installed.
import { frameworks as ALL_FRAMEWORKS } from '../vendor/frameworks'
import type { Framework } from '../vendor/frameworks/base'
import { getLogLevel, setLogLevel } from '../shims/vscode'
import { detectFrameworks } from './FrameworkDetector'
import type { ResolvedConfig } from './types'

/**
 * Extensions always scanned, regardless of detected frameworks — the
 * pre-existing JS/TS/Vue/Svelte-centric default. Always union'd into the
 * final pattern, never removed, so no currently-working JS/TS project can
 * regress from this change.
 */
export const DEFAULT_SOURCE_EXTENSIONS = ['js', 'jsx', 'ts', 'tsx', 'vue', 'html', 'svelte']

/**
 * Maps a vendored Framework's `languageIds` entries to on-disk file
 * extensions for GLOB DISCOVERY purposes. Deliberately a separate table
 * from `src/vendor/utils/LanguageId.ts`'s `LanguageIdExtMap` (used for
 * annotation-language bookkeeping) because the two tables answer different
 * questions: that one answers "what's the canonical save-extension for a
 * language I already know", this one answers "what file extension(s) on
 * disk could contain a file belonging to this framework at all" — which for
 * `blade` needs the compound `blade.php` suffix (not bare `php`) and for
 * `handlebars` needs `hbs` (which also happens to agree with the vendored
 * map, kept here explicitly for completeness/independence from vendor).
 */
const LANGUAGE_ID_TO_GLOB_EXT: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  javascriptreact: 'jsx',
  typescriptreact: 'tsx',
  vue: 'vue',
  'vue-html': 'vue',
  json: 'json',
  html: 'html',
  dart: 'dart',
  php: 'php',
  blade: 'blade.php',
  ejs: 'ejs',
  ruby: 'rb',
  erb: 'erb',
  'html.erb': 'erb',
  'js.erb': 'erb',
  haml: 'haml',
  slim: 'slim',
  handlebars: 'hbs',
  svelte: 'svelte',
  xml: 'xml',
}

function resolveFrameworks(config: Pick<ResolvedConfig, 'frameworks' | 'rootpath' | 'localesPaths'>): Framework[] {
  // Mirrors `Global.enabledFrameworks`'s own precedence (explicit
  // `config.frameworks` always wins over auto-detection) — see
  // `src/shims/core-global.ts`'s `getEnabledFrameworksImpl`. Reimplemented
  // here (not imported) so this stays callable without `installRuntime()`.
  if (config.frameworks && config.frameworks.length > 0)
    return ALL_FRAMEWORKS.filter(f => config.frameworks!.includes(f.id))

  // `detectFrameworks` is documented (`FrameworkDetector.ts`) as pure/
  // shim-free, and mostly is — EXCEPT the vendored `getEnabledFrameworks`
  // it delegates to also evaluates the `custom` framework's declarative
  // detection, which (for a project with a
  // `.vscode/i18n-ally-custom-framework.yml`) calls `CustomFramework.load()`
  // -> `File.readSync()` -> `Config.encoding`, i.e. it reaches into the
  // `Config` shim after all. The hard-string scanner deliberately never
  // calls `installRuntime()` (see `FileEnumerator.ts`'s module doc comment),
  // so that access throws there — vendored code catches that exception
  // itself (`getEnabledFrameworks`'s own try/catch) and logs it via
  // `Log.error`, so the detection call itself does NOT crash the scan, but
  // it DOES emit noisy, irrelevant "Config.encoding accessed before
  // installRuntime()" diagnostics to stderr on every hard-string run of such
  // a project — a behavior that didn't exist before this module started
  // calling `detectFrameworks` from the pure hard-string path. Silence the
  // shim's log output for the duration of this call only (restored
  // immediately after) — the error is already handled by vendored code;
  // this only suppresses it from leaking into a scan that doesn't care
  // about framework-detection diagnostics at all.
  const previousLogLevel = getLogLevel()
  setLogLevel('silent')
  try {
    return detectFrameworks({ rootpath: config.rootpath, localesPaths: config.localesPaths })
  }
  catch {
    return []
  }
  finally {
    setLogLevel(previousLogLevel)
  }
}

/**
 * Build the fast-glob include pattern(s) for source-file enumeration: the
 * union of `DEFAULT_SOURCE_EXTENSIONS` and whatever extensions the
 * detected/configured frameworks declare via `languageIds`. A project with
 * no detected framework (and no explicit `frameworks` config) falls back to
 * exactly the old default — this function never returns an empty/narrower
 * pattern than that.
 */
export function computeSourcePatterns(config: Pick<ResolvedConfig, 'frameworks' | 'rootpath' | 'localesPaths'>): string[] {
  const frameworks = resolveFrameworks(config)

  const exts = new Set<string>(DEFAULT_SOURCE_EXTENSIONS)
  for (const framework of frameworks) {
    for (const languageId of framework.languageIds) {
      const ext = LANGUAGE_ID_TO_GLOB_EXT[languageId as string]
      if (ext)
        exts.add(ext)
    }
  }

  // Sorted for determinism (golden-snapshot stability across machines).
  const sorted = [...exts].sort()
  return [`**/*.{${sorted.join(',')}}`]
}
