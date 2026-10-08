// HardStringScanner — pure per-file hard-coded-string scan.
//
// ARCHITECTURAL CONSTRAINT (do not regress): `scanFile` must be a pure
// function of `(path, text, config)` with NO module-level mutable state. This
// is required for future worker_threads parallelism (each worker just needs
// the file path/text/config, no shared singleton) and for a future LSP
// server that rescans a single document on didChange without re-running
// `installRuntime()`. Accordingly, this module does NOT call
// `installRuntime()` / read `Config` / `Global` from `shims/core-global` —
// the vendored extraction parsers (`src/vendor/extraction/**`) already take
// their options as plain function arguments, so we can drive them directly
// from `ResolvedConfig` without needing the global shim at all.
import { TextDocument, languageIdFromPath } from '../shims/vscode'
import {
  DefaultDynamicExtractionsRules,
  DefaultExtractionRules,
  extractionsParsers,
} from '../vendor/extraction'
import type { DetectionResult } from '../vendor/core/types'
import type { ResolvedConfig } from '../runtime/types'
import type { HardStringFinding } from './types'

/** Language ids handled via the HTML parser (HTML-like markup + <script>). */
const HTML_LIKE_LANGUAGE_IDS = new Set(['vue', 'vue-html', 'html', 'svelte'])

/** Language ids handled directly via the babel parser. */
const BABEL_LANGUAGE_IDS = new Set([
  'javascript',
  'typescript',
  'javascriptreact',
  'typescriptreact',
])

export interface HardStringScanOptions {
  languageId?: string
}

/**
 * Scan a single file's text for hard-coded (untranslated) strings. Pure: same
 * inputs always produce the same outputs, no shared state, safe to call
 * concurrently / from a worker thread.
 */
export function scanFile(
  relPath: string,
  text: string,
  config: Pick<ResolvedConfig, 'extractParserBabelOptions' | 'extractParserHTMLOptions' | 'hardString'>,
  options: HardStringScanOptions = {},
): HardStringFinding[] {
  const languageId = options.languageId ?? languageIdFromPath(relPath)

  let detections: DetectionResult[] | undefined

  if (HTML_LIKE_LANGUAGE_IDS.has(languageId)) {
    detections = extractionsParsers.html.detect(
      text,
      DefaultExtractionRules,
      DefaultDynamicExtractionsRules,
      config.extractParserHTMLOptions,
      script => extractionsParsers.babel.detect(
        script,
        DefaultExtractionRules,
        DefaultDynamicExtractionsRules,
        config.extractParserBabelOptions,
      ),
    )
  }
  else if (BABEL_LANGUAGE_IDS.has(languageId)) {
    try {
      detections = extractionsParsers.babel.detect(
        text,
        DefaultExtractionRules,
        DefaultDynamicExtractionsRules,
        config.extractParserBabelOptions,
      )
    }
    catch {
      // Unparseable JS/TS (syntax error, unsupported syntax) — treat as no
      // findings for this file rather than crashing the whole scan. The
      // caller (Scheduler/CLI) is responsible for surfacing this as a
      // skipped/parse-error file if it wants that signal.
      detections = undefined
    }
  }
  else {
    detections = undefined
  }

  if (!detections || !detections.length)
    return []

  const doc = TextDocument.fromFile(relPath, text, languageId)
  const ignoredSet = new Set(config.hardString.ignored)
  const ignoredForFile = collectIgnoredForFile(config.hardString.ignoredByFiles, relPath)

  const findings: HardStringFinding[] = []
  for (const d of detections) {
    const trimmed = d.text.trim()
    if (!trimmed)
      continue
    if (ignoredSet.has(trimmed) || ignoredForFile.has(trimmed))
      continue

    const start = doc.positionAt(d.start)
    const end = doc.positionAt(d.end)
    findings.push({
      file: relPath,
      line: start.line + 1,
      column: start.character + 1,
      endLine: end.line + 1,
      endColumn: end.character + 1,
      text: trimmed,
      source: d.source,
      languageId,
    })
  }

  return findings
}

function collectIgnoredForFile(ignoredByFiles: Record<string, string[]>, relPath: string): Set<string> {
  const out = new Set<string>()
  for (const [pattern, values] of Object.entries(ignoredByFiles)) {
    if (micromatchLike(pattern, relPath)) {
      for (const v of values)
        out.add(v)
    }
  }
  return out
}

/**
 * Minimal glob match for `hardString.ignoredByFiles` keys — supports exact
 * path match and a trailing `*`/`**` suffix, which covers the common cases
 * without pulling in micromatch purely for this. Falls back to exact match.
 */
function micromatchLike(pattern: string, relPath: string): boolean {
  if (pattern === relPath)
    return true
  if (pattern.includes('*')) {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000DOUBLESTAR\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\u0000DOUBLESTAR\u0000/g, '.*')
    return new RegExp(`^${escaped}$`).test(relPath)
  }
  return false
}
