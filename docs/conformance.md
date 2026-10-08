# Conformance suite (golden snapshots)

## What this is

`locale-lint` vendors i18n-ally's scanning engine. Upstream i18n-ally has
effectively **no test coverage** for the usage scanner, the locale loader,
the format parsers, or the majority of its ~33 supported frameworks. That
means there is no reliable reference to check this Node port against — and,
more importantly for the project's stated goal, **no safety net to port
against** if/when the usage scanner is reimplemented in Go for
whole-repo-scan speed in CI.

This suite exists to create that safety net: it freezes `locale-lint`'s
*actual CLI output* (stdout, stderr, exit code) across a corpus of real(ish)
example projects, commits the frozen output as `golden/**`, and asserts
byte-equality against it on every test run.

**This is the contract a Go reimplementation of the scanner must match.**
Not "read the TypeScript and infer behavior" — match these committed
snapshots, byte for byte, including exit codes.

## The corpus

`test/conformance/corpus/` is a verbatim copy of upstream i18n-ally's own
example projects, from the same vendored commit (`4c504c93` / `2.13.1`) as
the rest of this repo's `src/vendor/**`:

- `by-frameworks/` — 27 miniature real projects, one per supported
  framework: `vue-i18n`, `vue-i18n-sfc`, `react-i18next`, `next-intl`,
  `next-international`, `next-translate`, `svelte`, `laravel`,
  `ruby-on-rails`, `flutter`, `ngx-translate`, `ngneat-transloco`,
  `lingui-nextjs`, `i18next-shopify`, `i18n-js`, `jekyll`, `ui5`,
  `chrome-extension`, `php-po`, `vuex-i18n`, `angular`, `custom`, `ember`,
  `fluent-vue`, `fluent-vue-sfc`, `non-i18n-project`.
- `by-features/` — 18 targeted edge-case corpora: `flatten-mode`,
  `dir-locales`, `custom-locales-path`, `path-matcher` (2 sub-projects),
  `module-style`, `json5`, `yaml`, `encoding`, `linked`, `collections`,
  `100-locales`, `tag-system-bcp47`, `js-parser`, `js-parser-dir`,
  `extractions`, `flatten-scope-conflict`, `custom-scope-range`, `demo`.

45 total corpus projects. See `test/conformance/corpus/ATTRIBUTION.md` for
license/provenance details — these are copied in (not read from a separate
checkout) so the suite is reproducible from a fresh clone.

The corpus was **not modified** to make it scan better: no
`locale-lint.config.json` files were added, no framework hints injected.
Whatever auto-detection does with each project as upstream shipped it is
exactly what's frozen. That's deliberate — see "Coverage census" below.

## Regenerating

```sh
npm run golden:freeze   # builds the CLI, re-runs it over the corpus, overwrites golden/**
npm run golden:check    # builds the CLI, re-runs it, diffs against golden/** (exit 1 on mismatch, no writes)
```

`golden:check` is the one to wire into CI.

## The rule: review every diff, never blindly re-freeze

`golden:freeze` will happily overwrite a golden file that's "wrong" just as
easily as it writes one that's right. **A failing `golden:check` is a
signal to stop and read the diff, not a signal to run `golden:freeze` and
move on.** Possible causes of a legitimate diff:

- An intentional, reviewed behavior change in the vendored engine, a shim,
  or config resolution — re-freeze, and call out the semantic change in the
  PR description.
- An accidental regression from unrelated vendored-code/shim changes — fix
  the regression, don't re-freeze over it.

If you re-freeze without reading *why* the diff happened, you've silently
turned a regression into "the new normal" and the Go port (or the next
person) inherits the bug as spec.

## Determinism

Golden files must be stable across repeated freezes on the same code,
regardless of machine/checkout path. Two things make that work:

- The vendored engine already produces relative paths, sorted output, and
  no timestamps for its JSON report (`--format json`) — this was verified
  separately as part of the engine's own test suite.
- One known non-determinism source was found and scrubbed: a few shim
  diagnostics (`src/shims/core-global.ts`) embed `config.rootpath`, which is
  the absolute path the CLI was invoked from. Since the corpus lives inside
  this checkout, that absolute path differs by clone location.
  `scripts/freeze-golden.ts` replaces the project's own absolute path with
  the literal string `<PROJECT_ROOT>` in both stdout and stderr before
  anything is serialized.

Verify determinism yourself with `npm run golden:freeze && git status` (no
diff) run twice in a row, or `npm run golden:freeze && npm run golden:check`.

