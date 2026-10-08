// Per-file usage scan: drives the vendored (now-pure) `Analyst` statics to
// find key occurrences in source text, plus the dynamic-key heuristic scan.
//
// PURITY NOTE (same non-negotiable constraint as HardStringScanner.scanFile):
// this is a function of `(relPath, text, config)` with NO per-call mutable
// state of ITS OWN. It does not consult `LocaleStore` at all — key-existence
// resolution (does this key exist? in which locales?) happens later, on the
// main thread, during aggregation (`aggregate.ts`). That split is what makes
// worker_threads fan-out possible: a worker only ever needs
// `(path, text, config)` to produce occurrences; it never needs the locale
// tree.
//
// CAVEAT (vendor-bounded, not introduced by us): `Analyst.getOccurrencesOfText`
// -> `KeyDetector.getKeys` depends on three pieces of *installed runtime*
// state that are themselves pure functions of `config` (not of any individual
// file): `Config`/`Global` (installed once via `installRuntime(config)`) and
// `CurrentFile.loader.rewriteKeys` (forwards to `Global.enabledFrameworks`'
// `rewriteKeys`, which is config/framework-level logic — it does NOT touch
// locale-tree data, so assigning `CurrentFile.loader` before the tree is even
// `.load()`ed is safe and is exactly what `UsageScanner` does). So: same
// (path, text, config) + the one-time-per-run installed context always
// yields the same result — deterministic and safe to call from many workers
// that each install the same config once at startup.
//
// SEPARATE VENDOR WRINKLE: `KeyDetector` keeps a private, module-level
// `_get_keys_cache: Map<filepath, KeyInDocument[]>` keyed by
// `document.uri.fsPath`, with no invalidation. That's real mutable state we
// did NOT introduce, but which would make a hypothetical "rescan this file
// after it changed" (LSP `didChange`) return STALE results if the same path
// were ever scanned twice with different content. We neutralize it
// defensively below (`clearKeyDetectorCacheFor`) immediately after each call,
// via a documented reach-around into the vendored private field (TypeScript
// `private` is compile-time only) — this keeps our own contract ("same path
// + fresh text always re-scanned") honest without touching
// `src/vendor/**`.
import { Analyst } from '../../vendor/core'
import { KeyDetector } from '../../vendor/core/KeyDetector'
import { TextDocument, languageIdFromPath } from '../../shims/vscode'
import { detectDynamicKeyUsages } from './dynamicKeys'
import type { FileUsageScanResult, KeyOccurrence } from './types'

function clearKeyDetectorCacheFor(filepath: string): void {
  const cache = (KeyDetector as unknown as { _get_keys_cache?: Map<string, unknown> })._get_keys_cache
  cache?.delete(filepath)
}

export interface UsageScanOptions {
  languageId?: string
}

/**
 * Scan one file's text for key usages + dynamic-key call shapes. Requires
 * `installRuntime(config)` and `CurrentFile.loader = <any Loader>` to have
 * already been called once for this run (see module doc comment) — it does
 * NOT itself touch the locale tree.
 */
export async function scanFileForUsages(relPath: string, text: string, options: UsageScanOptions = {}): Promise<FileUsageScanResult> {
  const languageId = options.languageId ?? languageIdFromPath(relPath)
  const document = TextDocument.fromFile(relPath, text, languageId)

  let occurrences: KeyOccurrence[]
  try {
    const raw = await Analyst.getOccurrencesOfFile(document)
    occurrences = raw.map(o => ({
      key: Analyst.normalizeKey(o.keypath),
      file: relPath,
      ...offsetsToPositions(document, o.start, o.end),
    }))
  }
  finally {
    clearKeyDetectorCacheFor(relPath)
  }

  const dynamicKeyUsages = detectDynamicKeyUsages(relPath, text)

  return { occurrences, dynamicKeyUsages }
}

function offsetsToPositions(document: TextDocument, start: number, end: number) {
  const startPos = document.positionAt(start)
  const endPos = document.positionAt(end)
  return {
    line: startPos.line + 1,
    column: startPos.character + 1,
    endLine: endPos.line + 1,
    endColumn: endPos.character + 1,
  }
}
