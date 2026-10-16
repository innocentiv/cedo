import { expect } from 'bun:test'
import { z } from 'zod'
import type { RecordedQuery } from '../db/client.ts'
import { sql } from '../db/client.ts'

/**
 * Query-plan assertions for the performance suite.
 *
 * These EXPLAIN the statements a SERVICE ACTUALLY ISSUED, captured by the query recorder, rather
 * than a hand-written query that resembles it. A copy drifts the moment the service changes, and
 * then asserts that an index is used by a query nobody runs.
 *
 * An index EXISTING is not an index BEING USED: an added index that the planner rejects looks
 * identical in the schema and identical in a fast test, and only shows up as a sequential scan on
 * someone else's machine. See docs/10-testing.md.
 */

/** Postgres emits far more per node than this; only the fields any assertion reads are modelled. */
interface PlanNode {
  readonly nodeType: string
  readonly relation: string | null
  readonly indexName: string | null
  readonly actualRows: number
  readonly children: PlanNode[]
}

const RawNode = z.looseObject({
  'Node Type': z.string(),
  'Relation Name': z.string().optional(),
  'Index Name': z.string().optional(),
  'Actual Rows': z.number().optional(),
  Plans: z.array(z.unknown()).optional(),
})

const RawPlan = z.array(
  z.looseObject({
    Plan: z.unknown(),
    'Planning Time': z.number().optional(),
    'Execution Time': z.number().optional(),
  }),
)

export interface QueryPlan {
  readonly sql: string
  readonly root: PlanNode
  readonly planningMs: number
  /** Null when the statement was not run under ANALYZE — see `explain`. */
  readonly executionMs: number | null
}

/**
 * Only read-only statements are run under ANALYZE. ANALYZE executes the statement, so explaining a
 * write that way would perform it — silently doubling an insert in the middle of a measurement.
 *
 * `with` counts, because a CTE is usually a read: `with ranked as (…) select …` is the shape three
 * services use. Matching on `select` alone excluded those from the timing budget AND reported their
 * node rows as zero, since a plan produced without ANALYZE carries estimates and no actual counts —
 * a silent hole in exactly the queries complex enough to need a CTE.
 *
 * A data-modifying CTE (`with x as (insert … returning …)`) is excluded by the second test. It is
 * deliberately a crude keyword scan: being wrong towards "do not ANALYZE" costs a timing, while
 * being wrong the other way performs a write in the middle of a measurement.
 */
function readOnly(statement: string): boolean {
  if (!/^\s*(select|with)\b/iu.test(statement)) return false
  return !/\b(insert|update|delete)\s/iu.test(statement)
}

/** Where a statement is explained: the pool, or one transaction replaying a whole call. */
type Runner = Pick<typeof sql, 'unsafe'>

export async function explain(query: RecordedQuery, runner: Runner = sql): Promise<QueryPlan> {
  const analyze = readOnly(query.sql)
  const options = analyze ? 'ANALYZE, BUFFERS, FORMAT JSON' : 'FORMAT JSON'
  const rows = await runner.unsafe(`explain (${options}) ${query.sql}`, query.params.map(toParam))

  // Postgres returns the document under a column named "QUERY PLAN", already parsed by postgres.js.
  const document = RawPlan.parse(rows.flatMap((r) => asRecord(r)['QUERY PLAN']))
  const first = document[0]
  if (first === undefined) throw new Error(`Postgres returned no plan for: ${query.sql}`)

  return {
    sql: query.sql,
    root: toNode(first.Plan),
    planningMs: first['Planning Time'] ?? 0,
    executionMs: analyze ? (first['Execution Time'] ?? 0) : null,
  }
}

/**
 * A call's statements, explained IN ORDER in ONE transaction. A statement can depend on the session
 * state an earlier one set — the library audit's `select set_config('pg_trgm.similarity_threshold',
 * …, true)` changes what `%` matches, and so the plan. Explained one by one on pooled connections,
 * every statement after it was measured at the default setting: a plan nobody runs. Under ANALYZE
 * the `set_config` executes, so the replay carries the setting exactly as the service did.
 */
