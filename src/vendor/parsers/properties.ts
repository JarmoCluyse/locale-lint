// Vendored from lokalise/i18n-ally @4c504c93 — MIT. See NOTICE.

// @ts-ignore
import properties from 'properties'
import { Parser } from './base'

export class Properties extends Parser {
  id = 'properties'

  constructor() {
    super(['properties'], 'properties')
  }

  async parse(text: string) {
    return properties.parse(text)
  }

  async dump(object: object) {
    return properties.stringify(object)
  }
}
