// Implements the `CurrentFile.loader` seam used by vendored code
// (6 call sites per docs/shim-surface.md: core/Analyst.ts, core/KeyDetector.ts,
// core/Nodes.ts, utils/Regex.ts, utils/prompts.ts x2).
//
// Upstream's `CurrentFile` tracks the VS Code active editor/document and
// exposes a `ComposedLoader` over the active locale tree. In this headless
// CLI there is no "current file" concept — the scan driver assigns
// `CurrentFile.loader` once per run (or per workspace root) before invoking
// any vendored scanning code.
//
// INJECTION SEAM: the real `LocaleStore` / loader implementation lands in a
// later lane. For now this module only defines the settable slot and throws
// a clear error if read before assignment — a silently-undefined loader
// would make every vendored lookup crash in a confusing way deep inside
// vendor code instead of here, at the seam.

import type { Loader } from '../vendor/core/loaders/Loader'

let _loader: Loader | undefined

function getLoader(): Loader {
  if (!_loader) {
    throw new Error(
      '[shims/current-file] "CurrentFile.loader" was read before being assigned. '
      + 'The scan driver must set `CurrentFile.loader = <Loader>` for the current '
      + 'run before invoking vendored scanning code (src/vendor/**).',
    )
  }
  return _loader
}

function setLoader(loader: Loader) {
  _loader = loader
}

/** Test-only: reset the assigned loader so tests don't leak state. */
export function _resetCurrentFileForTests() {
  _loader = undefined
}

export const CurrentFile: { loader: Loader } = {
  get loader() {
    return getLoader()
  },
  set loader(loader: Loader) {
    setLoader(loader)
  },
}