export async function explainInOrder(statements: readonly RecordedQuery[]): Promise<QueryPlan[]> {
  return await sql.begin(async (tx) => {
    const plans: QueryPlan[] = []
    for (const statement of statements) {
      // In order, deliberately: each statement must see the state the one before it left.
      // oxlint-disable-next-line no-await-in-loop
      plans.push(await explain(statement, tx))
    }
    return plans
  })
}

/** postgres.js rows are objects; typed as `unknown` so reading one column stays honest. */
const RawRow = z.looseObject({})

function asRecord(row: unknown): Record<string, unknown> {
  return RawRow.parse(row)
}

/**
 * The recorder stores parameters as `unknown`, which is what Drizzle's logger hands over. Anything
 * that is not already a scalar Postgres understands is serialised — in practice that is only the
 * jsonb progression rule.
 */
function toParam(value: unknown): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  return value instanceof Date ? value : JSON.stringify(value)
}

function toNode(raw: unknown): PlanNode {
  const parsed = RawNode.parse(raw)
  return {
    nodeType: parsed['Node Type'],
    relation: parsed['Relation Name'] ?? null,
    indexName: parsed['Index Name'] ?? null,
    actualRows: parsed['Actual Rows'] ?? 0,
    children: (parsed.Plans ?? []).map((child) => toNode(child)),
  }
}

function walk(node: PlanNode): PlanNode[] {
  return [node, ...node.children.flatMap((child) => walk(child))]
}

/**
 * A readable plan tree, printed with every failure. A bare "expected true to be false" tells the
 * next person nothing about which node went wrong.
 */
export function planSummary(plan: QueryPlan): string {
  return [plan.sql.replaceAll(/\s+/gu, ' ').slice(0, 240), ...nodeLines(plan.root, 1)].join('\n')
}

function nodeLines(node: PlanNode, depth: number): string[] {
  const relation = node.relation === null ? '' : ` on ${node.relation}`
  const index = node.indexName === null ? '' : ` using ${node.indexName}`
  return [
    `${'  '.repeat(depth)}${node.nodeType}${relation}${index} (rows=${node.actualRows})`,
    ...node.children.flatMap((child) => nodeLines(child, depth + 1)),
  ]
}

/**
 * A sequential scan is not automatically wrong — on a small table it is the right plan, and
 * asserting against it there would be cargo cult. It IS wrong on the tables this suite seeds to
 * production volume, which is why the table has to be named explicitly.
 */
export function expectNoSeqScan(plan: QueryPlan, table: string): void {
  const offending = walk(plan.root).filter((n) => n.nodeType === 'Seq Scan' && n.relation === table)
  expect(
    offending,
    `Sequential scan on "${table}" at production volume:\n${planSummary(plan)}`,
  ).toEqual([])
}

/**
 * The index must deliver `table`'s rows already in ORDER BY order, so `LIMIT` stops the walk at the
 * page size. A Sort above a scan of the table means every matching row was read and sorted to
 * return one page — and the index is still "used", so `expectIndexUsed` passes. That is how
 * `workout_sessions_user_time_idx` shipped: built `DESC NULLS LAST` under an `ORDER BY … DESC`
 * (which means NULLS FIRST), it never served the order it was added for.
 */
export function expectNoSortOver(plan: QueryPlan, table: string): void {
  const scansTable = (node: PlanNode) => walk(node).some((n) => n.relation === table)
  const offending = walk(plan.root).filter(
    (n) => (n.nodeType === 'Sort' || n.nodeType === 'Incremental Sort') && scansTable(n),
  )
  expect(
    offending,
    `"${table}" is sorted after reading instead of walked in index order:\n${planSummary(plan)}`,
  ).toEqual([])
}

export function expectIndexUsed(plan: QueryPlan, index: string): void {
  const used = walk(plan.root).some((n) => n.indexName === index)
  expect(used, `Index "${index}" was not used:\n${planSummary(plan)}`).toBe(true)
}

/**
 * The slowest of a set of already-explained plans, by measured execution time.
 *
 * A budget belongs here rather than on the wall clock of the service call, which also contains the
 * round trips and varies with the machine. Plans without a measured time — the writes, explained
 * without ANALYZE — cannot be compared and are skipped rather than counted as zero.
 */
export function slowestOf(plans: readonly QueryPlan[]): number {
  const timed = plans.filter((p) => p.executionMs !== null)
  return timed.reduce((worst, p) => Math.max(worst, p.executionMs ?? 0), 0)
}
