// Pure single-file locale parse step: `(relPath, text, parser, config) =>
// value`. Kept pure and file-granular (no directory scanning / caching
// state) specifically so `LocaleStore.reloadFile()` can call this exact same
// function for a single changed file — this is the seam a future LSP server
// needs for incremental reload.
import { unflatten } from '../../vendor/utils/flat'
import type { Parser } from '../../vendor/parsers/base'

export interface ParseLocaleFileOptions {
  disablePathParsing: boolean
}

/**
 * Parse one locale file's raw text into its (possibly unflattened) object
 * value. Throws on parse failure — callers are responsible for catching and
 * turning that into a `Diagnostic` rather than crashing the run (see
 * `LocaleStore.loadFile`).
 */
export async function parseLocaleFile(text: string, parser: Parser, options: ParseLocaleFileOptions): Promise<object> {
  const data = await parser.parse(text)
  return options.disablePathParsing ? data : unflatten(data)
}
