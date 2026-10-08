// This module stands in for the real `vscode` extension API so that
// vendored code (src/vendor/**) can be type-checked and run outside of VS
// Code. Every named export below is referenced by src/vendor/** — do not
// rename or remove without re-running `npm run vendor:sync` and checking the
// codemod output / shim-surface report.
//
// WRITE SCOPE: this file (and test/shims/vscode.test.ts) implement a real,
// dependency-free polyfill for the slice of the API that vendored code
// actually exercises headlessly: Position, Range, Uri, TextDocument,
// EventEmitter, Disposable, plus `window`'s logging surface
// (createOutputChannel / show*Message, backed by utils/Log.ts) and
// `workspace.workspaceFolders`. Everything else (OutputChannel's
// constructor, FileSystemWatcher, Location, ExtensionContext,
// WorkspaceEdit, RelativePattern, window.showInputBox/showQuickPick) is
// only ever touched by interactive / editor-only / write code paths (user
// prompts, file watching, applying edits to open editors) that are out of
// scope for the headless CLI — they remain throwing placeholders, with
// messages naming the member and explaining why, so any accidental use
// fails loudly and diagnosably instead of silently doing nothing.

function notImplemented(name: string): never {
  throw new Error(`[shims/vscode] "${name}" is a placeholder and has not been implemented yet.`)
}

// ---------------------------------------------------------------------------
// Position
// ---------------------------------------------------------------------------

export class Position {
  readonly line: number
  readonly character: number

  constructor(line: number, character: number) {
    this.line = line
    this.character = character
  }

  translate(lineDelta = 0, characterDelta = 0): Position {
    return new Position(this.line + lineDelta, this.character + characterDelta)
  }

  with(line: number = this.line, character: number = this.character): Position {
    return new Position(line, character)
  }

  isBefore(other: Position): boolean {
    if (this.line < other.line)
      return true
    if (this.line > other.line)
      return false
    return this.character < other.character
  }

  isBeforeOrEqual(other: Position): boolean {
    return this.isBefore(other) || this.isEqual(other)
  }

  isAfter(other: Position): boolean {
    return !this.isBeforeOrEqual(other)
  }

  isAfterOrEqual(other: Position): boolean {
    return !this.isBefore(other)
  }

  isEqual(other: Position): boolean {
    return this.line === other.line && this.character === other.character
  }

  compareTo(other: Position): number {
    if (this.isBefore(other))
      return -1
    if (this.isAfter(other))
      return 1
    return 0
  }
}

// ---------------------------------------------------------------------------
// Range
// ---------------------------------------------------------------------------

export class Range {
  readonly start: Position
  readonly end: Position

  constructor(start: Position, end: Position)
  constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number)
  constructor(a: Position | number, b: Position | number, c?: number, d?: number) {
    if (a instanceof Position && b instanceof Position) {
      const [start, end] = a.isBeforeOrEqual(b) ? [a, b] : [b, a]
      this.start = start
      this.end = end
    }
    else {
      const startLine = a as number
      const startCharacter = b as number
      const endLine = c as number
      const endCharacter = d as number
      const start = new Position(startLine, startCharacter)
      const end = new Position(endLine, endCharacter)
      const [lo, hi] = start.isBeforeOrEqual(end) ? [start, end] : [end, start]
      this.start = lo
      this.end = hi
    }
  }

  get isEmpty(): boolean {
    return this.start.isEqual(this.end)
  }

  get isSingleLine(): boolean {
    return this.start.line === this.end.line
  }

  contains(positionOrRange: Position | Range): boolean {
    if (positionOrRange instanceof Range)
      return this.contains(positionOrRange.start) && this.contains(positionOrRange.end)
    const position = positionOrRange
    return position.isAfterOrEqual(this.start) && position.isBeforeOrEqual(this.end)
  }

  isEqual(other: Range): boolean {
    return this.start.isEqual(other.start) && this.end.isEqual(other.end)
  }

  with(start: Position = this.start, end: Position = this.end): Range {
    return new Range(start, end)
  }
}

// ---------------------------------------------------------------------------
// Uri
// ---------------------------------------------------------------------------

export class Uri {
  readonly scheme: string
  readonly path: string
  readonly fsPath: string

  private constructor(scheme: string, path: string) {
    this.scheme = scheme
    this.path = path
    this.fsPath = path
  }

