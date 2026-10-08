import { CliArgError, parseArgs } from './cli/args'
import { runConfigExplain, runHardstring, runUsage, runScan } from './cli/commands'
import { EXIT_CONFIG_ERROR } from './report/gate'

async function main() {
  const argv = process.argv.slice(2)

  let args
  try {
    args = parseArgs(argv)
  }
  catch (e) {
    if (e instanceof CliArgError) {
      process.stderr.write(`${e.message}\n`)
      process.exitCode = EXIT_CONFIG_ERROR
      return
    }
    throw e
  }

  const result = args.command === 'hardstring'
    ? await runHardstring(args)
    : args.command === 'usage'
      ? await runUsage(args)
      : args.command === 'scan'
        ? await runScan(args)
        : await runConfigExplain(args)

  if (result.stdout)
    process.stdout.write(result.stdout)
  if (result.stderr)
    process.stderr.write(result.stderr)
  process.exitCode = result.exitCode
}

main().catch((e) => {
  process.stderr.write(`Internal error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`)
  process.exitCode = 70
})
