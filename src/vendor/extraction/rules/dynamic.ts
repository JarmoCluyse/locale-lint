// Vendored from lokalise/i18n-ally @4c504c93 — MIT. See NOTICE.
import { ExtractionRule, ExtractionScore } from './base'

export class DynamicExtractionRule extends ExtractionRule {
  name = 'dynamic'

  shouldExtract(str: string) {
    // includes $t
    if (str.match(/(?:^|[$.\b])t\w?\(/u))
      return ExtractionScore.MustExclude
    // not quotes at all
    if (!str.match(/(?:['"`]|\$\{)/))
      return ExtractionScore.MustExclude
    return ExtractionScore.ShouldInclude
  }
}
