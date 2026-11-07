import { expect, test } from 'bun:test'
import { makeApi } from './harness.ts'

/**
 * Run only by `harness-guard.test.ts`: from `apps/api`, where the root bunfig's preload does not
 * apply, with NODE_ENV=development and DATABASE_URL at a scratch database. Not a `*.test.ts`, so the
 * suite's own run never picks it up.
 */
test('the harness refuses a database outside NODE_ENV=test', async () => {
  // Captured, not `expect(…).rejects`: an unawaited `rejects` can pass without ever running.
  const refused = await makeApi().then(
    () => null,
    (error: unknown) => error,
  )
  expect(String(refused)).toContain('truncates every table')
})
