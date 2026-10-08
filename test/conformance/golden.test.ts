// Conformance suite: re-runs `locale-lint usage`/`locale-lint hardstring`
// over every corpus project under `test/conformance/corpus/` and asserts
// byte-equality against the committed `golden/**` snapshots.
//
// This is NOT just a regression net for this Node implementation — it's the
// executable specification a future Go reimplementation of the scanner must
// match. See docs/conformance.md.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildGolden, CLI_PATH, COMMANDS, discoverAllProjects, goldenPath, serialize,
} from '../../scripts/freeze-golden'

describe('conformance: golden snapshots', () => {
  if (!existsSync(CLI_PATH)) {
    it.skip('dist/cli.cjs not built — run `npm run build` before the conformance suite', () => {})
    return
  }

  const projects = discoverAllProjects()

  it('discovers the expected corpus projects', () => {
    expect(projects.length).toBeGreaterThan(0)
  })

  for (const entry of projects) {
    for (const command of COMMANDS) {
      const label = `${entry.category}/${entry.relPath} (${command})`

      it(`matches golden: ${label}`, () => {
        const outPath = goldenPath(entry, command)
        expect(existsSync(outPath), `Missing golden file for ${label}: ${outPath}. Run \`npm run golden:freeze\`.`).toBe(true)

        const expected = readFileSync(outPath, 'utf8')
        const actual = serialize(buildGolden(entry, command))

        expect(actual).toBe(expected)
      })
    }
  }
})
