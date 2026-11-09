import { beforeEach, describe, expect, test } from 'bun:test'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { Exercise, GroupMembership, Workout, page } from '@cedo/contract'
import { db } from './client.ts'
import {
  exerciseFavourites,
  exerciseMedia,
  exerciseMuscles,
  exercises,
  workoutDays,
  workoutEntries,
  workoutFavourites,
  workoutSets,
  workouts,
} from './schema.ts'
import { seedLibrary } from './seed.ts'
import { isForeignKeyRefusal } from '../lib/error.ts'
import { expectContract } from '../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../test/harness.ts'

let h: TestApi
let alice: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
})

const insertExercise = async (name: string, ownerGroupId: string, createdBy: string) => {
  const [row] = await db.insert(exercises).values({ name, ownerGroupId, createdBy }).returning()
  if (row === undefined) throw new Error('insert failed')
  return row
}

/**
 * Regression: `ownable()` declared `updatedAt` with `defaultNow()` and no `$onUpdate`, so the
 * column froze at creation for every ownable entity. Every future "changed since" or sync query
 * would silently have missed every edit.
 */
describe('ownable().updatedAt', () => {
  test('advances on update', async () => {
    const created = await insertExercise('Test Lift', alice.personalGroupId, alice.userId)
    expect(created.updatedAt.getTime()).toBe(created.createdAt.getTime())

    await Bun.sleep(5)
    const [updated] = await db
      .update(exercises)
      .set({ description: 'changed' })
      .where(eq(exercises.id, created.id))
      .returning()

    expect(updated?.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime())
    expect(updated?.createdAt.getTime()).toBe(created.createdAt.getTime())
  })
})

/**
 * Regression: the seed matched exercise names across the WHOLE table, so a user creating an
 * exercise that shares a name with a library entry permanently suppressed it from the shared
 * library on every later upgrade.
 */
describe('seed idempotency is scoped to the seeded group', () => {
  test("a user's own exercise does not suppress the library entry", async () => {
    await insertExercise('Barbell Back Squat', alice.personalGroupId, alice.userId)

    await seedLibrary(h.groupId, h.systemUserId)

    const inLibrary = await db
      .select({ id: exercises.id })
      .from(exercises)
      .where(and(eq(exercises.ownerGroupId, h.groupId), eq(exercises.name, 'Barbell Back Squat')))
    expect(inLibrary).toHaveLength(1)

    const alices = await db
      .select({ id: exercises.id })
      .from(exercises)
      .where(
        and(
          eq(exercises.ownerGroupId, alice.personalGroupId),
          eq(exercises.name, 'Barbell Back Squat'),
        ),
      )
    expect(alices).toHaveLength(1)
  })

  test('re-running the seed adds nothing the second time', async () => {
    const first = await seedLibrary(h.groupId, h.systemUserId)
    expect(first).toBeGreaterThan(40)
    expect(await seedLibrary(h.groupId, h.systemUserId)).toBe(0)
  })

  /**
   * Regression: this exercises `runSeed` END TO END, which the test above deliberately does not.
   * `seedSystemUser` used to return the system account's PERSONAL group on the already-exists path
   * instead of the shared one, so the second run wrote all 45 exercises into the wrong group — 90
   * rows, half of them visible to nobody. Passing an explicit group id, as the test above does,
   * bypasses exactly the function that was wrong.
   */
  test('running the WHOLE seed twice leaves one library, in the shared group', async () => {
    const { runSeed } = await import('./seed.ts')
    await runSeed()
    await runSeed()

    const rows = await db
      .select({ ownerGroupId: exercises.ownerGroupId, name: exercises.name })
      .from(exercises)

    expect(rows.length).toBe(new Set(rows.map((r) => r.name)).size)
    expect(new Set(rows.map((r) => r.ownerGroupId)).size).toBe(1)
    expect(rows[0]?.ownerGroupId).toBe(h.groupId)
  })
})

/**
 * A child of an ownable table carries its parent's owner, so `visible()` applies to it directly
 * rather than by joining through the parent. The owner is never written on its own: a composite
 * foreign key binds it to the parent's, and cascades a transfer down. See
 * docs/adr/0019-visible-relations.md.
 */
