// Aggregation: turns raw per-file key occurrences into missing/unused/coverage
// buckets, by consulting the (already-loaded) `LocaleStore`. This is the ONE
// place in the usage-scan pipeline allowed to touch the locale tree — see
// `scanFile.ts`'s purity note for why that separation matters.
//
// The active/missing/idle(unused) SET computation below ports upstream's
// `Analyst.analyzeUsage` (/tmp/i18n-ally/src/core/Analyst.ts:118-175, not
// vendored — stripped down to the 3 pure statics per this lane's brief), most
// notably its two `derivedKeyRules` passes:
//   1. a derived key (e.g. `errors.notFound_plural`) is NOT unused if its
//      *source* key (`errors.notFound`) is actively used in code.
//   2. if a derived key's source key is itself "missing" (used in code, but
//      genuinely absent from the locale tree), the SOURCE key is promoted to
//      "active" (not "missing") and the derived key is removed from
//      "unused" — this is the nested-pluralization-via-flat-suffix
//      convention upstream supports alongside the (separately, already
//      vendored in `Loader`) nested-object pluralization convention.
//
// `Config.keysInUse` (a glob-pattern allow-list, despite the confusing name —
// see shims/core-global.ts) is upstream's existing mechanism for "treat code
// matching this glob as using these keys, even though the scanner can't see
// it" — this IS the `usage.ignoreKeys`-glob feature requested for dynamic
// keys; see UsageScanner.ts's doc comment for why we reuse it instead of
// adding a new `ResolvedConfig` field.
import micromatch from 'micromatch'
import { relative } from 'node:path'
import { Global } from '../../shims/core-global'
import type { LocaleStore } from '../LocaleStore'
import type { CoverageEntry, KeyOccurrence, MissingKeyEntry, UnusedKeyEntry } from './types'

function toRelative(root: string, absPath: string): string {
  return relative(root, absPath).split('\\').join('/')
}

function compareOccurrence(a: KeyOccurrence, b: KeyOccurrence): number {
  if (a.file !== b.file)
    return a.file < b.file ? -1 : 1
  if (a.line !== b.line)
    return a.line - b.line
  return a.column - b.column
}

export interface AggregateUsageOptions {
  /** Glob patterns of keys to always treat as "in use" (default: `Config.keysInUse`). */
  keysInUse?: string[]
  /** Rootpath, used to relativize locale-file paths in `unused[].file`. */
  rootpath: string
}

export interface AggregatedUsage {
  missing: MissingKeyEntry[]
  unused: UnusedKeyEntry[]
  coverage: CoverageEntry[]
  overallCoverage: number
  usedKeyCount: number
}

export function aggregateUsage(
  store: LocaleStore,
  occurrences: KeyOccurrence[],
  options: AggregateUsageOptions,
): AggregatedUsage {
  const keysInUseGlobs = options.keysInUse ?? []

  // --- occurrence grouping (by normalized key) -----------------------------
  const occurrencesByKey = new Map<string, KeyOccurrence[]>()
  for (const occ of occurrences) {
    if (!occurrencesByKey.has(occ.key))
      occurrencesByKey.set(occ.key, [])
    occurrencesByKey.get(occ.key)!.push(occ)
  }

  const allKeys = [...new Set(store.keys)].sort()
  const allKeysSet = new Set(allKeys)

  const inUseKeys = [...new Set([...occurrencesByKey.keys(), ...keysInUseGlobs])]
  const inUseKeysSet = new Set(inUseKeys)

  const activeKeys = new Set(inUseKeys.filter(k => allKeysSet.has(k)))
  let missingKeys = inUseKeys.filter(k => !allKeysSet.has(k))

  let idleKeys = allKeys
    .filter(k => !inUseKeysSet.has(k))
    .filter(k => !keysInUseGlobs.length || !micromatch.isMatch(k, keysInUseGlobs))

  const rules = Global.derivedKeyRules

  // Pass 1: a derived key is not idle if its source key is active.
  idleKeys = idleKeys.filter((key) => {
    for (const r of rules) {
      const match = r.exec(key)
      if (match?.[1] && activeKeys.has(match[1]))
        return false
    }
    return true
  })

  // Pass 2: if a derived key's source key is "missing", promote the source
  // key to active, drop it from missing, and drop the derived key from idle.
  const missingKeysSet = new Set(missingKeys)
  const promoted = new Set<string>()
  idleKeys = idleKeys.filter((key) => {
    for (const r of rules) {
      const match = r.exec(key)
      if (match?.[1] && missingKeysSet.has(match[1])) {
        promoted.add(match[1])
        return false
      }
    }
    return true
  })
  for (const key of promoted) {
    activeKeys.add(key)
    missingKeysSet.delete(key)
  }
  missingKeys = [...missingKeysSet]

  // --- unused (global, not per-locale) ------------------------------------
  const sourceLocale = store.locales[0]
  const unused: UnusedKeyEntry[] = idleKeys.sort().map((key) => {
    const node = store.getNodeByKey(key, false)
    const locales = node ? Object.keys(node.locales).sort() : []
    const representativeAbs = (sourceLocale && node?.locales[sourceLocale]?.filepath)
      || locales.map(l => node?.locales[l]?.filepath).find(Boolean)
      || ''
    const representative = representativeAbs ? toRelative(options.rootpath, representativeAbs) : ''
    return { key, locales, file: representative }
  })

  // --- missing (per-locale) ------------------------------------------------
  // Feed the full "effective in-use" key set (active + still-missing) to
  // `Loader.getCoverage`, per locale — its `missingKeys` bucket naturally
  // covers BOTH "key doesn't exist anywhere" and "key exists but this locale
  // lacks a value", which is exactly the per-locale semantics requested.
  const effectiveUsedKeys = [...new Set([...activeKeys, ...missingKeys])].sort()
  const missing: MissingKeyEntry[] = []
  for (const locale of store.locales) {
    const coverage = store.getCoverage(locale, effectiveUsedKeys)
    for (const key of coverage?.missingKeys ?? []) {
      const occs = (occurrencesByKey.get(key) ?? []).slice().sort(compareOccurrence)
      const first = occs[0]
      missing.push({
        key,
        locale,
        file: first?.file ?? '',
        line: first?.line ?? 0,
        column: first?.column ?? 0,
        occurrenceCount: occs.length,
      })
    }
  }
  missing.sort((a, b) => (a.key !== b.key ? (a.key < b.key ? -1 : 1) : (a.locale < b.locale ? -1 : a.locale > b.locale ? 1 : 0)))

  // --- coverage -------------------------------------------------------------
  const coverage: CoverageEntry[] = store.locales.map((locale) => {
    const cov = store.getCoverage(locale)
    const total = cov?.total ?? 0
    const translated = cov?.translated ?? 0
    return {
      locale,
      total,
      translated,
      missing: cov?.missing ?? 0,
      percentage: total === 0 ? 100 : round2((translated / total) * 100),
    }
  })

  const totalAll = coverage.reduce((sum, c) => sum + c.total, 0)
  const translatedAll = coverage.reduce((sum, c) => sum + c.translated, 0)
  const overallCoverage = totalAll === 0 ? 100 : round2((translatedAll / totalAll) * 100)

  return { missing, unused, coverage, overallCoverage, usedKeyCount: effectiveUsedKeys.length }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
