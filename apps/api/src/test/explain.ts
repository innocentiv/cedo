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
 */
const readOnly = (statement: string): boolean => /^\s*select\b/iu.test(statement)

export async function explain(query: RecordedQuery): Promise<QueryPlan> {
  const analyze = readOnly(query.sql)
  const options = analyze ? 'ANALYZE, BUFFERS, FORMAT JSON' : 'FORMAT JSON'
  const rows = await sql.unsafe(`explain (${options}) ${query.sql}`, query.params.map(toParam))

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
 * The recorder stores parameters as `unknown`, which is what Drizzle's logger hands over. Anything
 * that is not already a scalar Postgres understands is serialised — in practice that is only the
 * jsonb progression rule.
 */
/** postgres.js rows are objects; typed as `unknown` so the read of one column stays honest. */
function asRecord(row: unknown): Record<string, unknown> {
  return RawRow.parse(row)
}

const RawRow = z.looseObject({})

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

export function expectIndexUsed(plan: QueryPlan, index: string): void {
  const used = walk(plan.root).some((n) => n.indexName === index)
  expect(used, `Index "${index}" was not used:\n${planSummary(plan)}`).toBe(true)
}

/** The statements from one recorded call that touch a table, in the order they were issued. */
export function statementsFor(
  statements: readonly RecordedQuery[],
  table: string,
): RecordedQuery[] {
  return statements.filter((s) => new RegExp(`\\b"?${table}"?\\b`, 'u').test(s.sql))
}

/**
 * The single slowest statement of a recorded call, by measured execution time. This is what a
 * budget should be asserted against: the total wall clock of a service call also contains the
 * round trips, which vary with the machine.
 */
export async function slowestPlan(statements: readonly RecordedQuery[]): Promise<QueryPlan> {
  const plans = await Promise.all(
    statements.filter((s) => readOnly(s.sql)).map(async (s) => await explain(s)),
  )
  const slowest = plans.toSorted((a, b) => (b.executionMs ?? 0) - (a.executionMs ?? 0))[0]
  if (slowest === undefined) throw new Error('The call issued no read-only statements to explain.')
  return slowest
}