## Coverage census (frozen at time of writing)

90 CLI invocations (45 projects × `usage` + `hardstring`).

**Exit codes seen:** `0` (clean run — not necessarily "no findings", can
also mean "zero violations against default thresholds"), `1`/`2`/`4`
(usage gate violations: missing/unused/both), `3` (hard-string gate
violation), `11` (`EXIT_NO_FILES_MATCHED` — **nothing to scan at all**).

**Empty results** (ran cleanly, `filesScanned > 0`, but found zero
findings/missing/unused/used-keys — worth a second look, each is either
"legitimately nothing to flag" or "detection silently failed"):

| Project | Command | Likely explanation |
|---|---|---|
| `by-features/100-locales` | hardstring | plausible — fixture is markup/locale-heavy, little JS |
| `by-features/dir-locales` | hardstring | same |
| `by-features/flatten-scope-conflict` | hardstring | same |
| `by-features/path-matcher/locale-namespaces` | hardstring | same |
| `by-features/path-matcher/namespaces-locale` | hardstring | same |
| `by-features/tag-system-bcp47` | hardstring | same |
| `by-frameworks/angular` | usage | **investigated, legitimate** — see "Angular/chrome-extension verdicts" below |
| `by-frameworks/chrome-extension` | usage + hardstring | **investigated, legitimate (for this corpus)** — see below |
| `by-frameworks/custom` | hardstring | plausible, custom-regex fixture is usage-focused |
| `by-frameworks/non-i18n-project` | usage | **expected** — the project is deliberately not an i18n project |

### Angular / chrome-extension verdicts

**`by-frameworks/angular` (usage, empty) — legitimate, not a bug.** There is
no vendored `angular` framework at all (`src/vendor/frameworks/` has
`ngx-translate` and `ngneat-transloco` for Angular *libraries*, but nothing
for Angular's own built-in `i18n`/`i18n="@@id"` template-attribute +
compile-time-XLIFF mechanism, which is what this fixture actually uses —
see `src/app/app.component.html`). Upstream i18n-ally itself has no
usage-detection support for that convention; there is no regex gap to fix
here, because there is no framework definition to fix it in. Confirmed by
inspecting the fixture's markup directly (no `t(...)`/`translate` pipe calls
anywhere, only native `i18n` attributes).

**`by-frameworks/chrome-extension` (usage + hardstring, both empty) —
legitimate for *this* corpus project, but exposes a real, structural
limitation.** The vendored `chrome-ext` framework
(`src/vendor/frameworks/chrome-ext.ts`) DOES exist, with the right
`usageMatchRegex` (`chrome\.i18n\.getMessage\(...)`/`i18n\.getMessage\(...)`)
that would correctly match `popup.js`'s `chrome.i18n.getMessage('errorRemoved')`
calls. The problem: `chrome-ext.ts`'s `detection = {}` (same pattern as
`php-gettext`/`custom`) means it is **never** auto-detected from
package/manifest dependencies — it only activates via an explicit
`frameworks`/`enabledFrameworks` config entry. `by-frameworks/php-po` has
exactly this same `detection = {}` shape, but ships a
`.vscode/settings.json` with `"i18n-ally.enabledFrameworks": ["php-gettext"]`
to compensate — `by-frameworks/chrome-extension` has **no** `.vscode/`
directory at all (confirmed: only `manifest.json`, `_locales/`, `popup.js`).
Per this suite's own rule ("no per-project config was added to work around
any of the above"), this is not something to patch by adding config to the
corpus. hard-string: `popup.js` genuinely contains no hard-coded
user-facing strings (just `chrome.i18n.getMessage` calls), so that half is
independently legitimate regardless of the above. **Remains Tier 2** —
the framework is vendored and its regex is presumably correct, but nothing
in this corpus exercises it.

### Fixed: the 5-framework zero-files-scanned bug

Previously, 5 of the 27 by-framework fixtures (`ember`, `flutter`,
`laravel`, `php-po`, `ruby-on-rails` — all non-JS-source frameworks)
produced zero scanned files and exited `11` (`EXIT_NO_FILES_MATCHED`) for
*both* scanners, despite framework *detection* succeeding for several of
them. Root cause: the file-enumeration glob (`FileEnumerator.ts`'s
`DEFAULT_SCAN_PATTERNS`) was a hardcoded, JS/TS/Vue/Svelte-centric default,
with nothing deriving it from the frameworks that were actually
detected/configured.

