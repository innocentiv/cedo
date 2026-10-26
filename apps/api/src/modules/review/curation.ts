import { asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { DEFAULT_GROUP_SLUG, MUSCLES } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { groups } from '../../db/schema.ts'
import { visibleExerciseMedia, visibleExerciseMuscles, visibleExercises } from '../../db/visible.ts'
import { notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'

/**
 * What a curator needs to READ before they write.
 *
 * The expensive failure when an AI seeds a library is not a missing capability — it is creating
 * "Barbell Bench Press" next to an existing "Bench Press", or attributing muscles inconsistently
 * across similar movements. This turns curation into review-then-fix rather than blind creation.
 * See docs/07-mcp.md.
 */

/** Trigram similarity above which two names are worth a human look. Empirically ~0.45 is noisy. */
const DUPLICATE_THRESHOLD = 0.55

/** Fewer exercises than this for a muscle and the library cannot program around an injury. */
const THIN_COVERAGE = 2

export interface LibraryAudit {
  readonly groupId: string
  readonly total: number
  /** How many exercises the duplicate scan actually compared. Below `total` means it was capped. */
  readonly scannedForDuplicates: number
  readonly possibleDuplicates: {
    readonly a: string
    readonly b: string
    readonly similarity: number
  }[]
  readonly thinCoverage: { readonly muscle: string; readonly exercises: number }[]
  readonly missingInstructions: string[]
  readonly missingMedia: string[]
  /** Nobody has said what they need (#33), so they are doable for everyone, and filter nothing. */
  readonly undescribedEquipment: string[]
  readonly singleMuscle: string[]
}

export async function libraryAudit(caller: Caller, groupId: string): Promise<LibraryAudit> {
  if (!caller.groupIds.includes(groupId)) throw notFound('group')

  const { rows, duplicates, byMuscle, withMedia, muscleCountById } = await loadAudit(
    caller,
    groupId,
  )

  return {
    groupId,
    total: rows.length,
    scannedForDuplicates: duplicates[0]?.scanned ?? Math.min(rows.length, AUDIT_SCAN_LIMIT),
    possibleDuplicates: duplicates.map((d) => ({
      a: d.a,
      b: d.b,
      similarity: Math.round(d.similarity * 100) / 100,
    })),
    // Every muscle, including those with zero exercises — an absent muscle is the worst gap and
    // would not appear in a GROUP BY over what exists.
    thinCoverage: MUSCLES.map((m) => ({ muscle: m.slug, exercises: byMuscle.get(m.slug) ?? 0 }))
      .filter((m) => m.exercises < THIN_COVERAGE)
      .toSorted((a, b) => a.exercises - b.exercises),
    missingInstructions: rows.filter((r) => r.instructions.trim() === '').map((r) => r.name),
    missingMedia: rows.filter((r) => !withMedia.has(r.id)).map((r) => r.name),
    undescribedEquipment: rows.filter((r) => r.equipment === null).map((r) => r.name),
    /**
     * A compound lift attributed to exactly one muscle is usually an incomplete entry rather than
     * a genuine isolation movement, so it is worth a look — not an error.
     */
    singleMuscle: rows.filter((r) => (muscleCountById.get(r.id) ?? 0) === 1).map((r) => r.name),
  }
}

/**
 * The reads, split by concern so neither half is a wall. Each is the visible relation narrowed to
 * the one group — the audited group is a subset of what the caller can read, never a way around it.
 */
async function loadAudit(caller: Caller, groupId: string) {
  const [rows, duplicates, counts] = await Promise.all([
    loadExercises(caller, groupId),
    findNearDuplicates(caller, groupId),
    loadCompleteness(caller, groupId),
  ])
  return { rows, duplicates, ...counts }
}

async function loadExercises(caller: Caller, groupId: string) {
  const exercises = visibleExercises(caller)
  return await db
    .select({
      id: exercises.id,
      name: exercises.name,
      instructions: exercises.instructions,
      equipment: exercises.equipment,
    })
    .from(exercises)
    .where(eq(exercises.ownerGroupId, groupId))
    .orderBy(asc(exercises.name))
}

/**
 * Near-duplicate detection, bounded on purpose.
 *
 * Written as a plain self-join with `similarity(a, b) >= x` this is O(n^2) with the trigram index
 * unused: measured at 5,000 exercises it examined 6.5 MILLION row pairs. A LATERAL join with the
 * `%` operator lets the trigram index look up each candidate's matches instead. Two details decide
 * whether it actually does — both measured on the perf seed's curated library, 10,000 distinct
 * names (`seed-perf/curated.ts`, `bun run perf:report`):
 *
 * - NO per-candidate LIMIT. With `limit 5` the planner gambled on walking the library in name order
 *   and stopping at the fifth match — cheap when names come in near-identical runs, ruinous when
 *   they are distinct: every candidate walked all 10,000 rows, and the scan took 23s. Without the
 *   limit there is no early stop to bet on, and the trigram index wins: 0.28s.
 * - The threshold SET to this scan's own bar. `%` matches at `pg_trgm.similarity_threshold`, 0.3
 *   unless set, so the index handed back every loose match only for the scan to reject it: 1.04s
 *   instead of 0.28s. Under the old limit the first five could all be rejects, hiding a true
 *   duplicate behind them — `curation.test.ts` holds that.
 *
 * The cost now grows with the duplicates actually present: a library of thousands of numbered
 * near-identical names (the perf seed's shared one) takes seconds, and is reporting junk anyway.
 *
 * The cap below is REPORTED to the caller rather than applied silently — a truncated audit that
 * looks complete is worse than one that says what it skipped.
 */
const AUDIT_SCAN_LIMIT = 2000

async function findNearDuplicates(caller: Caller, groupId: string) {
  const rows = await db.transaction(async (tx) => {
    // `set_config(…, true)` is SET LOCAL with a bound value: it ends with this transaction.
    await tx.execute(
      sql`select set_config('pg_trgm.similarity_threshold', ${String(DUPLICATE_THRESHOLD)}, true)`,
    )
    return await tx.execute<{ a: string; b: string; similarity: number; scanned: number }>(sql`
    with candidates as (
      select id, name, owner_group_id
        from ${visibleExercises(caller, 'pool')}
       where owner_group_id = ${groupId}
       order by name
       limit ${AUDIT_SCAN_LIMIT}
    )
    select a.name as a, x.name as b, similarity(a.name, x.name) as similarity,
           (select count(*) from candidates)::int as scanned
      from candidates a
      cross join lateral (
        select b.name
          from ${visibleExercises(caller, 'b')}
         where b.owner_group_id = a.owner_group_id
           and b.id > a.id
           and b.name % a.name
      ) x
     where similarity(a.name, x.name) >= ${DUPLICATE_THRESHOLD}
     order by similarity(a.name, x.name) desc
     limit 50
  `)
  })

  return DuplicateRows.parse(rows)
}

const DuplicateRows = z.array(
  z.object({
    a: z.string(),
    b: z.string(),
    similarity: z.coerce.number(),
    scanned: z.coerce.number(),
  }),
)

/**
 * Coverage per muscle, which exercises carry media, and how many muscles each is attributed. A
 * muscle or media link carries its exercise's owner, so each reads its own relation with no join
 * back to the exercise.
 */
async function loadCompleteness(caller: Caller, groupId: string) {
  const muscles = visibleExerciseMuscles(caller)
  const coverage = await db
    .select({
      muscle: muscles.muscleSlug,
      count: sql<number>`count(distinct ${muscles.exerciseId})`.mapWith(Number),
    })
    .from(muscles)
    .where(eq(muscles.ownerGroupId, groupId))
    .groupBy(muscles.muscleSlug)
  const byMuscle = new Map(coverage.map((c) => [c.muscle, c.count]))

  const attached = visibleExerciseMedia(caller)
  const withMedia = new Set(
    (
      await db
        .select({ exerciseId: attached.exerciseId })
        .from(attached)
        .where(eq(attached.ownerGroupId, groupId))
    ).map((m) => m.exerciseId),
  )

  const muscleCounts = await db
    .select({
      exerciseId: muscles.exerciseId,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(muscles)
    .where(eq(muscles.ownerGroupId, groupId))
    .groupBy(muscles.exerciseId)
  const muscleCountById = new Map(muscleCounts.map((m) => [m.exerciseId, m.count]))

  return { byMuscle, withMedia, muscleCountById }
}

/**
 * The seeded shared group, resolved by slug so nothing hardcodes its id.
 *
 * Being an EDITOR of it is what makes someone a curator: they may edit the shared library and read
 * instance diagnostics. There is no separate admin flag — see docs/07-mcp.md.
 */
export async function sharedGroupId(): Promise<string | null> {
  const [row] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.slug, DEFAULT_GROUP_SLUG))
    .limit(1)
  return row?.id ?? null
}

export async function requireCurator(caller: Caller): Promise<string> {
  const id = await sharedGroupId()
  if (id === null || !caller.editorGroupIds.includes(id)) {
    throw notFound('curator access')
  }
  return id
}
