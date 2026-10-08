// Vendored from lokalise/i18n-ally @4c504c93 — MIT. See NOTICE.
import { Framework } from './base'
import { LanguageId } from '~/utils'

class JekyllFramework extends Framework {
  id = 'jekyll'
  display = 'Jekyll'

  detection = {
    gemfile: [
      'jekyll-multiple-languages-plugin',
    ],
  }

  languageIds: LanguageId[] = [
    'html',
  ]

  usageMatchRegex = [
    '\\{\\%\\s+t\\s+({key})\\s+\\%\\}',
  ]

  preferredKeystyle = 'nested' as const

  refactorTemplates(keypath: string) {
    return [
      `{% t ${keypath} %}`,
      keypath,
    ]
  }
}

export default JekyllFramework
