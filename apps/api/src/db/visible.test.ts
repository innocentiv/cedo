import { beforeEach, describe, expect, test } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { Exercise, GroupMembership, Workout } from '@cedo/contract'
import { db } from './client.ts'
import { groupMembers } from './schema.ts'
import {
  visibleExerciseMuscles,
  visibleExercises,
  visibleWorkoutDays,
  visibleWorkoutEntries,
  visibleWorkoutSets,
  visibleWorkouts,
} from './visible.ts'
import { resolveCaller } from '../plugins/auth.ts'
import { expectContract } from '../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../test/harness.ts'

/**
 * The visible relations are the only way a read path sees an owned table, so what they return IS
 * the access rule. Each is checked from both sides: the rows a caller may read are there, and the
 * rows they may not are not — including after losing the group that granted them.
 * See docs/adr/0019-visible-relations.md.
 */

let h: TestApi
let alice: TestUser
let bob: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
  bob = await h.as('bob')
})

interface Holdings {
  readonly exerciseId: string
  readonly workoutId: string
}

/** One exercise and a one-day, one-entry, one-set plan using it, all owned by `groupId`. */
async function holdingsIn(user: TestUser, groupId: string, name: string): Promise<Holdings> {
  const exercise = await user.wire('/exercises', {
    method: 'POST',
    body: JSON.stringify({ name, muscles: [{ muscle: 'quadriceps', loadPct: 100 }] }),
  })
  const exerciseId = expectContract(Exercise, exercise.body).id

  const workout = await user.wire('/workouts', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  const workoutId = expectContract(Workout, workout.body).id
  await user.wire(`/workouts/${workoutId}/plan`, {
    method: 'PUT',
    body: JSON.stringify({
      days: [{ name: 'Day', entries: [{ exerciseId, sets: [{ targetReps: 5 }] }] }],
    }),
  })

  if (groupId !== user.personalGroupId) {
    for (const what of ['exercises', 'workouts'] as const) {
      const id = what === 'exercises' ? exerciseId : workoutId
      await user.wire(`/${what}/${id}/transfer`, {
        method: 'POST',
        body: JSON.stringify({ toGroupId: groupId }),
      })
    }
  }
  return { exerciseId, workoutId }
}

/** Every owned row hanging off these holdings, as the caller's relations return them. */
async function whatCallerSees(caller: TestUser['caller'], held: Holdings) {
  const exercises = visibleExercises(caller)
  const muscles = visibleExerciseMuscles(caller)
  const workouts = visibleWorkouts(caller)
  const days = visibleWorkoutDays(caller)
  const entries = visibleWorkoutEntries(caller)
  const sets = visibleWorkoutSets(caller)

  const [exerciseRows, muscleRows, workoutRows, dayRows] = await Promise.all([
    db.select({ id: exercises.id }).from(exercises).where(eq(exercises.id, held.exerciseId)),
    db
      .select({ id: muscles.exerciseId })
      .from(muscles)
      .where(eq(muscles.exerciseId, held.exerciseId)),
    db.select({ id: workouts.id }).from(workouts).where(eq(workouts.id, held.workoutId)),
    db.select({ id: days.id }).from(days).where(eq(days.workoutId, held.workoutId)),
  ])
  const entryRows =
    dayRows.length === 0
      ? []
      : await db
          .select({ id: entries.id })
          .from(entries)
          .where(
            inArray(
              entries.dayId,
              dayRows.map((d) => d.id),
            ),
          )
  const setRows =
    entryRows.length === 0
      ? []
      : await db
          .select({ id: sets.id })
          .from(sets)
          .where(
            inArray(
              sets.entryId,
              entryRows.map((e) => e.id),
            ),
          )

  return {
    exercises: exerciseRows.length,
    muscles: muscleRows.length,
    workouts: workoutRows.length,
    days: dayRows.length,
    entries: entryRows.length,
    sets: setRows.length,
  }
}

const everything = { exercises: 1, muscles: 1, workouts: 1, days: 1, entries: 1, sets: 1 }
const nothing = { exercises: 0, muscles: 0, workouts: 0, days: 0, entries: 0, sets: 0 }

describe('visible relations', () => {
  test('return what is in your own groups', async () => {
    const held = await holdingsIn(alice, alice.personalGroupId, 'Alices')
    expect(await whatCallerSees(alice.caller, held)).toEqual(everything)
  })

  test("return none of another user's private rows, children included", async () => {
    const held = await holdingsIn(alice, alice.personalGroupId, 'Alices')
    expect(await whatCallerSees(bob.caller, held)).toEqual(nothing)
  })

  test('follow a membership: granted by joining, taken back by leaving', async () => {
    const created = await alice.wire('/groups', {
      method: 'POST',
      body: JSON.stringify({ name: 'Crew' }),
    })
    const crew = expectContract(GroupMembership, created.body).id
    await alice.wire(`/groups/${crew}/members`, {
      method: 'POST',
      body: JSON.stringify({ username: bob.username, role: 'reader' }),
    })
    const held = await holdingsIn(alice, crew, 'Crews')

    const member = await resolveCaller(`Bearer ${bob.token}`)
    if (member === null) throw new Error('bob could not be resolved')
    expect(await whatCallerSees(member, held)).toEqual(everything)

    await db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, crew), eq(groupMembers.userId, bob.userId)))
    const removed = await resolveCaller(`Bearer ${bob.token}`)
    if (removed === null) throw new Error('bob could not be resolved')
    expect(await whatCallerSees(removed, held)).toEqual(nothing)
  })

  test('a left join keeps the row and nulls the name; an inner join drops the row', async () => {
    const held = await holdingsIn(alice, alice.personalGroupId, 'Alices')
    const ids = [held.workoutId, crypto.randomUUID()]
    const workouts = visibleWorkouts(bob.caller)

    // The relation stands in for a table in a join exactly as the domain model's two shapes ask.
    const subject = await db
      .select({ id: workouts.id })
      .from(workouts)
      .where(inArray(workouts.id, ids))
    expect(subject).toEqual([])

    const days = visibleWorkoutDays(alice.caller, 'own_days')
    const decorated = await db
      .select({ day: days.id, workout: workouts.name })
      .from(days)
      .leftJoin(workouts, eq(workouts.id, days.workoutId))
      .where(eq(days.workoutId, held.workoutId))
    expect(decorated).toHaveLength(1)
    expect(decorated[0]?.workout).toBeNull()
  })
})
