import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectFrameworks } from '../../src/runtime/FrameworkDetector'

const FIXTURES = join(__dirname, '..', 'fixtures', 'frameworks')

describe('detectFrameworks (Tier 1)', () => {
  it('detects vue (vue-i18n)', () => {
    const detected = detectFrameworks({ rootpath: join(FIXTURES, 'vue') })
    expect(detected.map(f => f.id)).toContain('vue')
  })

  it('detects react-i18next', () => {
    const detected = detectFrameworks({ rootpath: join(FIXTURES, 'react-i18next') })
    expect(detected.map(f => f.id)).toContain('react-i18next')
  })

  it('detects next-intl', () => {
    const detected = detectFrameworks({ rootpath: join(FIXTURES, 'next-intl') })
    expect(detected.map(f => f.id)).toContain('next-intl')
  })

  it('detects svelte (svelte-i18n)', () => {
    const detected = detectFrameworks({ rootpath: join(FIXTURES, 'svelte') })
    expect(detected.map(f => f.id)).toContain('svelte')
  })

  it('detects transloco (angular)', () => {
    const detected = detectFrameworks({ rootpath: join(FIXTURES, 'transloco-angular') })
    expect(detected.map(f => f.id)).toContain('transloco')
  })

  it('detects laravel', () => {
    const detected = detectFrameworks({ rootpath: join(FIXTURES, 'laravel') })
    expect(detected.map(f => f.id)).toContain('laravel')
  })

  it('detects NOTHING for a non-i18n project (vue without vue-i18n)', () => {
    const detected = detectFrameworks({ rootpath: join(FIXTURES, 'non-i18n-project') })
    expect(detected).toEqual([])
  })

  it('detects NOTHING for an empty/no-manifest directory', () => {
    const detected = detectFrameworks({ rootpath: join(FIXTURES, 'does-not-exist') })
    expect(detected).toEqual([])
  })

  it('monorepo: detects a framework from a sub-package implied by localesPaths, not just the root manifest', () => {
    const root = join(FIXTURES, 'monorepo')
    const detected = detectFrameworks({
      rootpath: root,
      localesPaths: ['packages/app/locales'],
    })
    expect(detected.map(f => f.id)).toContain('vue')
  })

  it('monorepo: does not false-positive without a matching localesPaths entry', () => {
    const root = join(FIXTURES, 'monorepo')
    const detected = detectFrameworks({ rootpath: root })
    expect(detected.map(f => f.id)).not.toContain('vue')
  })

  it('returns frameworks in a deterministic (canonical vendored-array) order regardless of input order variance', () => {
    const root = join(FIXTURES, 'monorepo')
    const a = detectFrameworks({ rootpath: root, localesPaths: ['packages/app/locales'] })
    const b = detectFrameworks({ rootpath: root, localesPaths: ['packages/app/locales'] })
    expect(a.map(f => f.id)).toEqual(b.map(f => f.id))
  })
})
