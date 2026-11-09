import { describe, expect, test } from 'bun:test'
import { unreachableDatabase } from './unreachable.ts'

const url = new URL('postgres://cedo@localhost:55433/cedo_test')
const refused = () =>
  Object.assign(new Error('connect ECONNREFUSED ::1:55433'), { code: 'ECONNREFUSED' })

/** What a contributor reads when the databases are not up — the cause and the fix, not a stack. */
describe('unreachableDatabase', () => {
  test('a refused connection says nothing is listening, and how to start the databases', () => {
    const lines = unreachableDatabase(url, refused()).split('\n')
    expect(lines[0]).toBe('No Postgres is listening on localhost:55433.')
    expect(lines).toContain('  bun run db:up      start the databases')
  })

  test('reads a refusal inside the aggregate Bun reports, and one carried as a cause', () => {
    const first = 'No Postgres is listening on localhost:55433.'
    expect(unreachableDatabase(url, new AggregateError([refused()]))).toStartWith(first)
    expect(unreachableDatabase(url, new Error('failed', { cause: refused() }))).toStartWith(first)
  })

  test('any other failure names the host and says what went wrong', () => {
    expect(unreachableDatabase(url, new Error('the database "cedo_test" does not exist'))).toBe(
      'Could not reach Postgres at localhost:55433: the database "cedo_test" does not exist',
    )
    expect(unreachableDatabase(url, 'timeout')).toBe(
      'Could not reach Postgres at localhost:55433: timeout',
    )
  })
})