  static file(fsPath: string): Uri {
    return new Uri('file', fsPath)
  }

  static parse(value: string): Uri {
    const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/.exec(value)
    if (match)
      return new Uri(match[1], match[2])
    return new Uri('file', value)
  }

  toString(): string {
    return `${this.scheme}://${this.path}`
  }

  toJSON(): unknown {
    return { scheme: this.scheme, path: this.path, fsPath: this.fsPath }
  }
}

// ---------------------------------------------------------------------------
// languageId resolution
// ---------------------------------------------------------------------------

// Order matters: more specific suffixes (e.g. `.blade.php`) must be checked
// before less specific ones (`.php`). Exported so a later config lane can
// extend/override it.
export const languageIdByExtension: Array<[suffix: string, languageId: string]> = [
  ['.blade.php', 'blade'],
  ['.tsx', 'typescriptreact'],
  ['.ts', 'typescript'],
  ['.jsx', 'javascriptreact'],
  ['.js', 'javascript'],
  ['.vue', 'vue'],
  ['.svelte', 'svelte'],
  ['.html', 'html'],
  ['.php', 'php'],
  ['.rb', 'ruby'],
  ['.erb', 'erb'],
  ['.dart', 'dart'],
  ['.json', 'json'],
  ['.yaml', 'yaml'],
  ['.yml', 'yaml'],
  ['.md', 'markdown'],
  ['.py', 'python'],
  ['.java', 'java'],
  ['.cs', 'csharp'],
]

export function languageIdFromPath(fsPath: string): string {
  const lower = fsPath.toLowerCase()
  for (const [suffix, languageId] of languageIdByExtension) {
    if (lower.endsWith(suffix))
      return languageId
  }
  return 'plaintext'
}

// ---------------------------------------------------------------------------
// TextDocument
// ---------------------------------------------------------------------------

// Default VSCode "word" regex (copied verbatim from vscode's
// `DEFAULT_WORD_REGEXP` in editor/common/core/wordHelper.ts).
export const DEFAULT_WORD_REGEXP = /(-?\d*\.\d\w*)|([^`~!@#$%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+)/g

function splitLines(text: string): string[] {
  // VSCode treats \r\n, \n, and a lone \r as line terminators.
  return text.split(/\r\n|\r|\n/)
}

export class TextDocument {
  readonly uri: Uri
  readonly languageId: string
  readonly version: number

  private readonly _text: string
  private _lineOffsets: number[] | undefined

  constructor(uri: Uri, languageId: string, version: number, text: string) {
    this.uri = uri
    this.languageId = languageId
    this.version = version
    this._text = text
  }

  static fromFile(fsPath: string, text: string, languageId?: string): TextDocument {
    return new TextDocument(Uri.file(fsPath), languageId ?? languageIdFromPath(fsPath), 1, text)
  }

  private get lineOffsets(): number[] {
    if (!this._lineOffsets)
      this._lineOffsets = computeLineOffsets(this._text)
    return this._lineOffsets
  }

  get lineCount(): number {
    return this.lineOffsets.length
  }

  getText(range?: Range): string {
    if (!range)
      return this._text
    const start = this.offsetAt(range.start)
    const end = this.offsetAt(range.end)
    return this._text.substring(start, end)
  }

  positionAt(offset: number): Position {
    const clamped = Math.max(0, Math.min(offset, this._text.length))
    const offsets = this.lineOffsets
    let low = 0
    let high = offsets.length - 1
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2)
      if (offsets[mid] <= clamped)
        low = mid
      else
        high = mid - 1
    }
    const line = low
    const lineStart = offsets[line]
    const lineEnd = line + 1 < offsets.length ? offsets[line + 1] : this._text.length
    // Clamp against the line's actual content length (excluding its
    // terminator): an offset that falls inside a \r\n pair, or exactly on
    // the terminator, is not a valid vscode Position (positions are "line
    // end character agnostic") — it normalizes to the end of that line's
    // content instead.
    const lineLength = getLineText(this._text, lineStart, lineEnd).length
    const character = Math.min(clamped - lineStart, lineLength)
    return new Position(line, character)
  }

  offsetAt(position: Position): number {
    const offsets = this.lineOffsets
    const line = Math.max(0, Math.min(position.line, offsets.length - 1))
    const lineStart = offsets[line]
    const lineEnd = line + 1 < offsets.length ? offsets[line + 1] : this._text.length
    // The line's content length excludes its own terminator, which
    // computeLineOffsets already accounts for via the next offset minus the
    // terminator width — but we don't know the terminator width here, so
    // clamp against the raw text length between offsets, then also clamp to
    // not exceed the actual line content (found by scanning for a line
    // terminator from lineStart).
    const lineText = getLineText(this._text, lineStart, lineEnd)
    const character = Math.max(0, Math.min(position.character, lineText.length))
    return lineStart + character
  }

  lineAt(line: number): { text: string, range: Range, lineNumber: number } {
    const offsets = this.lineOffsets
    const clampedLine = Math.max(0, Math.min(line, offsets.length - 1))
    const lineStart = offsets[clampedLine]
    const lineEnd = clampedLine + 1 < offsets.length ? offsets[clampedLine + 1] : this._text.length
    const text = getLineText(this._text, lineStart, lineEnd)
    return {
      text,
      lineNumber: clampedLine,
      range: new Range(new Position(clampedLine, 0), new Position(clampedLine, text.length)),
    }
  }

  getWordRangeAtPosition(position: Position, regex: RegExp = DEFAULT_WORD_REGEXP): Range | undefined {
    const { text: lineText, range: lineRange } = this.lineAt(position.line)
    const character = Math.max(0, Math.min(position.character, lineText.length))

    const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`
    const re = new RegExp(regex.source, flags)

    let match: RegExpExecArray | null
    // eslint-disable-next-line no-cond-assign
    while ((match = re.exec(lineText))) {
      if (match[0].length === 0) {
        re.lastIndex++
        continue
      }
      const matchStart = match.index
      const matchEnd = match.index + match[0].length
      if (character >= matchStart && character <= matchEnd) {
        return new Range(
          new Position(lineRange.start.line, matchStart),
          new Position(lineRange.start.line, matchEnd),
        )
      }
      if (matchStart > character)
        break
    }
    return undefined
  }
}

