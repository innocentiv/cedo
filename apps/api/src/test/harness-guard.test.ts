import { expect, test } from 'bun:test'
import { join } from 'node:path'

/**
 * Regression (#73): the harness truncates every table. `test/preload.ts` forces NODE_ENV=test, but
 * Bun reads `bunfig.toml` only from the directory it runs in, so a `bun test` started in `apps/api`
 * with NODE_ENV=development inherited reached the harness holding DATABASE_URL — the development
 * database. The child below does exactly that, at a scratch database so the proof cannot cost real
 * data, and the harness must refuse before touching it.
 */
test('the harness refuses to run outside NODE_ENV=test, whatever directory bun test starts in', async () => {
  const testUrl = process.env['TEST_DATABASE_URL']
  if (testUrl === undefined) throw new Error('TEST_DATABASE_URL is required')
  const scratch = new URL(testUrl)
  scratch.pathname = '/cedo_test_harness_guard'

  const { BUN_TEST_WORKER_ID: _worker, ...inherited } = process.env
  const child = Bun.spawn(['bun', 'test', './src/test/harness-guard.probe.ts'], {
    cwd: join(import.meta.dir, '../..'),
    env: { ...inherited, NODE_ENV: 'development', DATABASE_URL: scratch.toString() },
    stdout: 'ignore',
    stderr: 'pipe',
  })
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  expect(stderr).toMatch(/^ 1 pass$/mu)
  expect(code).toBe(0)
})
