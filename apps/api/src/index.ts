import { createApp } from './app.ts'
import { closeDatabase } from './db/client.ts'
import { runMigrations } from './db/migrate.ts'
import { env } from './env.ts'

/**
 * Migrations run before the server binds, so a container that is accepting traffic is a container
 * whose schema is current. See docs/09-deployment.md.
 */
await runMigrations()

const app = createApp().listen({ port: env.PORT, hostname: '0.0.0.0' })

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
