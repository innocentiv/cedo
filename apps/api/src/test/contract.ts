import { expect } from 'bun:test'
import type { z } from 'zod'

/**
 * Assert a response matches the schema the CLIENT will parse it with.
 *
 * Used in every integration test. Because the frontend deliberately does not import the API's
 * types (see docs/adr/0015-no-eden-treaty.md), this is what stops the two sides drifting: the API
 * cannot change a response shape without a test failing here first.
 */
export function expectContract<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`Response does not match the published contract:\n${issues}`)
  }
  expect(result.success).toBe(true)
  return result.data
}
