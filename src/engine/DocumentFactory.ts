// DocumentFactory — reads a file from disk and produces a shimmed
// `TextDocument`, handling encoding and skip cases (binary/oversized) without
// throwing.
import { readFile, stat } from 'node:fs/promises'
import iconvLite from 'iconv-lite'
import { TextDocument, languageIdFromPath } from '../shims/vscode'
import type { SkippedFile } from './types'

export interface DocumentFactoryOptions {
  encoding?: string
  /** Max file size in bytes before skipping as "too-large". Default 2 MiB. */
  maxBytes?: number
  /**
   * User-configurable extension -> languageId overrides (`ResolvedConfig.languageIdOverrides`),
   * keyed by suffix (e.g. `.hbs`). Checked before the built-in override
   * table and before `languageIdFromPath`.
   */
  languageIdOverrides?: Record<string, string>
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024

// Extension -> languageId overrides not covered by
// `shims/vscode.ts`'s `languageIdByExtension` table (that module is
// read-only from here — see WRITE SCOPE notes). Currently only
// `.hbs` -> `handlebars`: the Ember framework
// (`src/vendor/frameworks/ember.ts`) declares `handlebars` as a supported
// `languageIds` entry, but the vscode shim has no `.hbs` mapping at all, so
// `languageIdFromPath` would fall through to `'plaintext'` — which doesn't
// match any framework's `languageIds`, silently disabling usage-key
// detection in every `.hbs` file even once file discovery finds them.
const BUILTIN_EXTENSION_LANGUAGE_IDS: Array<[suffix: string, languageId: string]> = [
  ['.hbs', 'handlebars'],
]

function resolveLanguageId(absPath: string, overrides?: Record<string, string>): string {
  const lower = absPath.toLowerCase()
  if (overrides) {
    for (const [suffix, languageId] of Object.entries(overrides)) {
      if (lower.endsWith(suffix.toLowerCase()))
        return languageId
    }
  }
  for (const [suffix, languageId] of BUILTIN_EXTENSION_LANGUAGE_IDS) {
    if (lower.endsWith(suffix))
      return languageId
  }
  return languageIdFromPath(absPath)
}

export type DocumentFactoryResult =
  | { ok: true, document: TextDocument, text: string }
  | { ok: false, skip: SkippedFile }

/** Cheap binary sniff: a NUL byte in the first 8KiB is a strong binary signal. */
function looksBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8192)
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0)
      return true
  }
  return false
}

export async function loadDocument(absPath: string, relPath: string, options: DocumentFactoryOptions = {}): Promise<DocumentFactoryResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const encoding = normalizeEncoding(options.encoding ?? 'utf-8')

  try {
    const st = await stat(absPath)
    if (st.size > maxBytes) {
      return { ok: false, skip: { file: relPath, reason: 'too-large', detail: `${st.size} bytes > ${maxBytes}` } }
    }

    const buf = await readFile(absPath)
    if (looksBinary(buf))
      return { ok: false, skip: { file: relPath, reason: 'binary' } }

    const text = decode(buf, encoding)
    const document = TextDocument.fromFile(absPath, text, resolveLanguageId(absPath, options.languageIdOverrides))
    return { ok: true, document, text }
  }
  catch (e) {
    return { ok: false, skip: { file: relPath, reason: 'read-error', detail: e instanceof Error ? e.message : String(e) } }
  }
}

function normalizeEncoding(encoding: string): string {
  // Config.encoding mirrors upstream i18n-ally values like 'utf-8', 'utf8bom',
  // 'gb2312', 'gbk', etc. iconv-lite accepts most of these directly except
  // the bom variants.
  const lower = encoding.toLowerCase()
  if (lower === 'utf8bom' || lower === 'utf-8-bom')
    return 'utf8'
  return lower
}

function decode(buf: Buffer, encoding: string): string {
  if (encoding === 'utf8' || encoding === 'utf-8') {
    let text = buf.toString('utf8')
    if (text.charCodeAt(0) === 0xFEFF)
      text = text.slice(1)
    return text
  }
  if (!iconvLite.encodingExists(encoding))
    return buf.toString('utf8')
  return iconvLite.decode(buf, encoding)
}
