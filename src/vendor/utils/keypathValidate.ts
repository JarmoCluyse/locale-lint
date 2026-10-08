// Vendored from lokalise/i18n-ally @4c504c93 — MIT. See NOTICE.
export function keypathValidate(keypath: string) {
  return !!keypath.match(/^[\w\d\-_][\w\d\-_[\]. ]*$/)
}
