import type { FileInfo } from '../../vendor/core/types'

export interface Diagnostic {
  /** Rootpath-relative, forward-slash path of the offending locale file. */
  file: string
  severity: 'error' | 'warning'
  message: string
}

export interface ParsedLocaleFile extends FileInfo {
  value: object
}