**Fix:** `src/runtime/SourceGlob.ts` (`computeSourcePatterns`) derives the
glob from the union of `DEFAULT_SOURCE_EXTENSIONS` (the old hardcoded set —
always included, so no JS/TS project can regress) and every
detected/configured framework's `languageIds`, mapped to on-disk
extensions via a local table (kept independent from
`src/vendor/utils/LanguageId.ts`'s `LanguageIdExtMap`, which maps `blade` to
bare `php` — correct for upstream's "what annotation language is this
already-open document" use case, wrong for *file discovery*, where
`.blade.php` needs to be found specifically as `blade`, not folded into
`.php`). Both scanners (`src/engine/index.ts`'s `scanProject`,
`src/engine/UsageScanner.ts`'s `scanUsageProject`) now compute
`config.usage.include ?? computeSourcePatterns(config)` instead of a bare
default; `usage.include` is a new, optional `ResolvedConfig` field (wired
through all four config layers via the existing generic dot-path merge) for
callers who want to bypass derivation entirely.

A second, necessary companion fix: `DocumentFactory.ts` now resolves
`.hbs` files to the `handlebars` languageId (the Ember framework's declared
`languageIds` includes `handlebars`, but `shims/vscode.ts`'s
`languageIdByExtension` table — read-only, out of this fix's write scope —
has no `.hbs` entry at all, so without this, `.hbs` files would have been
discovered by the new glob but still silently produce zero usage keys,
since `Global.isLanguageIdSupported('plaintext')` is always false).

A third, necessary companion fix: `src/runtime/ConfigResolver.ts` now
bridges the `enabledFrameworks` config field (populated from the real
upstream vscode setting name, `i18n-ally.enabledFrameworks` — which
`by-frameworks/php-po`'s fixture sets) into `frameworks` (the field the
shim's `Global.enabledFrameworks` actually reads — see
`src/shims/core-global.ts`). These were two distinct, independently-defined
`ResolvedConfig` fields; `enabledFrameworks` was being parsed out of config
layers but never consumed anywhere, silently discarding exactly the config
entry `php-po` depends on to activate its `detection = {}` framework. The
bridge only fires when **every** requested id is a real vendored framework
id (see "Reviewed, intentional diffs" below for why that guard exists).

**Before/after file counts** (measured via `usage --format text`,
`<N> file(s) scanned`):

| Project | Before | After |
|---|---|---|
| `by-frameworks/laravel` | 0 (exit 11) | 4 |
| `by-frameworks/php-po` | 0 (exit 11) | 1 |
| `by-frameworks/ruby-on-rails` | 0 (exit 11) | 1 |
| `by-frameworks/flutter` | 0 (exit 11) | 1 |
| `by-frameworks/ember` | 0 (exit 11) | 1 |

All 5 now produce real, sensible findings instead of a hard failure —
`ruby-on-rails` and `flutter` surface genuine missing-key findings;
`laravel`, `php-po`, and `ember` scan cleanly with real usage-key extraction
(`ember`'s `{{ t '...' }}` / `this.intl.t(...)` are now correctly detected
once `.hbs` resolves to the `handlebars` languageId).

### Golden-diff review (re-frozen after the above fixes)

13 of 90 golden files changed (not 10 — see below for the 3 beyond the 5
target frameworks). Every diff was individually reviewed; none are
accidental regressions:

- **`ember`, `flutter`, `laravel`, `php-po`, `ruby-on-rails` (usage +
  hardstring, 10 files): improvements, as intended.** Exit `11` →
  real scan results (see table above). This is the fix this work set out
  to make.
- **`ui5` (usage + hardstring, 2 files): improvement, previously-undetected
  side effect of the same glob fix.** `ui5`'s vendored framework declares
  `languageIds: ['json', 'xml', 'javascript', 'typescript']` — but `.xml`
  and (non-manifest) `.json` were never in the old default glob either.
  `ui5`'s actual usage keys live in `webapp/App.view.xml`
  (`{i18n>title}`/`{i18n>steady}`, UI5's binding syntax) and
  `webapp/manifest.json` (`{{appTitle}}`) — files that were silently never
  scanned before. `usedKeyCount` went from 1 (only whatever happened to
  live in the one `.js` file) to 4 (title/steady/appTitle correctly
  recovered); `missingCount`/`unusedCount` stayed `0`/`0`. `ui5` moves from
  "nominally Tier 1 but under-scanned" to genuinely, fully exercised.
- **`by-features/custom-scope-range` (usage, 1 file): reviewed, intentional
  — a config-resolution fidelity fix, not a regression.** This fixture's
  `.vscode/settings.json` sets `"i18n-ally.enabledFrameworks": ["react",
  "i18next", "custom"]` — three REAL vendored framework ids (`react` is
  `react-intl`'s id, confirmed via `src/vendor/frameworks/react-intl.ts`).
  Before the `enabledFrameworks` bridge (see above), this setting was
  silently discarded and auto-detection took over instead, happening to
  detect `['i18next', 'react-i18next', 'custom']` from `package.json`
  dependencies — notably including `react-i18next`, which this project's
  code actually imports and whose scope/rewrite-key logic is what resolves
  `customScopeRangeFn(['translation:foo'])`-scoped `t('bar')` calls down to
  `translation.foo.bar`. Once `enabledFrameworks` is honored (matching
  upstream's own documented precedence: explicit config always wins over
  auto-detection), the explicit list is used instead — `react`+`i18next`
  rather than `react-i18next` — and that combination's scope-handling
  doesn't resolve those two calls, surfacing 2 "new" missing keys
  (`bar`, `title`) and one newly-"unused" locale key. This is a genuine
  upstream-config quirk in the fixture itself (an outdated/mismatched
  `enabledFrameworks` list relative to what the project's code actually
  does), now correctly surfaced instead of accidentally masked by a dead
  config field. Re-frozen as-is, not treated as a regression to chase —
  but documented here precisely because the instruction was "never blindly
  re-freeze."
  - This diff is also *why* the `enabledFrameworks` → `frameworks` bridge
    in `ConfigResolver.ts` has an "every requested id must be a real
    framework id" guard: without it, this same bridge would have *also*
    broken on fixtures where `enabledFrameworks` lists ids that don't exist
    at all (silently dropping to an unintended, smaller framework set) —
    the guard makes the bridge a no-op (falls back to auto-detection,
    preserving prior behavior exactly) whenever the configured list doesn't
    fully resolve, rather than ever silently acting on a partial match.
- A related, non-behavioral stderr-only issue was found and fixed in the
  same pass: calling `computeSourcePatterns` from the hard-string scanner
  (which deliberately never calls `installRuntime()` — see
  `FileEnumerator.ts`) triggers the vendored `custom` framework's
  file-existence-based detection (`CustomFramework.load()` →
  `Config.encoding`), which throws inside vendored code that catches its
  own exception and logs it via `Log.error` — functionally harmless (exit
  code/findings unaffected) but it would have added new, irrelevant stderr
  noise to any hard-string run of a project with a
  `.vscode/i18n-ally-custom-framework.yml` (`by-frameworks/i18n-js` in this
  corpus). Fixed by silencing the shim's log level for the duration of that
  one internal detection call only (`src/runtime/SourceGlob.ts`).

No other golden file changed. Verified by reverting the behavioral source
changes in a scratch checkout, rebuilding, and running the full 90-invocation
census against the newly-frozen `golden/**` — exactly these 13 files
differed, matching this list file-for-file.

**No per-project config was added** to work around any of the above — the
task was to measure auto-detection honestly, not to make the census look
better. The one fixture that structurally required splitting rather than
config (`by-features/path-matcher/`) was split into its two independent
sub-projects (`locale-namespaces/`, `namespaces-locale/`) because it has no
project manifest of its own, only two nested ones.

## Tier 1 (verified by this corpus) vs Tier 2 (unverified)

**Tier 1 — genuinely exercised, non-empty, sensible results from at least
one corpus project:** vue-i18n, vue-i18n-sfc, react-i18next, next-intl,
next-international, next-translate, svelte, ngx-translate, ngneat-transloco,
lingui-nextjs, i18next-shopify, i18n-js, jekyll, ui5, vuex-i18n, fluent-vue,
fluent-vue-sfc, custom (usage side), **ember, flutter, laravel, php-po,
ruby-on-rails** (moved from Tier 2 by the source-glob/languageId/config-bridge
fixes above), plus all the `by-features` edge cases except where flagged
above.

**Tier 2 — vendored but not exercised meaningfully by this corpus:**
chrome-extension (`chrome.i18n` convention — framework is vendored and
correct, but this corpus project has no `.vscode/settings.json` to activate
its `detection = {}` framework, and none was added per this suite's own
rule), angular (usage side — no vendored framework supports Angular's
native `i18n`-attribute/XLIFF convention at all; not a gap introduced by
this engine).

Treat Tier 2 frameworks as "the parser/loader code is vendored and present,
but this suite does not demonstrate it producing correct output." A Go port
should not claim parity with these until the Node side is actually fixed
and re-frozen first.
