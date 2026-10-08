import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveConfig } from '../../../src/runtime/ConfigResolver'
import { installRuntime, _resetRuntimeForTests } from '../../../src/shims/core-global'
import { CurrentFile, _resetCurrentFileForTests } from '../../../src/shims/current-file'
import { LocaleStore } from '../../../src/engine/LocaleStore'

const FIXTURES = join(__dirname, '..', '..', 'fixtures', 'locales')

async function makeStore(dir: string, cliFlags: Record<string, unknown> = {}) {
  const { config } = resolveConfig({
    root: join(FIXTURES, dir),
    skipVscodeLayer: true,
    skipRootConfigLayer: true,
    cliFlags: { localesPaths: ['locales'], ...cliFlags },
  })
  await installRuntime({ config })
  const store = new LocaleStore(config)
  CurrentFile.loader = store
  return { store, config }
}

describe('LocaleStore', () => {
  afterEach(() => {
    _resetRuntimeForTests()
    _resetCurrentFileForTests()
  })

  describe('flat-json fixture', () => {
    it('discovers locales and keys', async () => {
      const { store } = await makeStore('flat-json')
      await store.load()
      expect(store.locales.sort()).toEqual(['en', 'fr'])
      expect(store.keys.sort()).toEqual(['farewell', 'hello', 'nested.greeting'])
      expect(store.dirStructure).toBe('file')
      expect(store.diagnostics).toEqual([])
    })

    it('getValueByKey resolves per-locale values', async () => {
      const { store } = await makeStore('flat-json')
      await store.load()
      expect(store.getValueByKey('hello', 'en')).toBe('Hello')
      expect(store.getValueByKey('hello', 'fr')).toBe('Bonjour')
      expect(store.getValueByKey('nested.greeting', 'en')).toBe('Good morning')
    })

    it('getNodeByKey / getTranslationsByKey expose per-locale records', async () => {
      const { store } = await makeStore('flat-json')
      await store.load()
      const node = store.getNodeByKey('hello')
      expect(node?.type).toBe('node')
      const translations = store.getTranslationsByKey('hello', false)
      expect(translations.en?.value).toBe('Hello')
      expect(translations.fr?.value).toBe('Bonjour')
    })

    it('files exposes FileInfo for each discovered locale file', async () => {
      const { store } = await makeStore('flat-json')
      await store.load()
      expect(store.files).toHaveLength(2)
      expect(store.files.map(f => f.locale).sort()).toEqual(['en', 'fr'])
    })
  })

  describe('nested-json fixture', () => {
    it('unflattens nested key structure into dotted keys', async () => {
      const { store } = await makeStore('nested-json')
      await store.load()
      expect(store.keys.sort()).toEqual(['farewell', 'hello', 'nested.foo.bar', 'nested.greeting'])
      expect(store.getValueByKey('nested.foo.bar', 'en')).toBe('foobar')
      expect(store.getValueByKey('nested.foo.bar', 'zh-cn')).toBe('foobar-zh')
    })
  })

  describe('yaml-project fixture', () => {
    it('parses .yml and .yaml locale files', async () => {
      const { store } = await makeStore('yaml-project')
      await store.load()
      expect(store.locales.sort()).toEqual(['en', 'fr'])
      expect(store.keys.sort()).toEqual(['animals.cat', 'animals.dog', 'hello'])
      expect(store.getValueByKey('animals.cat', 'en')).toBe('Cat')
      expect(store.getValueByKey('animals.cat', 'fr')).toBe('Chat')
    })
  })

  describe('dir-structure fixture (one directory per locale)', () => {
    it('infers dir structure and merges multiple files per locale dir', async () => {
      const { store } = await makeStore('dir-structure')
      await store.load()
      expect(store.dirStructure).toBe('dir')
      expect(store.locales.sort()).toEqual(['en', 'zh-cn'])
      expect(store.keys.sort()).toEqual(['greeting', 'no', 'yes'])
      expect(store.getValueByKey('yes', 'en')).toBe('Yes')
      expect(store.getValueByKey('yes', 'zh-cn')).toBe('是')
      expect(store.files).toHaveLength(4) // 2 files x 2 locales
    })
  })

  describe('namespaced fixture', () => {
    it('resolves namespace-prefixed keys and getNamespaceFromFilepath', async () => {
      const { store } = await makeStore('namespaced', {
        localesPaths: ['i18n'],
        namespace: true,
        pathMatcher: '{locale}/{namespaces}.(yml|yaml|json)',
      })
      await store.load()

      expect(store.locales.sort()).toEqual(['en', 'fr'])
      expect(store.keys.sort()).toEqual(['foo.bar', 'general.animals.cat', 'general.animals.dog', 'general.hello'])
      expect(store.getValueByKey('general.hello', 'en')).toBe('Hello')
      expect(store.getValueByKey('foo.bar', 'fr')).toBe('Barbaz')

      const fooFile = store.files.find(f => f.namespace === 'foo' && f.locale === 'en')
      expect(fooFile).toBeDefined()
      expect(store.getNamespaceFromFilepath(fooFile!.filepath)).toBe('foo')
    })
  })

  describe('malformed fixture', () => {
    it('surfaces a Diagnostic instead of crashing, and still loads the healthy file', async () => {
      const { store } = await makeStore('malformed')
      await store.load()

      expect(store.diagnostics).toHaveLength(1)
      expect(store.diagnostics[0].severity).toBe('error')
      expect(store.diagnostics[0].file).toBe('locales/en.json')

      // the broken en.json contributed nothing; fr.json still loaded fine
      expect(store.locales).toEqual(['fr'])
      expect(store.keys).toEqual(['hello'])
      expect(store.getValueByKey('hello', 'fr')).toBe('Bonjour')
    })
  })

  describe('reloadFile', () => {
    it('re-parses a single file and patches the tree without a full reload', async () => {
      const { store } = await makeStore('flat-json')
      await store.load()
      expect(store.getValueByKey('hello', 'fr')).toBe('Bonjour')

      const frFile = store.files.find(f => f.locale === 'fr')!
      await store.reloadFile(frFile.filepath)

      expect(store.getValueByKey('hello', 'fr')).toBe('Bonjour')
      expect(store.keys.sort()).toEqual(['farewell', 'hello', 'nested.greeting'])
    })

    it('recovers from a malformed file once reloaded with valid content', async () => {
      const { store } = await makeStore('malformed')
      await store.load()
      expect(store.diagnostics).toHaveLength(1)

      // reloadFile on the already-broken path re-runs the same parse and
      // reproduces the same diagnostic deterministically (no crash, no
      // silent clearing of the error).
      const brokenPath = join(FIXTURES, 'malformed', 'locales', 'en.json')
      await store.reloadFile(brokenPath)
      expect(store.diagnostics).toHaveLength(1)
      expect(store.locales).toEqual(['fr'])
    })

    it('is a no-op for paths outside any discovered locale dir', async () => {
      const { store } = await makeStore('flat-json')
      await store.load()
      const keysBefore = store.keys.sort()
      await store.reloadFile(join(FIXTURES, 'flat-json', 'not-a-locale-dir', 'x.json'))
      expect(store.keys.sort()).toEqual(keysBefore)
    })
  })
})
