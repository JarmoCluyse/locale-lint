// Vendored from lokalise/i18n-ally @4c504c93 — MIT. See NOTICE.
import { DetectionResult } from '~/core/types'

const keys = ['start', 'end', 'fullStart', 'fullEnd'] as const

export function shiftDetectionPosition(result: DetectionResult[], offest: number) {
  return result.map((i) => {
    const data = { ...i }
    for (const key of keys) {
      if (data[key] != null)
        data[key] += offest
    }
    return data
  })
}