describe("a child carries its parent's owner", () => {
  async function crewOf(user: TestUser): Promise<string> {
    const group = await user.wire('/groups', {
      method: 'POST',
      body: JSON.stringify({ name: 'Crew' }),
    })
    return expectContract(GroupMembership, group.body).id
  }

  test('transferring a workout carries the owner down to its days, entries and sets', async () => {
    await seedLibrary(h.groupId, h.systemUserId)
    const library = await alice.wire('/exercises?scope=all&limit=1')
    const shelved = expectContract(page(Exercise), library.body).items[0]
    if (shelved === undefined) throw new Error('the seeded library is empty')

    const created = await alice.wire('/workouts', {
      method: 'POST',
      body: JSON.stringify({ name: 'Block' }),
    })
    const workoutId = expectContract(Workout, created.body).id
    await alice.wire(`/workouts/${workoutId}/plan`, {
      method: 'PUT',
      body: JSON.stringify({
        days: [{ name: 'Day 1', entries: [{ exerciseId: shelved.id, sets: [{ targetReps: 5 }] }] }],
      }),
    })
    const crew = await crewOf(alice)

    const moved = await alice.wire(`/workouts/${workoutId}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: crew }),
    })
    expect(moved.status).toBe(200)

    const days = await db
      .select({ id: workoutDays.id, owner: workoutDays.ownerGroupId })
      .from(workoutDays)
      .where(eq(workoutDays.workoutId, workoutId))
    const entries = await db
      .select({ id: workoutEntries.id, owner: workoutEntries.ownerGroupId })
      .from(workoutEntries)
      .where(
        inArray(
          workoutEntries.dayId,
          days.map((d) => d.id),
        ),
      )
    const sets = await db
      .select({ owner: workoutSets.ownerGroupId })
      .from(workoutSets)
      .where(
        inArray(
          workoutSets.entryId,
          entries.map((e) => e.id),
        ),
      )

    expect(days).toHaveLength(1)
    expect(entries).toHaveLength(1)
    expect(sets).toHaveLength(1)
    expect([...days, ...entries, ...sets].map((r) => r.owner)).toEqual([crew, crew, crew])
  })

  test('transferring an exercise carries the owner down to its muscles', async () => {
    const created = await alice.wire('/exercises', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Split Squat',
        muscles: [
          { muscle: 'quadriceps', loadPct: 70 },
          { muscle: 'gluteus_maximus', loadPct: 30 },
        ],
      }),
    })
    const exerciseId = expectContract(Exercise, created.body).id
    const crew = await crewOf(alice)

    await alice.wire(`/exercises/${exerciseId}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: crew }),
    })

    const muscles = await db
      .select({ owner: exerciseMuscles.ownerGroupId })
      .from(exerciseMuscles)
      .where(eq(exerciseMuscles.exerciseId, exerciseId))
    expect(muscles.map((m) => m.owner)).toEqual([crew, crew])
  })

  test('a child row cannot claim an owner its parent does not have', async () => {
    const exercise = await insertExercise('Mine', alice.personalGroupId, alice.userId)
    const bob = await h.as('bob')

    const refused = await db
      .insert(exerciseMuscles)
      .values({
        exerciseId: exercise.id,
        ownerGroupId: bob.personalGroupId,
        muscleSlug: 'quadriceps',
        loadPct: 100,
      })
      .then(
        () => null,
        (error: unknown) => error,
      )
    expect(isForeignKeyRefusal(refused)).toBe(true)
  })
})

/**
 * ADR-0019's keys as the schema declares them, which is what drizzle-kit writes migrations from,
 * against what the database enforces. The transfers above prove the cascade happens; this proves
 * the code says so too, so the next migration generated from it cannot quietly drop it.
 */