/** Offsets (into the full text) of the start of each line. */
function computeLineOffsets(text: string): number[] {
  const offsets: number[] = [0]
  let i = 0
  const len = text.length
  while (i < len) {
    const ch = text.charCodeAt(i)
    if (ch === 13 /* \r */) {
      if (i + 1 < len && text.charCodeAt(i + 1) === 10 /* \n */)
        i++
      offsets.push(i + 1)
    }
    else if (ch === 10 /* \n */) {
      offsets.push(i + 1)
    }
    i++
  }
  return offsets
}

/** Line content between [start, end) with trailing line terminator stripped. */
function getLineText(text: string, start: number, end: number): string {
  let slice = text.substring(start, end)
  if (slice.endsWith('\r\n'))
    slice = slice.slice(0, -2)
  else if (slice.endsWith('\n') || slice.endsWith('\r'))
    slice = slice.slice(0, -1)
  return slice
}

// ---------------------------------------------------------------------------
// EventEmitter / Disposable
// ---------------------------------------------------------------------------
//
// Backed by node's `events` module — kept minimal since the only remaining
// consumers (core/loaders/Loader.ts, core/loaders/ComposedLoader.ts) just
// need `.event`/`.fire`/`.dispose` and `.dispose` composition.

import { EventEmitter as NodeEventEmitter } from 'node:events'

const EVENT_KEY = 'event'

export class EventEmitter<T = any> {
  private readonly emitter = new NodeEventEmitter()

  event = (listener: (e: T) => any): Disposable => {
    this.emitter.on(EVENT_KEY, listener)
    return new Disposable(() => this.emitter.off(EVENT_KEY, listener))
  }

  fire(data: T): void {
    this.emitter.emit(EVENT_KEY, data)
  }

  dispose(): void {
    this.emitter.removeAllListeners()
  }
}

export class Disposable {
  private _callback: (() => void) | undefined

  constructor(callback?: () => void) {
    this._callback = callback
  }

  static from(...disposables: Array<{ dispose: () => any }>): Disposable {
    return new Disposable(() => {
      for (const d of disposables)
        d.dispose()
    })
  }

  dispose(): void {
    this._callback?.()
    this._callback = undefined
  }
}

