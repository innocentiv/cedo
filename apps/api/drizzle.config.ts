import { defineConfig } from 'drizzle-kit'

// NOTE: drizzle-kit runs this file under Node, not Bun, so `Bun.env` is unavailable here.

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? '',
  },
  strict: true,
  verbose: true,
})
