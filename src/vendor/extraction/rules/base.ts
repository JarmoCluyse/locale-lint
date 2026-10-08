// Vendored from lokalise/i18n-ally @4c504c93 — MIT. See NOTICE.
export enum ExtractionScore {
  MustInclude,
  ShouldInclude,
  None,
  ShouldExclude,
  MustExclude
}

export abstract class ExtractionRule {
  abstract name: string

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  shouldExtract(str: string): ExtractionScore | void {
    return ExtractionScore.None
  }
}
