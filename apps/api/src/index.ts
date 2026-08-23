import { createApp } from './app.ts'
import { closeDatabase } from './db/client.ts'
import { runMigrations } from './db/migrate.ts'
import { env } from './env.ts'
import { MAX_UPLOAD_BYTES } from './lib/media.ts'

/**
 * Migrations run before the server binds, so a container that is accepting traffic is a container
 * whose schema is current. See docs/09-deployment.md.
 */
await runMigrations()

/**
 * A transport-level body cap, which is the only place this can be enforced honestly. The 12 MB
 * check inside `processImage` runs AFTER the whole body has been buffered — and buffered twice,
 * once by `formData()` and once by `arrayBuffer()`. Without a cap here, an authenticated client
 * POSTing a 2 GB body allocates all of it before the check, and a few concurrent requests exhaust
 * the small box this is meant to run on.
 *
 * Set slightly above MAX_UPLOAD_BYTES to leave room for multipart framing, so a file at exactly
 * the documented limit is rejected by `processImage` with a readable message rather than by the
 * transport with a bare 413.
 */
const MAX_BODY_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024

const app = createApp().listen({
  port: env.PORT,
  hostname: '0.0.0.0',
  maxRequestBodySize: MAX_BODY_BYTES,
})

console.log(`cedo api listening on :${env.PORT} (${env.NODE_ENV})`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      await app.stop()
      await closeDatabase()
      process.exit(0)
    })()
  })
}
