// Vendored from lokalise/i18n-ally @4c504c93 — MIT. See NOTICE.
import { resolve, join } from 'path'
import fs from 'fs-extra'
// @ts-expect-error
import { glob } from 'glob-gitignore'
// @ts-expect-error
import parseGitIgnore from 'parse-gitignore'
import { Config } from '../../shims/core-global'
import { Global } from '../../shims/core-global'
import { Log } from './Log'

export async function gitignoredGlob(globStr: string, dir: string) {
  const root = Global.rootpath
  const gitignorePath = join(root, '.gitignore')
  let gitignore = []
  try {
    if (fs.existsSync(gitignorePath))
      gitignore = parseGitIgnore(await fs.promises.readFile(gitignorePath))
  }
  catch (e) {
    Log.error(e)
  }

  const ignore = [
    'node_modules',
    'dist',
    ...gitignore,
    ...Global.localesPaths || [],
    ...Config.usageScanningIgnore,
  ]

  const files = await glob(globStr, {
    cwd: dir,
    ignore,
  }) as string[]

  return files.map(f => resolve(dir, f))
}
