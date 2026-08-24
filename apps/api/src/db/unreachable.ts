/**
 * The first thing a new contributor gets wrong, so it is worth a real sentence.
 *
 * Forgetting `bun run db:up` surfaces as `connect ECONNREFUSED ::1:55433` — from eleven unrelated
 * test files at once, or from the middle of a migration — which names neither the cause nor the
 * fix. Every entry point that opens a connection routes its failure through here.
 */
export function unreachableDatabase(url: URL, error: unknown): string {
  if (!isRefused(error)) {
    const detail = error instanceof Error ? error.message : String(error)
    return `Could not reach Postgres at ${url.host}: ${detail}`
  }
  return [
    `No Postgres is listening on ${url.host}.`,
    '',
    '  bun run db:up      start the databases',
    '  bun run setup      or set everything up from scratch',
    '',
    'If it is already running, check that the port in .env matches what docker publishes',
    '(`docker compose ps`). See README.md — "Develop".',
  ].join('\n')
}

/** Bun reports a refused TCP connect as an aggregate whose members carry the code. */
function isRefused(error: unknown): boolean {
  if (error instanceof Error && 'code' in error && error.code === 'ECONNREFUSED') return true
  if (error instanceof AggregateError) return error.errors.some((e) => isRefused(e))
  return error instanceof Error && error.cause !== undefined && isRefused(error.cause)
}
