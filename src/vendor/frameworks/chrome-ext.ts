// Vendored from lokalise/i18n-ally @4c504c93 — MIT. See NOTICE.
import { RewriteKeySource } from '../core/types'
import { Framework } from './base'
import { LanguageId } from '~/utils'

class ChromeExtensionFramework extends Framework {
  id = 'chrome-ext'
  display = 'Chrome Extension'

  detection = {}

  languageIds: LanguageId[] = [
    'javascript',
    'typescript',
    'html',
  ]

  usageMatchRegex = [
    'i18n\\.getMessage\\(\\s*[\'"`]({key})[\'"`]',
  ]

  refactorTemplates(keypath: string) {
    return [
      `chrome.i18n.getMessage('${keypath}')`,
      `browser.i18n.getMessage('${keypath}')`,
      keypath,
    ]
  }

  rewriteKeys(key: string, source: RewriteKeySource) {
    if (source === 'reference' && !key.endsWith('.message'))
      return `${key}.message`
    if (source === 'write' && !key.endsWith('.message'))
      return `${key}.message`
    if (source === 'source' && key.endsWith('.message'))
      return key.slice(0, -'.message'.length - 1)
    return key
  }
}

export default ChromeExtensionFramework
