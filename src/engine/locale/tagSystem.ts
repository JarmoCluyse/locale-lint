// Locale-directory-name classification, backed by the real vendored tag
// systems (`src/vendor/tagSystems/**`) instead of a hand-rolled regex.
//
// Ported from upstream's `Config.tagSystem.lookup(name)`
// (/tmp/i18n-ally/src/core/Config.ts:78-81, selecting from
// `src/tagSystems/{bcp47,legacy,none}.ts` by `i18n-ally.languageTagSystem`,
// default `'bcp47'`) as consumed by `LocaleLoader.guessDirStructure`
// (/tmp/i18n-ally/src/core/loaders/LocaleLoader.ts:118-141:
// `Config.tagSystem.lookup(d)`, truthy/falsy used as "looks like a locale").
//
// DEVIATION (reported, not a silent behavior change): we do NOT call the
// vendored `BCP47.lookup()` method verbatim. That method hardcodes
// `this.normalize(locale)` with its default `fallback = 'en'` baked in, which
// has a real quirk: when a name is too long/malformed to parse as ANY valid
// BCP-47 subtag (e.g. "components", 10 chars, exceeds the grammar's longest
// single-subtag form), `normalize()` doesn't return something falsy — it
// returns the FALLBACK, `'en'`. `lookup()` then happily resolves `'en'` as a
// real locale match, so `tagSystem.lookup('components')` is upstream-truthy
// — a false positive baked into the literal algorithm. We instead call
// `normalize(name, '')` ourselves (explicit empty fallback, not upstream's
// implicit `'en'`) so a parse failure reports as "not a locale" rather than
// masquerading as English. We also wrap the `Intl.*` calls in try/catch:
// upstream's `lookup()` doesn't guard them, and some inputs upstream's own
// `normalize()` happily passes through (e.g. "dist") make
// `Intl.getCanonicalLocales` throw a `RangeError` — unguarded, that would
// crash directory-structure inference entirely. Catching it and treating it
// as "not a locale" is strictly safer and changes no defined (non-crashing)
// classification outcome.
import { TagSystems } from '../../vendor/tagSystems'
import type { ResolvedConfig } from '../../runtime/types'

export type LanguageTagSystem = ResolvedConfig['languageTagSystem']

function getTagSystem(system: LanguageTagSystem) {
  const tagSystem = TagSystems[system]
  if (!tagSystem)
    throw new Error(`[engine/locale/tagSystem] Unknown languageTagSystem "${system}". Valid values: ${Object.keys(TagSystems).join(', ')}.`)
  return tagSystem
}

/**
 * Does `name` look like a real locale code under the given tag system?
 * Mirrors `Config.tagSystem.lookup(name)` being truthy, with the
 * false-positive-on-parse-failure quirk fixed (see module doc comment).
 */
export function looksLikeLocaleCode(name: string, system: LanguageTagSystem = 'bcp47'): boolean {
  const tagSystem = getTagSystem(system)

  // Explicit empty-string fallback (not upstream's implicit 'en' default) —
  // this is the actual fix: a genuine parse failure must report as "not a
  // locale", not silently become English.
  const normalized = tagSystem.normalize(name, '')
  if (!normalized)
    return false

  try {
    const canonical = Intl.getCanonicalLocales(normalized)[0]
    if (!canonical)
      return false
    return !!Intl.Collator.supportedLocalesOf(canonical, { localeMatcher: 'lookup' })[0]
  }
  catch {
    // Malformed tag per ICU (e.g. "dist", "node_modules") — not a locale.
    return false
  }
}
