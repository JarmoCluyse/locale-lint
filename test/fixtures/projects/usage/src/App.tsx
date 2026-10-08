// Adapted in spirit from upstream lokalise/i18n-ally
// examples/by-frameworks/vue-i18n/App.vue (MIT — see NOTICE), reworked for
// react-i18next's `t(...)` convention to match this repo's other fixtures.
//
// Dynamic key usage, documented in a comment so the scanner's "unused keys"
// result stays actionable despite being statically undecidable:
//   t(`errors.${code}`) may resolve to errors.notFound or errors.timeout
import { useTranslation } from 'react-i18next'

export function App() {
  const { t } = useTranslation()

  const greeting = t('greeting')
  const farewell = t('farewell') // present in en, MISSING in fr (per-locale missing case)
  const typo = t('missing.key') // genuinely absent from every locale

  // A key referenced ONLY inside a line comment must still count as "used":
  // t('only.in.line.comment')

  /* A key referenced ONLY inside a block comment must still count as "used":
     t('only.in.block.comment') */

  return `${greeting} ${farewell} ${typo}`
}
