// Vendored from lokalise/i18n-ally @4c504c93 — MIT. See NOTICE.
import { BasicExtrationRule } from './basic'
import { NonAsciiExtractionRule } from './non-ascii-characters'
import { DynamicExtractionRule } from './dynamic'

export * from './base'
export * from './basic'
export * from './non-ascii-characters'

export const DefaultExtractionRules = [
  new BasicExtrationRule(),
  new NonAsciiExtractionRule(),
]

export const DefaultDynamicExtractionsRules = [
  new DynamicExtractionRule(),
]
