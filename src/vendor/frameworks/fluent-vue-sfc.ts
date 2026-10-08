// Vendored from lokalise/i18n-ally @4c504c93 — MIT. See NOTICE.
import { Framework } from './base'

class FluentVueSFCFramework extends Framework {
  id = 'fluent-vue-sfc'
  display = 'fluent-vue SFC'

  detection = {
    packageJSON: [
      'fluent-vue-loader',
      'rollup-plugin-fluent-vue',
      'unplugin-fluent-vue',
    ],
  }

  languageIds = []

  usageMatchRegex = []

  refactorTemplates() {
    return []
  }

  enableFeatures = {
    FluentVueSfc: true,
  }
}

export default FluentVueSFCFramework
