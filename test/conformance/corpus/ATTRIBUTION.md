# Corpus attribution

Everything under `test/conformance/corpus/by-frameworks/` and
`test/conformance/corpus/by-features/` is a verbatim copy of upstream
example projects from the [lokalise/i18n-ally](https://github.com/lokalise/i18n-ally)
VS Code extension:

- Source: `examples/by-frameworks/**` and `examples/by-features/**`
- Upstream commit: `4c504c93` (tag `2.13.1`) — the same commit this repo
  vendors scanning-engine source from (see `../../../NOTICE`).
- License: MIT (same as the rest of i18n-ally).

These are small, self-contained demo projects upstream authored to exercise
each supported framework (vue-i18n, react-i18next, next-intl, laravel,
ruby-on-rails, flutter, ...) and each notable scanning feature (flatten
mode, custom locale paths, path matchers, 100-locale scale, encodings,
linked keys, etc.). They were copied here unmodified (`node_modules/` and
`.git/` stripped) so the conformance suite in `test/conformance/golden.test.ts`
is reproducible from a fresh clone, without depending on a separate
`i18n-ally` checkout being present on disk.

No source code in this directory was written by this project; it is
reproduced here solely as a test fixture corpus, under the terms of
i18n-ally's MIT license.