// ---------------------------------------------------------------------------
// Headless diagnostics: window.createOutputChannel / show*Message
// ---------------------------------------------------------------------------
//
// src/vendor/utils/Log.ts is backed by these — every vendored call site
// (framework/package parsers, usage scanner, etc.) calls `Log.info` /
// `Log.warn` / `Log.error` unconditionally on both success and failure
// paths, so these MUST be real, non-throwing implementations or any
// vendored code path that logs anything throws at runtime.
//
// Routing: all diagnostic output goes to STDERR, never stdout. stdout is
// reserved for machine-readable reports (`--format json` is piped in CI).
//
// Verbosity: controlled by `setLogLevel`, default `'warn'` — a normal
// successful run should emit nothing but the report on stdout; `warn` is
// quiet enough for that while still surfacing real problems.
//
// `showWarningMessage` / `showErrorMessage` return Promises (matching real
// vscode, where they resolve to the clicked button) but resolve IMMEDIATELY
// to `undefined` — a CI process must never block on a dialog that can't be
// shown.

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'verbose'

const logLevelOrder: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  verbose: 4,
}

let currentLogLevel: LogLevel = 'warn'

export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level
}

export function getLogLevel(): LogLevel {
  return currentLogLevel
}

function logAllowed(level: LogLevel): boolean {
  return logLevelOrder[currentLogLevel] >= logLevelOrder[level]
}

function writeStderr(line: string): void {
  process.stderr.write(`${line}\n`)
}

function makeOutputChannel(_name: string): OutputChannel {
  return {
    appendLine: (value: string) => {
      // Log.info/.warn/.divider/.raw all funnel through appendLine — there's
      // no level tag on the string itself, so we treat appendLine traffic as
      // 'info' level. Log.warn additionally prefixes "⚠ WARN:" and
      // Log.error prefixes "🐛 ERROR:" into the same channel, which we
      // detect here to apply the right gate.
      const level: LogLevel = /^\s*🐛 ERROR:/.test(value)
        ? 'error'
        : /^\s*⚠ WARN:/.test(value)
          ? 'warn'
          : 'info'
      if (logAllowed(level))
        writeStderr(value)
    },
    show: () => {
      // Headless: no output panel to focus. No-op.
    },
  }
}

export const window: any = {
  createOutputChannel: (name: string): OutputChannel => makeOutputChannel(name),
  showWarningMessage: (message: string, ..._items: string[]): Promise<string | undefined> => {
    if (logAllowed('warn'))
      writeStderr(message)
    return Promise.resolve(undefined)
  },
  showErrorMessage: (message: string, ..._items: string[]): Promise<string | undefined> => {
    if (logAllowed('error'))
      writeStderr(message)
    return Promise.resolve(undefined)
  },
  showInformationMessage: (message: string, ..._items: string[]): Promise<string | undefined> => {
    if (logAllowed('info'))
      writeStderr(message)
    return Promise.resolve(undefined)
  },
  // Interactive-only: no headless equivalent. Any hit means vendored code
  // on an editor-only path got invoked from the CLI — fail loudly and name
  // the member so it's instantly diagnosable.
  get showInputBox(): never {
    return notImplemented('window.showInputBox — interactive-only, not valid in headless mode') as never
  },
  get showQuickPick(): never {
    return notImplemented('window.showQuickPick — interactive-only, not valid in headless mode') as never
  },
}

// `OutputChannel`, `FileSystemWatcher`, and `ExtensionContext` are used by
// vendored code both as values and as TYPES (`private static _channel:
// OutputChannel`, etc. — these annotations are always type-checked). So each
// gets a minimal interface — shaped only after the members the vendored
// call sites actually use.

// Used by utils/Log.ts: `.appendLine(...)`, `.show()`.
export interface OutputChannel {
  appendLine: (value: string) => void
  show: () => void
}
export const OutputChannel: { new (): OutputChannel } = new Proxy(function () { notImplemented('OutputChannel()') }, {
  get: (_t, prop) => notImplemented(`OutputChannel.${String(prop)}`),
}) as any

