// Bundler interop shim: esbuild's `--platform=node` interop heuristic
// (`__toESM(mod, /* isNodeMode */ 1)`) always treats a default import of a
// CJS module as the *whole* `module.exports` object, mirroring plain
// `require()`. That is correct for most CJS packages, but `@babel/traverse`
// both sets `__esModule: true` *and* a real `exports.default` — which per-file
// transpilers (tsx/tsc/ts-node, used in dev and in tests) correctly resolve
// through `.default`, while esbuild's bundler-level default-import rewrite
// does not. Concretely: `import traverse from '@babel/traverse'` ends up
// bound to the whole exports object (not callable) once bundled, even though
// `src/vendor/extraction/parsers/babel.ts` (upstream, unmodified — out of
// our write scope) calls it directly as a function.
//
// Rather than patch the vendored call site, we alias the bare specifier
// `@babel/traverse` to this shim at bundle time (see package.json's `build`
// script `--alias:@babel/traverse=...`), which re-exports the *real*
// callable default so the existing `import traverse from '@babel/traverse'`
// + `traverse(ast, ...)` call sites work unmodified in both dev (tsx) and
// the bundled CLI binary.
// eslint-disable-next-line ts/no-require-imports
// @ts-expect-error — plain .js file, no declaration shipped at this subpath
import traverseModule from '../../node_modules/@babel/traverse/lib/index.js'

// Peel back however many layers of bundler default-import interop wrapping
// got applied (0, 1, or 2 — depends on bundler vs. per-file transpiler), by
// walking `.default` until we land on an actual function.
function unwrap(mod: unknown): any {
  let cur = mod
  for (let i = 0; i < 3 && cur && typeof cur !== 'function'; i++)
    cur = (cur as any).default
  return cur
}

const resolved = unwrap(traverseModule)

export default resolved as typeof traverseModule
