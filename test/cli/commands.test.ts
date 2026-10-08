import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args'
import { runHardstring, runConfigExplain } from '../../src/cli/commands'
import { EXIT_NO_FILES_MATCHED, EXIT_HARD_STRING_GATE, EXIT_SUCCESS } from '../../src/report/gate'
import { getLogLevel, workspace } from '../../src/shims/vscode'

const PROJECTS = join(__dirname, '..', 'fixtures', 'projects')

describe('cli commands', () => {
  it('hardstring on the vue fixture exits 3 (gate violated) with default maxHardStrings=0', async () => {
    const args = parseArgs(['hardstring', '--root', join(PROJECTS, 'vue'), '--no-vscode-config', '--quiet'])
    const result = await runHardstring(args)
    expect(result.exitCode).toBe(EXIT_HARD_STRING_GATE)
  })

  it('hardstring with a generous --max-hard-strings exits 0', async () => {
    const args = parseArgs(['hardstring', '--root', join(PROJECTS, 'vue'), '--no-vscode-config', '--quiet', '--max-hard-strings', '100'])
    const result = await runHardstring(args)
    expect(result.exitCode).toBe(EXIT_SUCCESS)
  })

  it('--warn-only forces exit 0 through the CLI', async () => {
    const args = parseArgs(['hardstring', '--root', join(PROJECTS, 'vue'), '--no-vscode-config', '--quiet', '--warn-only'])
    const result = await runHardstring(args)
    expect(result.exitCode).toBe(EXIT_SUCCESS)
  })

  it('exits 11 when no files match (zero files scanned)', async () => {
    const args = parseArgs(['hardstring', '--root', join(PROJECTS, 'vue'), 'this-dir-does-not-exist', '--no-vscode-config', '--quiet'])
    const result = await runHardstring(args)
    expect(result.exitCode).toBe(EXIT_NO_FILES_MATCHED)
  })

  it('emits a JSON report to stdout with --format json', async () => {
    const args = parseArgs(['hardstring', '--root', join(PROJECTS, 'react'), '--no-vscode-config', '--format', 'json', '--max-hard-strings', '100'])
    const result = await runHardstring(args)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.findings.length).toBe(2)
  })

  it('config explain prints resolved config with provenance', async () => {
    const args = parseArgs(['config', 'explain', '--root', join(PROJECTS, 'vue'), '--no-vscode-config'])
    const result = await runConfigExplain(args)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('(default)')
    expect(result.stdout).toContain('rootpath =')
  })

  describe('vscode shim runtime wiring', () => {
    it('sets workspace.workspaceFolders from the resolved rootpath', async () => {
      const root = join(PROJECTS, 'vue')
      const args = parseArgs(['hardstring', '--root', root, '--no-vscode-config', '--quiet', '--max-hard-strings', '100'])
      await runHardstring(args)
      expect(workspace.workspaceFolders?.[0]?.uri.fsPath).toBe(root)
    })

    it('--quiet sets log level to "error"', async () => {
      const args = parseArgs(['hardstring', '--root', join(PROJECTS, 'vue'), '--no-vscode-config', '--quiet', '--max-hard-strings', '100'])
      await runHardstring(args)
      expect(getLogLevel()).toBe('error')
    })

    it('--verbose sets log level to "verbose"', async () => {
      const args = parseArgs(['hardstring', '--root', join(PROJECTS, 'vue'), '--no-vscode-config', '--verbose', '--max-hard-strings', '100'])
      await runHardstring(args)
      expect(getLogLevel()).toBe('verbose')
    })

    it('defaults to log level "warn" without --quiet/--verbose', async () => {
      const args = parseArgs(['hardstring', '--root', join(PROJECTS, 'vue'), '--no-vscode-config', '--max-hard-strings', '100'])
      await runHardstring(args)
      expect(getLogLevel()).toBe('warn')
    })

    it('config explain also wires workspace rootpath + log level', async () => {
      const root = join(PROJECTS, 'react')
      const args = parseArgs(['config', 'explain', '--root', root, '--no-vscode-config', '--quiet'])
      await runConfigExplain(args)
      expect(workspace.workspaceFolders?.[0]?.uri.fsPath).toBe(root)
      expect(getLogLevel()).toBe('error')
    })
  })
})
