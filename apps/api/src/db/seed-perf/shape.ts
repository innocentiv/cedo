import { sql } from 'drizzle-orm'
import { db } from '../client.ts'
import type { Caller } from '../../plugins/auth.ts'

/**
 * A realistic-volume database, for `bun run perf` only.
 *
 * Missing indexes and accidental N+1s are invisible at development volumes — a sequential scan over
 * 500 rows takes microseconds, every test passes, and the problem first appears on a stranger's
 * NAS. This seed exists so the performance suite measures the plans real users get.
 * See docs/10-testing.md.
 *
 * EVERY VALUE IS DERIVED ARITHMETICALLY from a row number. No randomness, not even a seeded PRNG:
 * the same command produces byte-identical data, so a query plan that changed between two runs
 * changed because the code changed.
 *
 * Written as bulk `insert ... select ... from generate_series` rather than ORM value lists, which
 * would take minutes for a quarter of a million rows. This is the one file where raw SQL is the
 * right tool; everything the application itself runs goes through Drizzle.
 */

export const PERF_VOLUME = {
  /** Background users, each with a personal group and a reader membership in the shared group. */
  users: 500,
  /** The shared library. The list-and-search hot path reads this. */
  sharedExercises: 10_000,
  musclesPerExercise: 3,
  workouts: 1000,
  daysPerWorkout: 3,
  entriesPerDay: 8,
  setsPerEntry: 3,
  sessionsPerUser: 10,
  logsPerSession: 48,
  /** Browser sessions per user, so the auth token lookup is measured against a real index. */
  tokensPerUser: 5,
  favouritesPerUser: 5,
} as const

/** What the suite sizes itself against; it refuses to measure a database smaller than this. */
export const PERF_TARGET_SET_LOGS =
  PERF_VOLUME.users * PERF_VOLUME.sessionsPerUser * PERF_VOLUME.logsPerSession

/**
 * The two callers every N+1 invariant is measured against.
 *
 * They differ ONLY in volume along the dimension that would cause the N+1 — plan size, page size,
 * history depth, group count. Query counts must be identical for both.
 * See docs/adr/0018-n1-detection.md.
 */
export interface PerfProfile {
  readonly label: ProfileLabel
  readonly caller: Caller
  /** A real session token, so the auth path can be measured end to end. */
  readonly token: string
  readonly workoutId: string
  readonly sessionId: string
  /** The exercise carrying this profile's deepest log history. */
  readonly exerciseId: string
}

export interface PerfFixtures {
  readonly small: PerfProfile
  readonly large: PerfProfile
  readonly sharedGroupId: string
  readonly setLogCount: number
}

export type ProfileLabel = 'small' | 'large'

export interface Shape {
  readonly exercises: number
  readonly days: number
  readonly entries: number
  readonly sessions: number
  readonly logsPerSession: number
  /** Memberships beyond the personal and shared groups, to vary the auth query's fan-out. */
  readonly extraGroups: number
}

export const SHAPE: Record<ProfileLabel, Shape> = {
  small: { exercises: 10, days: 1, entries: 3, sessions: 5, logsPerSession: 9, extraGroups: 1 },
  large: {
    exercises: 1000,
    days: 14,
    entries: 40,
    sessions: 200,
    logsPerSession: 60,
    extraGroups: 50,
  },
}

/**
 * `password_hash` is deliberately not a valid argon2id digest: nobody signs in as a perf fixture,
 * and hashing 500 passwords properly would dominate the seed's runtime for no benefit.
 */
export const UNUSABLE_HASH = 'unusable'

/**
 * Names are composed from two small word lists so trigram search has something realistic to match.
 * A library of 10,000 rows all named "Exercise 4711" makes the GIN index look far better than it
 * is, because no substring is ever shared.
 */
export const EQUIPMENT = `(array['Barbell','Dumbbell','Cable','Machine','Kettlebell','Bodyweight'])[1 + i % 6]`
export const MOVEMENT = `(array['Bench Press','Row','Squat','Curl','Overhead Press','Fly','Extension','Lateral Raise','Pulldown','Deadlift'])[1 + i % 10]`

export async function countRows(table: 'set_logs' | 'muscles'): Promise<number> {
  return Number(await scalar(sql.raw(`select count(*)::text from ${table}`)))
}

export async function countExercises(ownerGroupId: string): Promise<number> {
  return Number(
    await scalar(
      sql`select count(*)::text from exercises where owner_group_id = ${ownerGroupId}::uuid`,
    ),
  )
}

export async function countEntries(workoutId: string): Promise<number> {
  return Number(
    await scalar(sql`
      select count(*)::text from workout_entries en
        join workout_days d on d.id = en.day_id
       where d.workout_id = ${workoutId}::uuid
    `),
  )
}

export async function scalar(query: ReturnType<typeof sql>): Promise<string | null> {
  const rows = await db.execute<Record<string, string | null>>(query)
  const first = rows[0]
  if (first === undefined) return null
  return Object.values(first)[0] ?? null
}

export async function required(query: ReturnType<typeof sql>, what: string): Promise<string> {
  const value = await scalar(query)
  if (value === null) throw new Error(`The performance seed could not create or find ${what}.`)
  return value
}

/**
 * Three muscles per exercise, picked by modular arithmetic over the seeded muscle list, with load
 * percentages summing to 100 exactly as the contract requires.
 *
 * The row counts are read first and inlined as literals rather than joined on a `count(*) over ()`
 * column: a modulus against a windowed column is not an equijoin, so the planner falls back to a
 * nested loop that rescans the whole list once per row.
 */
export async function attachMuscles(ownerGroupId: string): Promise<void> {
  const muscleCount = await countRows('muscles')

  await db.execute(sql`
    with numbered as (
      select id, (row_number() over (order by name))::int as rn
        from exercises where owner_group_id = ${ownerGroupId}::uuid
    ), m as (
      select slug, (row_number() over (order by sort_index))::int - 1 as rn from muscles
    )
    insert into exercise_muscles (exercise_id, muscle_slug, load_pct)
    select n.id, m.slug, (array[60, 25, 15])[position + 1]
      from numbered n
      cross join generate_series(0, ${PERF_VOLUME.musclesPerExercise - 1}) as position
      join m on m.rn = (n.rn * 3 + position) % ${muscleCount}
    on conflict do nothing
  `)
}
