import { expect, test } from 'bun:test'

/**
 * Run only by `test/environment.test.ts`, in a child `bun test` that inherits NODE_ENV=development.
 * Not a `*.test.ts`, so the suite's own run never picks it up.
 */
test('the suite runs as NODE_ENV=test whatever it inherited', () => {
  expect(process.env['NODE_ENV']).toBe('test')
})