// `workspace.workspaceFolders`: used by frameworks/index.ts's
// `getPackageDependencies` only as a fallback to locate `package.json`
// relative to the first workspace folder. The headless framework-detection
// lane (src/runtime/FrameworkDetector.ts) already reimplements manifest
// reading directly and does not go through this vendored path, so this is
// reachable only if some other vendored code path exercises
// `getPackageDependencies` directly.
//
// Recommendation: make it settable and derive it from a single headless
// "rootpath" (set once at CLI startup from the scan target), rather than
// leaving it throwing — it's a trivial, safe read-only derivation (no
// interactivity involved) and removes a latent trap for any future vendored
// path that reaches this function. If no root has been configured yet, it
// returns `undefined` (matching real vscode's "no folder open" case) rather
// than throwing, since `frameworks/index.ts:86` already null-checks it.
export interface WorkspaceFolder {
  uri: Uri
  name: string
  index: number
}

let workspaceRootpath: string | undefined

export function setWorkspaceRootpath(rootpath: string | undefined): void {
  workspaceRootpath = rootpath
}

export const workspace: any = new Proxy({
  get workspaceFolders(): WorkspaceFolder[] | undefined {
    if (!workspaceRootpath)
      return undefined
    return [{ uri: Uri.file(workspaceRootpath), name: workspaceRootpath, index: 0 }]
  },
}, {
  get: (target, prop) => {
    if (prop === 'workspaceFolders')
      return (target as any).workspaceFolders
    return notImplemented(`workspace.${String(prop)} — not implemented in headless mode`)
  },
})

// Used by frameworks/custom.ts: `.dispose()`, `.onDidChange/Create/Delete(cb)`.
// File-watching is an editor-only, "live edit" concern — the headless CLI
// scans a snapshot of the filesystem once per run and never watches it.
export interface FileSystemWatcher {
  dispose: () => void
  onDidChange: (listener: (uri: Uri) => any) => Disposable
  onDidCreate: (listener: (uri: Uri) => any) => Disposable
  onDidDelete: (listener: (uri: Uri) => any) => Disposable
}
export const FileSystemWatcher: { new (): FileSystemWatcher } = new Proxy(function () { notImplemented('FileSystemWatcher() — editor-only (file watching), not valid in headless mode') }, {
  get: (_t, prop) => notImplemented(`FileSystemWatcher.${String(prop)} — editor-only (file watching), not valid in headless mode`),
}) as any

// `vscode.Location` (uri + range) is only constructed by vendored code that
// reports results back into the editor's Problems/References UI — the
// headless scanner's own result types (src/engine/**) don't route through
// it. Write/interactive path: stays throwing.
export const Location: any = new Proxy(function () { notImplemented('Location() — editor-only (UI reporting), not valid in headless mode') }, {
  get: (_t, prop) => notImplemented(`Location.${String(prop)} — editor-only (UI reporting), not valid in headless mode`),
})

// Used by core/KeyDetector.ts: `ctx.subscriptions` (an array of disposables
// passed as the third arg of `workspace.onDidChangeTextDocument`). An
// `ExtensionContext` only exists when the extension host activates a real
// extension — there's no headless equivalent. Interactive/live-edit path:
// stays throwing.
export interface ExtensionContext {
  subscriptions: Disposable[]
}
export const ExtensionContext: { new (): ExtensionContext } = new Proxy(function () { notImplemented('ExtensionContext() — editor-only (extension activation), not valid in headless mode') }, {
  get: (_t, prop) => notImplemented(`ExtensionContext.${String(prop)} — editor-only (extension activation), not valid in headless mode`),
}) as any

// `WorkspaceEdit` applies edits back into open editors — a write path with
// no headless meaning (the CLI is read-only/reporting). Stays throwing.
export const WorkspaceEdit: any = new Proxy(function () { notImplemented('WorkspaceEdit() — editor-only (applies edits to open editors), not valid in headless mode') }, {
  get: (_t, prop) => notImplemented(`WorkspaceEdit.${String(prop)} — editor-only (applies edits to open editors), not valid in headless mode`),
})

// `RelativePattern` is only used to scope `FileSystemWatcher`/glob
// subscriptions to a workspace folder — same editor-only, live-watching
// concern as `FileSystemWatcher` above. Stays throwing.
export const RelativePattern: any = new Proxy(function () { notImplemented('RelativePattern() — editor-only (file watching), not valid in headless mode') }, {
  get: (_t, prop) => notImplemented(`RelativePattern.${String(prop)} — editor-only (file watching), not valid in headless mode`),
})
