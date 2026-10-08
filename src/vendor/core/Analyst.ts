// Vendored from lokalise/i18n-ally @4c504c93 — MIT. See NOTICE.
import { KeyDetector, KeyOccurrence } from '.'
import { TextDocument } from '../../shims/vscode';

export class Analyst {
  static async getOccurrencesOfFile(document: TextDocument) {
      return this.getOccurrencesOfText(document, document.uri.fsPath)
  }

  static async getOccurrencesOfText(doc: TextDocument, filepath: string) {
    const keys = KeyDetector.getKeys(doc)
    const occurrences: KeyOccurrence[] = []

    for (const { start, end, key } of keys) {
      occurrences.push({
        keypath: key,
        start,
        end,
        filepath,
      })
    }

    return occurrences
  }

  static normalizeKey(key: string) {
    return key.replace(/\[(.*)\]/g, '.$1')
  }
}
