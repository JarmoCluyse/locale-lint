// Shared engine types for the hard-string scanner vertical slice.

export interface HardStringFinding {
  /** Path relative to the resolved config rootpath, forward-slash separated. */
  file: string
  /** 1-based line number of the detection start. */
  line: number
  /** 1-based column number of the detection start. */
  column: number
  /** 1-based line number of the detection end. */
  endLine: number
  /** 1-based column number of the detection end. */
  endColumn: number
  /** The extracted (unquoted) text. */
  text: string
  /** Where the detection came from (js-string, js-template, jsx-text, html-attribute, html-inline). */
  source: string
  /** vscode-shim languageId used to pick the parser. */
  languageId: string
}

export interface ScannedFileResult {
  /** Path relative to rootpath, forward-slash separated. */
  file: string
  findings: HardStringFinding[]
}

export interface SkippedFile {
  file: string
  reason: 'binary' | 'too-large' | 'read-error' | 'unsupported-extension' | 'parse-error'
  detail?: string
}

export interface ScanSummary {
  filesScanned: number
  filesSkipped: SkippedFile[]
  findings: HardStringFinding[]
  durationMs: number
}
