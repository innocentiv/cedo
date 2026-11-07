/**
 * Loaded before every test file of every `bun test` (bunfig.toml): the suite always runs as
 * NODE_ENV=test.
 *
 * Bun sets it only when nothing has. A shell that exported NODE_ENV, or a parent process that loaded
 * `.env` (NODE_ENV=development) and passed its environment on, would otherwise send the suite —
 * which truncates every table — to the development database: `apps/api/src/env.ts` picks
 * DATABASE_URL over TEST_DATABASE_URL by NODE_ENV alone. That wiped a dev database once (#73).
 */
process.env['NODE_ENV'] = 'test'
