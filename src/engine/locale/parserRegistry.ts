// Local parser resolution — bypasses `Global.enabledParsers` (the
// `shims/core-global.ts` warmup) because it currently resolves to an empty
// list in this environment (see LocaleStore's class doc for repro + report).
// We resolve directly against the vendored parser registry instead, which is
// a plain, dependency-free, side-effect-free import.
import { extname } from 'node:path'
import { AvailableParsers, DefaultEnabledParsers } from '../../vendor/parsers'
import type { Parser } from '../../vendor/parsers/base'

export function getEnabledParsers(enabledParserIds: string[] | undefined): Parser[] {
  const ids = enabledParserIds?.length ? enabledParserIds : DefaultEnabledParsers
  return AvailableParsers.filter(p => ids.includes(p.id))
}

/** Combined `(ext1|ext2|...)` fragment for use in `ParsePathMatcher`'s `{ext}` placeholder. */
export function enabledParserExts(parsers: Parser[], parsersExtendFileExtensions: Record<string, string> = {}): string {
  const extra = Object.entries(parsersExtendFileExtensions)
    .filter(([, parserId]) => parsers.some(p => p.id === parserId))
    .map(([ext]) => ext)
  return [...parsers.map(p => p.supportedExts), ...extra].filter(Boolean).join('|')
}

/**
 * Resolve the parser for a given file extension (e.g. `.json`), honouring
 * `parsersExtendFileExtensions` overrides the same way upstream's
 * `Global.getMatchedParser` does.
 */
export function getMatchedParser(
  fileOrExt: string,
  parsers: Parser[],
  parsersExtendFileExtensions: Record<string, string> = {},
): Parser | undefined {
  let ext = fileOrExt
  if (!ext.startsWith('.') && ext.includes('.'))
    ext = extname(ext)

  const overrideId = parsersExtendFileExtensions[ext.replace(/^\./, '')]
  if (overrideId)
    return parsers.find(p => p.id === overrideId)

  return parsers.find(p => p.supports(ext))
}
