import type { TextDocument as LspTextDocument } from 'vscode-languageserver-textdocument'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_WORD_REGEXP,
  getLogLevel,
  Position,
  Range,
  setLogLevel,
  setWorkspaceRootpath,
  TextDocument,
  Uri,
  languageIdFromPath,
  window,
  workspace,
} from '../../src/shims/vscode'

// ---------------------------------------------------------------------------
// LSP compatibility assertion
// ---------------------------------------------------------------------------
//
// `vscode-languageserver-textdocument`'s TextDocument differs from vscode's
// only in `uri` (LSP: string, vscode: Uri object) — everything else in the
// overlapping surface (languageId, version, getText, positionAt, offsetAt,
// lineCount) must be structurally identical so a future LSP server can pass
// our documents through unmodified (after swapping in a string uri).
type LspCompatible = Pick<LspTextDocument, 'languageId' | 'version' | 'getText' | 'positionAt' | 'offsetAt' | 'lineCount'>
// Compile-time only: if this stops type-checking, our TextDocument shape has
// drifted from the LSP TextDocument shape for the overlapping members.
type _AssertAssignable = TextDocument extends LspCompatible ? true : false
const _assertLspCompatible: _AssertAssignable = true
void _assertLspCompatible

describe('shims/vscode', () => {
  describe('Position', () => {
    it('compares positions', () => {
      const a = new Position(1, 2)
      const b = new Position(1, 5)
      const c = new Position(2, 0)
      expect(a.isBefore(b)).toBe(true)
      expect(b.isAfter(a)).toBe(true)
      expect(a.isBefore(c)).toBe(true)
      expect(a.isEqual(new Position(1, 2))).toBe(true)
    })

    it('translate/with', () => {
      const p = new Position(3, 4)
      expect(p.translate(1, -1)).toEqual(new Position(4, 3))
      expect(p.with(undefined, 10)).toEqual(new Position(3, 10))
    })
  })

  describe('Range', () => {
    it('supports both constructor overloads', () => {
      const r1 = new Range(new Position(0, 0), new Position(1, 2))
      const r2 = new Range(0, 0, 1, 2)
      expect(r1.isEqual(r2)).toBe(true)
    })

    it('normalizes reversed start/end', () => {
      const r = new Range(new Position(2, 0), new Position(0, 0))
      expect(r.start.line).toBe(0)
      expect(r.end.line).toBe(2)
    })

    it('isEmpty', () => {
      expect(new Range(0, 0, 0, 0).isEmpty).toBe(true)
      expect(new Range(0, 0, 0, 1).isEmpty).toBe(false)
    })

    it('contains', () => {
      const r = new Range(0, 0, 2, 0)
      expect(r.contains(new Position(1, 0))).toBe(true)
      expect(r.contains(new Position(3, 0))).toBe(false)
      expect(r.contains(new Range(0, 0, 1, 0))).toBe(true)
    })
  })

  describe('Uri', () => {
    it('Uri.file', () => {
      const u = Uri.file('/a/b/c.ts')
      expect(u.fsPath).toBe('/a/b/c.ts')
      expect(u.path).toBe('/a/b/c.ts')
      expect(u.scheme).toBe('file')
      expect(u.toString()).toBe('file:///a/b/c.ts')
    })
  })

  describe('languageIdFromPath', () => {
    it.each([
      ['foo.ts', 'typescript'],
      ['foo.tsx', 'typescriptreact'],
      ['foo.js', 'javascript'],
      ['foo.jsx', 'javascriptreact'],
      ['foo.vue', 'vue'],
      ['foo.svelte', 'svelte'],
      ['foo.html', 'html'],
      ['foo.blade.php', 'blade'],
      ['foo.php', 'php'],
      ['foo.rb', 'ruby'],
      ['foo.erb', 'erb'],
      ['foo.dart', 'dart'],
      ['foo.json', 'json'],
      ['foo.yaml', 'yaml'],
      ['foo.yml', 'yaml'],
      ['foo.md', 'markdown'],
      ['foo.py', 'python'],
      ['foo.java', 'java'],
      ['foo.cs', 'csharp'],
    ])('%s -> %s', (path, expected) => {
      expect(languageIdFromPath(path)).toBe(expected)
    })
  })

  describe('TextDocument', () => {
    describe('positionAt/offsetAt round-trip', () => {
      const fixtures: Record<string, string> = {
        empty: '',
        'lf-no-trailing': 'abc\ndef\nghi',
        'lf-trailing': 'abc\ndef\nghi\n',
        'crlf': 'abc\r\ndef\r\nghi\r\n',
        'lone-cr': 'abc\rdef\rghi',
        'mixed': 'abc\r\ndef\nghi\rjkl\n',
        'only-newlines': '\n\n\n',
        'only-crlf': '\r\n\r\n',
        'single-line-no-newline': 'hello world',
      }

      for (const [name, text] of Object.entries(fixtures)) {
        it(`round-trips every offset for fixture "${name}"`, () => {
          const doc = TextDocument.fromFile(`/fake/${name}.txt`, text)
          // An offset that falls strictly inside a "\r\n" pair (between the
          // \r and the \n) does not correspond to a valid vscode Position —
          // positions are "line end character agnostic" — so it normalizes
          // to the end of that line's content. For such offsets we only
          // assert idempotency (positionAt(offsetAt(p)) === p), not that the
          // original offset is recovered byte-for-byte.
          const midCrlfOffsets = new Set<number>()
          for (let i = 0; i < text.length - 1; i++) {
            if (text[i] === '\r' && text[i + 1] === '\n')
              midCrlfOffsets.add(i + 1)
          }

          for (let offset = 0; offset <= text.length; offset++) {
            const pos = doc.positionAt(offset)
            const back = doc.offsetAt(pos)
            if (midCrlfOffsets.has(offset)) {
              const pos2 = doc.positionAt(back)
              expect(pos2, `idempotency for mid-CRLF offset ${offset}`).toEqual(pos)
            }
            else {
              expect(back, `offset ${offset} -> ${JSON.stringify(pos)} -> ${back}`).toBe(offset)
            }
          }
        })
      }

      it('lineCount matches expected line splitting (CRLF, LF, lone CR)', () => {
        expect(TextDocument.fromFile('/f', 'a\nb\nc').lineCount).toBe(3)
        expect(TextDocument.fromFile('/f', 'a\r\nb\r\nc').lineCount).toBe(3)
        expect(TextDocument.fromFile('/f', 'a\rb\rc').lineCount).toBe(3)
        expect(TextDocument.fromFile('/f', '').lineCount).toBe(1)
        expect(TextDocument.fromFile('/f', '\n\n\n').lineCount).toBe(4)
      })
    })

    describe('getText(range)', () => {
      it('extracts text within a single line', () => {
        const doc = TextDocument.fromFile('/f', 'hello world')
        const range = new Range(new Position(0, 0), new Position(0, 5))
        expect(doc.getText(range)).toBe('hello')
      })

      it('extracts text across a line boundary (LF)', () => {
        const doc = TextDocument.fromFile('/f', 'abc\ndef\nghi')
        const range = new Range(new Position(0, 1), new Position(2, 2))
        expect(doc.getText(range)).toBe('bc\ndef\ngh')
      })

      it('extracts text across a line boundary (CRLF)', () => {
        const doc = TextDocument.fromFile('/f', 'abc\r\ndef\r\nghi')
        const range = new Range(new Position(0, 1), new Position(2, 2))
        expect(doc.getText(range)).toBe('bc\r\ndef\r\ngh')
      })

      it('returns the full text when no range given', () => {
        const doc = TextDocument.fromFile('/f', 'abc\ndef')
        expect(doc.getText()).toBe('abc\ndef')
      })
    })

    describe('getWordRangeAtPosition', () => {
      // `.` is punctuation (splits "foo" / "bar") except when it forms a
      // decimal number ("3.14"), per VSCode's DEFAULT_WORD_REGEXP. Index map:
      // f0 o1 o2 .3 b4 a5 r6 _7 b8 a9 z10 _11 _12 ,13 _14 _15 3-16 .17 1-18 4-19 _20 q21 u22 x23
      const text = 'foo.bar baz  ,  3.14 qux'
      const doc = TextDocument.fromFile('/f', text)

      const cases: Array<[number, string | undefined]> = [
        [0, 'foo'], // word start
        [2, 'foo'], // inside word
        [7, 'bar'], // boundary right after "bar" (inclusive word end)
        [11, 'baz'], // boundary right after "baz" (inclusive word end)
        [12, undefined], // pure whitespace, not adjacent to any word
        [13, undefined], // on punctuation (comma), isolated by whitespace
        [16, '3.14'], // decimal number word, start
        [18, '3.14'], // inside decimal number word
        [21, 'qux'], // next word start
      ]

      it.each(cases)('position %i -> %s', (character, expected) => {
        const range = doc.getWordRangeAtPosition(new Position(0, character), DEFAULT_WORD_REGEXP)
        if (expected === undefined) {
          expect(range).toBeUndefined()
        }
        else {
          expect(range).toBeDefined()
          expect(doc.getText(range!)).toBe(expected)
        }
      })

      it('does not span lines', () => {
        const multiline = TextDocument.fromFile('/f', 'foo\nbar')
        const range = multiline.getWordRangeAtPosition(new Position(0, 1))
        expect(range).toBeDefined()
        expect(range!.start.line).toBe(0)
        expect(range!.end.line).toBe(0)
        expect(multiline.getText(range!)).toBe('foo')
      })

      it('uses a custom regex when provided', () => {
        const doc2 = TextDocument.fromFile('/f', 'hello_world-foo')
        const range = doc2.getWordRangeAtPosition(new Position(0, 2), /[a-z]+/g)
        expect(doc2.getText(range!)).toBe('hello')
      })
    })

    it('fromFile resolves languageId from extension', () => {
      const doc = TextDocument.fromFile('/a/b/c.tsx', 'export {}')
      expect(doc.languageId).toBe('typescriptreact')
    })

    it('fromFile accepts an explicit languageId override', () => {
      const doc = TextDocument.fromFile('/a/b/c.tsx', 'export {}', 'custom-lang')
      expect(doc.languageId).toBe('custom-lang')
    })

    it('uri is a vscode Uri (diverges from LSP string uri by design)', () => {
      const doc = TextDocument.fromFile('/a/b/c.ts', 'x')
      expect(doc.uri.fsPath).toBe('/a/b/c.ts')
      expect(typeof doc.uri).not.toBe('string')
    })
  })

  describe('window logging surface', () => {
    const originalLevel = getLogLevel()

    afterEach(() => {
      setLogLevel(originalLevel)
      vi.restoreAllMocks()
    })

    it('createOutputChannel.appendLine writes to stderr, never stdout', () => {
      setLogLevel('verbose')
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

      const channel = window.createOutputChannel('test')
      channel.appendLine('hello world')

      expect(stderrSpy).toHaveBeenCalledWith('hello world\n')
      expect(stdoutSpy).not.toHaveBeenCalled()
    })

    it('channel.show() is a no-op (no output panel headlessly)', () => {
      const channel = window.createOutputChannel('test')
      expect(() => channel.show()).not.toThrow()
    })

    it('defaults to "warn" level', () => {
      expect(getLogLevel()).toBe('warn')
    })

    it('gates info-level appendLine traffic out at the default "warn" level', () => {
      setLogLevel('warn')
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const channel = window.createOutputChannel('test')
      channel.appendLine('plain info line')
      expect(stderrSpy).not.toHaveBeenCalled()
    })

    it('allows warn-level appendLine traffic through at the default "warn" level', () => {
      setLogLevel('warn')
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const channel = window.createOutputChannel('test')
      channel.appendLine('⚠ WARN: something')
      expect(stderrSpy).toHaveBeenCalledWith('⚠ WARN: something\n')
    })

    it('"silent" suppresses everything, including errors', () => {
      setLogLevel('silent')
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const channel = window.createOutputChannel('test')
      channel.appendLine('🐛 ERROR: boom')
      expect(stderrSpy).not.toHaveBeenCalled()
    })

    it('showErrorMessage resolves immediately to undefined instead of hanging', async () => {
      setLogLevel('silent')
      const result = await window.showErrorMessage('boom', 'Show Output')
      expect(result).toBeUndefined()
    })

    it('showWarningMessage resolves immediately to undefined', async () => {
      setLogLevel('silent')
      const result = await window.showWarningMessage('careful')
      expect(result).toBeUndefined()
    })

    it('showInputBox is an interactive-only stub that throws with a named, diagnosable message', () => {
      expect(() => window.showInputBox({})).toThrow(/showInputBox/)
    })

    it('showQuickPick is an interactive-only stub that throws with a named, diagnosable message', () => {
      expect(() => window.showQuickPick([])).toThrow(/showQuickPick/)
    })

    it('a representative vendored Log.info(...) call no longer throws', async () => {
      setLogLevel('silent')
      const { Log } = await import('../../src/vendor/utils/Log')
      expect(() => Log.info('hello from vendored code')).not.toThrow()
    })
  })

  describe('workspace.workspaceFolders', () => {
    afterEach(() => {
      setWorkspaceRootpath(undefined)
    })

    it('returns undefined when no root has been configured', () => {
      expect(workspace.workspaceFolders).toBeUndefined()
    })

    it('derives a single workspace folder from the configured rootpath', () => {
      setWorkspaceRootpath('/some/project')
      const folders = workspace.workspaceFolders
      expect(folders).toHaveLength(1)
      expect(folders[0].uri.fsPath).toBe('/some/project')
    })

    it('other workspace members still throw a named, diagnosable error', () => {
      expect(() => workspace.onDidChangeTextDocument).toThrow(/workspace\.onDidChangeTextDocument/)
    })
  })
})
