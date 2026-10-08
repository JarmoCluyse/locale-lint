import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * src/vendor/** is a MACHINE-GENERATED artifact (see scripts/vendor-sync.ts).
 * This test regenerates it into a scratch directory and asserts byte-for-byte
 * equality with the committed tree. It fails loudly if anyone hand-edits
 * src/vendor/** without going through the codemod, or if upstream/--out
 * drifts from what's committed.
 */

const UPSTREAM = process.env.I18N_ALLY_UPSTREAM ?? '/tmp/i18n-ally'
const COMMITTED_DIR = 'src/vendor'
const SCRATCH_DIR = 'src/vendor.__integrity_test__'

function listFiles(dir: string, base = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(dir, base), { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory())
      out.push(...listFiles(dir, rel))
    else
      out.push(rel)
  }
  return out
}

describe('vendor integrity', () => {
  it('regenerating src/vendor/** from upstream matches the committed tree exactly', () => {
    if (!statSync(UPSTREAM, { throwIfNoEntry: false })) {
      // Upstream checkout not available in this environment — skip rather
      // than false-fail CI that doesn't have /tmp/i18n-ally.
      console.warn(`[vendor-integrity] upstream not found at ${UPSTREAM}, skipping`)
      return
    }

    rmSync(SCRATCH_DIR, { recursive: true, force: true })
    try {
      execFileSync(
        'npx',
        ['tsx', 'scripts/vendor-sync.ts', '--upstream', UPSTREAM, '--out', SCRATCH_DIR],
        { stdio: 'pipe' },
      )

      const committedFiles = listFiles(COMMITTED_DIR).sort()
      const scratchFiles = listFiles(SCRATCH_DIR).sort()

      expect(scratchFiles).toEqual(committedFiles)

      for (const rel of committedFiles) {
        const committed = readFileSync(join(COMMITTED_DIR, rel), 'utf8')
        const scratch = readFileSync(join(SCRATCH_DIR, rel), 'utf8')
        expect(scratch, `mismatch in ${rel} — did someone hand-edit src/vendor? Run npm run vendor:sync`).toEqual(committed)
      }
    }
    finally {
      rmSync(SCRATCH_DIR, { recursive: true, force: true })
    }
  }, 60_000)
})
