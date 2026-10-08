// Path-matcher construction + dirStructure inference, ported (with
// simplifications noted below) from upstream lokalise/i18n-ally — MIT.
// See NOTICE.
//
// Ported from:
//   - /tmp/i18n-ally/src/core/Global.ts:211-231 (`dirStructure` getter,
//     `getPathMatchers`)
//   - /tmp/i18n-ally/src/core/loaders/LocaleLoader.ts:118-141
//     (`guessDirStructure`)
//
// `guessDirStructure`'s "does this directory name look like a locale code"
// check now uses the real vendored tag systems (`src/vendor/tagSystems/**`,
// vendored for this purpose) via `./tagSystem`'s `looksLikeLocaleCode` —
// see that module's doc comment for the one deliberate deviation from
// upstream's literal `tagSystem.lookup()` (a parse-failure-masquerades-as-
// 'en' quirk we fix rather than reproduce).
import { ParsePathMatcher } from '../../vendor/utils/PathMatcher'
import type { DirStructure } from '../../runtime/types'
import { looksLikeLocaleCode } from './tagSystem'
import type { LanguageTagSystem } from './tagSystem'

export { ParsePathMatcher, looksLikeLocaleCode }

/**
 * Upstream `guessDirStructure` (LocaleLoader.ts:118-141): sample immediate
 * subdirectories of the first locales dir; if >=60% look like locale codes,
 * infer `dir` structure (one directory per locale), else `file` (one file
 * per locale).
 */
const POSITIVE_RATE = 0.6

export function guessDirStructureFromDirnames(dirnames: string[], languageTagSystem: LanguageTagSystem = 'bcp47'): DirStructure {
  const total = dirnames.length
  if (total === 0)
    return 'file'

  const positive = dirnames.filter(d => looksLikeLocaleCode(d, languageTagSystem)).length
  return (positive / total) >= POSITIVE_RATE ? 'dir' : 'file'
}

export interface PathMatcherEntry {
  regex: RegExp
  matcher: string
}

/**
 * Upstream `Global.getPathMatchers` (Global.ts:222-231): build the candidate
 * matcher pattern list (either the user's explicit override, or framework
 * defaults) and compile each via the vendored `ParsePathMatcher`.
 *
 * SIMPLIFICATION: upstream derives the framework-default pattern list from
 * `enabledFrameworks.flatMap(f => f.pathMatcher(dirStructure))`. Framework
 * auto-detection is owned by a different lane (FrameworkDetector, in
 * progress) and `Global.enabledFrameworks` only resolves frameworks from an
 * explicit `config.frameworks` list today (see `shims/core-global.ts`). We
 * replicate the same *default* pattern shapes `Framework.pathMatcher()`
 * produces (`src/vendor/frameworks/base.ts:66-73`) directly, parameterised
 * by `namespace`/`dirStructure`, so locale discovery works independently of
 * framework detection landing.
 */
export function buildPathMatchers(options: {
  pathMatcher: string | undefined
  namespace: boolean
  dirStructure: DirStructure
  enabledParserExts: string
}): PathMatcherEntry[] {
  const patterns = options.pathMatcher
    ? [options.pathMatcher]
    : [defaultPathMatcher(options.dirStructure, options.namespace)]

  return [...new Set(patterns)].map(matcher => ({
    matcher,
    regex: ParsePathMatcher(matcher, options.enabledParserExts),
  }))
}

/** Mirrors `Framework.pathMatcher()` default (src/vendor/frameworks/base.ts). */
function defaultPathMatcher(dirStructure: DirStructure, namespace: boolean): string {
  if (dirStructure === 'file')
    return '{locale}.{ext}'
  if (namespace)
    return '{locale}/**/{namespace}.{ext}'
  return '{locale}/**/*.{ext}'
}