describe('the owner keys the schema declares are the ones the database enforces', () => {
  const children = [exerciseMuscles, exerciseMedia, workoutDays, workoutEntries, workoutSets]

  const enforced = async (names: readonly string[]) =>
    await db.execute<{ name: string; kind: string; onDelete: string; onUpdate: string }>(sql`
      select conname as name, contype as kind, confdeltype as "onDelete", confupdtype as "onUpdate"
        from pg_constraint
       where conname in ${names}
       order by conname
    `)

  test("each child's owner key is its parent's (id, owner), cascading on delete and update", async () => {
    const declared = children.flatMap((table) =>
      getTableConfig(table)
        .foreignKeys.filter((fk) => fk.reference().columns.some((c) => c.name === 'owner_group_id'))
        .map((fk) => ({
          name: fk.getName(),
          to: fk.reference().foreignColumns.map((c) => c.name),
          onDelete: fk.onDelete,
          onUpdate: fk.onUpdate,
        })),
    )
    const names = declared.map((fk) => fk.name).toSorted((a, b) => a.localeCompare(b))
    expect(names).toEqual([
      'exercise_media_exercise_fk',
      'exercise_muscles_exercise_fk',
      'workout_days_workout_fk',
      'workout_entries_day_fk',
      'workout_sets_entry_fk',
    ])
    for (const fk of declared) {
      expect(fk.to).toEqual(['id', 'owner_group_id'])
      expect([fk.onDelete, fk.onUpdate]).toEqual(['cascade', 'cascade'])
    }
    // Postgres spells a cascade 'c'.
    expect([...(await enforced(names))]).toEqual(
      names.map((name) => ({ name, kind: 'f', onDelete: 'c', onUpdate: 'c' })),
    )
  })

  test('what an owner key points at is unique on (id, owner), in the schema and the database', async () => {
    const declared = [exercises, workouts, workoutDays, workoutEntries].flatMap((table) =>
      getTableConfig(table).uniqueConstraints.map((u) => ({
        name: u.getName() ?? '(unnamed)',
        columns: u.columns.map((c) => c.name),
      })),
    )
    const names = declared.map((u) => u.name).toSorted((a, b) => a.localeCompare(b))
    expect(names).toEqual([
      'exercises_id_owner_uq',
      'workout_days_id_owner_uq',
      'workout_entries_id_owner_uq',
      'workouts_id_owner_uq',
    ])
    for (const u of declared) expect(u.columns).toEqual(['id', 'owner_group_id'])
    expect((await enforced(names)).map((c) => c.kind)).toEqual(['u', 'u', 'u', 'u'])
  })

  test('a favourite is one per person and thing, and goes with either', async () => {
    for (const [table, target] of [
      [exerciseFavourites, 'exercises.id'],
      [workoutFavourites, 'workouts.id'],
    ] as const) {
      const config = getTableConfig(table)
      expect(config.primaryKeys.map((pk) => pk.columns.map((c) => c.name))).toEqual([
        ['user_id', 'target_id'],
      ])
      const keys = keysOf(table)
      expect(keys.map((k) => [k.from, k.to, k.onDelete])).toEqual([
        ['target_id', target, 'cascade'],
        ['user_id', 'users.id', 'cascade'],
      ])
      expect((await enforced(keys.map((k) => k.name))).map((c) => c.onDelete)).toEqual(['c', 'c'])
    }
  })

  /** A group or a person with things in their name is never deleted from under those things. */
  test("an ownable's group and creator refuse to be deleted while it exists", async () => {
    for (const table of [exercises, workouts]) {
      const keys = keysOf(table).filter(
        (k) => k.from === 'owner_group_id' || k.from === 'created_by',
      )
      expect(keys.map((k) => [k.from, k.to, k.onDelete])).toEqual([
        ['created_by', 'users.id', 'restrict'],
        ['owner_group_id', 'groups.id', 'restrict'],
      ])
      // Postgres spells a restrict 'r'.
      const names = keys.map((k) => k.name)
      expect((await enforced(names)).map((c) => c.onDelete)).toEqual(['r', 'r'])
    }
  })
})

/** A table's foreign keys as `column → table.column`, by column. */
function keysOf(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table)
    .foreignKeys.map((fk) => {
      const reference = fk.reference()
      return {
        name: fk.getName(),
        from: reference.columns.map((c) => c.name).join(),
        to: `${getTableConfig(reference.foreignTable).name}.${reference.foreignColumns.map((c) => c.name).join()}`,
        onDelete: fk.onDelete,
      }
    })
    .toSorted((a, b) => a.from.localeCompare(b.from))
}
