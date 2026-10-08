import { describe, expect, it } from 'vitest'
import { detectDynamicKeyUsages } from '../../../src/engine/usage/dynamicKeys'

describe('detectDynamicKeyUsages', () => {
  it('detects template-literal interpolation in a translate call', () => {
    const text = 'const x = t(`errors.${code}`)'
    const result = detectDynamicKeyUsages('a.ts', text)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ file: 'a.ts', line: 1 })
  })

  it('detects string-concatenation call shapes', () => {
    const text = "const x = t('errors.' + code)"
    const result = detectDynamicKeyUsages('a.ts', text)
    expect(result).toHaveLength(1)
  })

  it('does not flag a plain static-string call', () => {
    const text = "const x = t('errors.notFound')"
    const result = detectDynamicKeyUsages('a.ts', text)
    expect(result).toHaveLength(0)
  })

  it('still detects dynamic calls written only inside comments (no comment-stripping)', () => {
    const text = '// t(`errors.${code}`) is dynamic'
    const result = detectDynamicKeyUsages('a.ts', text)
    expect(result).toHaveLength(1)
  })

  it('computes correct line/column for matches past the first line', () => {
    const text = 'line one\nline two\nconst x = t(`errors.${code}`)'
    const result = detectDynamicKeyUsages('a.ts', text)
    expect(result[0].line).toBe(3)
  })

  it('is a pure function of (path, text) — same input always yields the same output', () => {
    const text = 'const x = t(`errors.${code}`)'
    const a = detectDynamicKeyUsages('a.ts', text)
    const b = detectDynamicKeyUsages('a.ts', text)
    expect(a).toEqual(b)
  })
})
