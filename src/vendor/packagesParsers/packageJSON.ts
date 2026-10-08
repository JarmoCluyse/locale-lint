// Vendored from lokalise/i18n-ally @4c504c93 — MIT. See NOTICE.
import { PackageParser } from './base'

export class PackageJSONParser extends PackageParser {
  static filename = 'package.json'

  protected static parserRaw(raw: string) {
    const {
      dependencies = {},
      devDependencies = {},
      peerDependencies = {},
    } = JSON.parse(raw)

    return [...Object.keys(dependencies), ...Object.keys(devDependencies), ...Object.keys(peerDependencies)]
  }
}
