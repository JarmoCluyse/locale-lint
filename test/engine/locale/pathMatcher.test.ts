import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPathMatchers, guessDirStructureFromDirnames, looksLikeLocaleCode } from '../../../src/engine/locale/pathMatcher'
import { listSubdirNames } from '../../../src/engine/locale/discover'

const FIXTURES = join(__dirname, '..', '..', 'fixtures', 'locales')

describe('looksLikeLocaleCode', () => {
  it('accepts common locale code shapes', () => {
    expect(looksLikeLocaleCode('en')).toBe(true)
    expect(looksLikeLocaleCode('en-US')).toBe(true)
    expect(looksLikeLocaleCode('en_US')).toBe(true)
    expect(looksLikeLocaleCode('zh-cn')).toBe(true)
    expect(looksLikeLocaleCode('pt-BR')).toBe(true)
  })

  it('rejects names that are not locale-code-shaped', () => {
    expect(looksLikeLocaleCode('components')).toBe(false)
    expect(looksLikeLocaleCode('src')).toBe(false)
    expect(looksLikeLocaleCode('node_modules')).toBe(false)
  })

  // Regression cases for the bugs the hand-rolled regex had (P5b):
  // false negatives on multi-subtag BCP-47 tags, false positives on
  // 2-letter-prefixed kebab-case directory names.
  it('accepts multi-subtag BCP-47 codes the old regex rejected (false negatives)', () => {
    expect(looksLikeLocaleCode('sr-Latn-RS')).toBe(true) // language-script-region
    expect(looksLikeLocaleCode('zh-Hans')).toBe(true) // language-script
    expect(looksLikeLocaleCode('zh-Hant-TW')).toBe(true) // language-script-region
    expect(looksLikeLocaleCode('pt-BR')).toBe(true) // language-region (already passed, kept for the matrix)
  })

  it('rejects 2-letter-prefixed kebab-case directories the old regex accepted (false positives)', () => {
    expect(looksLikeLocaleCode('db-config')).toBe(false)
    expect(looksLikeLocaleCode('ui-utils')).toBe(false)
  })

  it('rejects common non-locale project directories', () => {
    expect(looksLikeLocaleCode('src')).toBe(false)
    expect(looksLikeLocaleCode('node_modules')).toBe(false)
    expect(looksLikeLocaleCode('dist')).toBe(false)
  })

  it('does not crash on malformed/overlong names that make Intl throw (upstream is unguarded here)', () => {
    expect(() => looksLikeLocaleCode('dist')).not.toThrow()
    expect(() => looksLikeLocaleCode('node_modules')).not.toThrow()
    expect(() => looksLikeLocaleCode('this-is-a-very-long-not-a-locale-name')).not.toThrow()
  })

  it('supports the "legacy" and "none" tag systems too', () => {
    // legacy: inherited BaseTagSystem.lookup is unused directly — legacy's
    // own normalize() is Intl-based with a strict 2-letter-prefix check.
    expect(looksLikeLocaleCode('pt-BR', 'legacy')).toBe(true)
    // none: BCP47 with a no-op normalize (passthrough) — still goes through
    // the Intl lookup on the raw string.
    expect(looksLikeLocaleCode('pt-BR', 'none')).toBe(true)
    expect(looksLikeLocaleCode('db-config', 'none')).toBe(false)
  })

  it('throws a clear error for an unknown tag system name', () => {
    expect(() => looksLikeLocaleCode('en', 'made-up' as any)).toThrow(/Unknown languageTagSystem/)
  })
})

describe('guessDirStructureFromDirnames', () => {
  it('infers "dir" when >=60% of subdirs look like locale codes', () => {
    expect(guessDirStructureFromDirnames(['en', 'fr', 'de'])).toBe('dir')
    expect(guessDirStructureFromDirnames(['en', 'fr', 'utils'])).toBe('dir') // 2/3 = 0.667
  })

  it('infers "file" when below the threshold, or no subdirs at all', () => {
    expect(guessDirStructureFromDirnames([])).toBe('file')
    expect(guessDirStructureFromDirnames(['components', 'utils', 'en'])).toBe('file') // 1/3
  })

  it('infers correctly on a multi-subtag locale among kebab-case decoys (old regex got this backwards)', () => {
    // Old regex: sr-Latn-RS false (no multi-segment support, false negative),
    // db-config/ui-utils both true (kebab-case false positive) => 2/3 = 0.667
    // => 'dir' (WRONG — the one real locale dir was undercounted while two
    // decoys were overcounted).
    // New (real tag system): sr-Latn-RS true, db-config/ui-utils both false
    // => 1/3 = 0.333 => 'file' (correct).
    expect(guessDirStructureFromDirnames(['sr-Latn-RS', 'db-config', 'ui-utils'])).toBe('file')
  })

  it('infers correctly on a real fixture directory containing both real locale dirs and a decoy', async () => {
    // test/fixtures/locales/mixed-with-decoy/: en/, fr/ (real locales),
    // db-config/, ui-utils/, utils/ (decoys that the old regex
    // misclassified: db-config/ui-utils were false-positive "locale-shaped",
    // only "utils" alone was correctly rejected by both implementations).
    // 2 real / 5 total = 0.4 < 0.6 => 'file' is the correct call; the old
    // regex's false positives on db-config/ui-utils would have inflated this
    // to 4/5 = 0.8 => 'dir' (wrong).
    const dirnames = await listSubdirNames(join(FIXTURES, 'mixed-with-decoy'))
    expect(new Set(dirnames)).toEqual(new Set(['en', 'fr', 'db-config', 'ui-utils', 'utils']))
    expect(guessDirStructureFromDirnames(dirnames)).toBe('file')
  })
})

describe('buildPathMatchers', () => {
  it('uses the file-structure default pattern', () => {
    const matchers = buildPathMatchers({ pathMatcher: undefined, namespace: false, dirStructure: 'file', enabledParserExts: 'json|yaml|yml' })
    expect(matchers).toHaveLength(1)
    expect(matchers[0].matcher).toBe('{locale}.{ext}')
    expect(matchers[0].regex.exec('en.json')?.groups?.locale).toBe('en')
  })

  it('uses the dir-structure default pattern', () => {
    const matchers = buildPathMatchers({ pathMatcher: undefined, namespace: false, dirStructure: 'dir', enabledParserExts: 'json' })
    const match = matchers[0].regex.exec('en/a.json')
    expect(match?.groups?.locale).toBe('en')
  })

  it('uses the namespaced dir-structure default pattern (single path segment)', () => {
    const matchers = buildPathMatchers({ pathMatcher: undefined, namespace: true, dirStructure: 'dir', enabledParserExts: 'yml' })
    const match = matchers[0].regex.exec('en/foo/bar.yml')
    expect(match?.groups?.locale).toBe('en')
    // default `{namespace}` (singular) only captures the final path segment —
    // nested namespace paths need an explicit `pathMatcher` override with
    // `{namespaces}` (plural), covered by the "honours an explicit
    // pathMatcher override" case below.
    expect(match?.groups?.namespace).toBe('bar')
  })

  it('honours an explicit pathMatcher override', () => {
    const matchers = buildPathMatchers({ pathMatcher: '{locale}/{namespaces}.(yml|json)', namespace: true, dirStructure: 'dir', enabledParserExts: '' })
    expect(matchers).toHaveLength(1)
    expect(matchers[0].matcher).toBe('{locale}/{namespaces}.(yml|json)')
    const match = matchers[0].regex.exec('en/general.yml')
    expect(match?.groups?.locale).toBe('en')
    expect(match?.groups?.namespace).toBe('general')
  })
})
