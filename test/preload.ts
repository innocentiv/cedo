/**
 * Loaded before every test file of a `bun test` started at the repository root (bunfig.toml, which
 * Bun reads only from the working directory): the suite runs as NODE_ENV=test. A run started
 * anywhere else is caught by `makeApi` in apps/api/src/test/harness.ts, which refuses without it.
 *
 * Bun sets it only when nothing has. A shell that exported NODE_ENV, or a parent process that loaded
 * `.env` (NODE_ENV=development) and passed its environment on, would otherwise send the suite —
 * which truncates every table — to the development database: `apps/api/src/env.ts` picks
 * DATABASE_URL over TEST_DATABASE_URL by NODE_ENV alone. That wiped a dev database once (#73).
 */
process.env['NODE_ENV'] = 'test'
