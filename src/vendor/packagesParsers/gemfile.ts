// Vendored from lokalise/i18n-ally @4c504c93 — MIT. See NOTICE.
import { PackageParser } from './base'

export class GemfileParser extends PackageParser {
  static filename = 'Gemfile'

  protected static parserRaw(raw: string) {
    if (raw.match(/gem ["']rails-i18n['"]/))
      return ['rails-i18n']
    return []
  }
}
