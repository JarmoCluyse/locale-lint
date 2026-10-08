// Scheduler — bounded-concurrency async pool.
//
// Single-process only for now (no worker_threads); kept intentionally
// simple. `HardStringScanner.scanFile` is pure specifically so a future
// worker_threads-backed scheduler can be swapped in behind a flag without
// touching the scan logic.
import os from 'node:os'

export function defaultConcurrency(): number {
  return Math.max(1, Math.min(8, os.cpus().length || 1))
}

export interface SchedulerOptions {
  concurrency?: number
}

/**
 * Run `worker(item)` over `items` with at most `concurrency` in flight at
 * once. Preserves input order in the returned results array regardless of
 * completion order.
 */
export async function runPool<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  options: SchedulerOptions = {},
): Promise<R[]> {
  const concurrency = Math.max(1, options.concurrency ?? defaultConcurrency())
  const results: R[] = new Array(items.length)
  let cursor = 0

  async function runOne() {
    while (true) {
      const index = cursor++
      if (index >= items.length)
        return
      results[index] = await worker(items[index], index)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runOne())
  await Promise.all(workers)
  return results
}

/**
 * Like `runPool`, but consumes an async iterable source (so it composes with
 * `FileEnumerator.enumerateFiles`'s streaming generator without first
 * materialising the full file list).
 */
export async function runPoolStreaming<T, R>(
  source: AsyncIterable<T>,
  worker: (item: T) => Promise<R>,
  options: SchedulerOptions = {},
): Promise<R[]> {
  const concurrency = Math.max(1, options.concurrency ?? defaultConcurrency())
  const iterator = source[Symbol.asyncIterator]()
  const results: R[] = []

  async function runOne() {
    while (true) {
      const { value, done } = await iterator.next()
      if (done)
        return
      results.push(await worker(value))
    }
  }

  const workers = Array.from({ length: concurrency }, () => runOne())
  await Promise.all(workers)
  return results
}
