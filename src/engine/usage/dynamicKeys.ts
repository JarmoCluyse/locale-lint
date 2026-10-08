// Heuristic detector for "dynamic key" usages — translation calls whose key
// argument is NOT a plain string literal (template-literal interpolation or
// string concatenation), e.g. `` t(`err.${code}`) `` or `t('err.' + code)`.
// These are statically undecidable: the scanner cannot enumerate which
// concrete locale keys they resolve to at runtime. See UsageScanner.ts for
// how this feeds into the "unused keys may be incomplete" caveat.
//
// Deliberately a plain regex pass over the FULL raw text — same philosophy
// as the vendored `KeyDetector`/`regexFindKeys` (no comment-stripping, no
// AST). A key referenced only in a `//` or `/* */` comment must still count
// as "used" elsewhere (see Analyst-based static-key scanning); this module
// only concerns itself with flagging *dynamic* call shapes for the caveat,
// so whether the call happens to be commented out does not materially
// matter — worst case we flag a commented-out dynamic call, which only
// makes the caveat slightly more conservative, never less safe.
import type { DynamicKeyUsage } from './types'

// Matches common translation-call identifiers (`t`, `$t`, `i18n.t`,
// `this.$t`, `tc`, `te`) followed by either:
//   - a template literal containing `${` (interpolation), or
//   - a quoted string immediately followed by `+` (concatenation start).
const DYNAMIC_KEY_CALL_RE
  = /\b(?:\$t|i18n\.t|this\.\$t|t|tc|te)\(\s*(`(?:[^`\\]|\\.)*\$\{(?:[^`]|\\.)*`|'(?:[^'\\]|\\.)*'\s*\+|"(?:[^"\\]|\\.)*"\s*\+)/g

const SNIPPET_MAX_LENGTH = 60

function computeLineOffsets(text: string): number[] {
  const offsets: number[] = [0]
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */)
      offsets.push(i + 1)
  }
  return offsets
}

function positionAt(offsets: number[], index: number): { line: number, column: number } {
  let low = 0
  let high = offsets.length - 1
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2)
    if (offsets[mid] <= index)
      low = mid
    else
      high = mid - 1
  }
  return { line: low + 1, column: index - offsets[low] + 1 }
}

/** Pure function of `(relPath, text)` — no config/runtime dependency at all. */
export function detectDynamicKeyUsages(relPath: string, text: string): DynamicKeyUsage[] {
  const results: DynamicKeyUsage[] = []
  const offsets = computeLineOffsets(text)

  const re = new RegExp(DYNAMIC_KEY_CALL_RE.source, DYNAMIC_KEY_CALL_RE.flags)
  let match: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((match = re.exec(text))) {
    const { line, column } = positionAt(offsets, match.index)
    let snippet = match[0].trim()
    if (snippet.length > SNIPPET_MAX_LENGTH)
      snippet = `${snippet.slice(0, SNIPPET_MAX_LENGTH)}…`
    results.push({ file: relPath, line, column, snippet })
    if (match.index === re.lastIndex)
      re.lastIndex++
  }

  return results
}
