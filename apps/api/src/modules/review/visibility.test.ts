import { beforeEach, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client.ts'
import { seedLibrary } from '../../db/seed.ts'
import { groupMembers, workoutDays } from '../../db/schema.ts'
import { Exercise, GroupMembership, Workout, page } from '@cedo/contract'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'
import { resolveCaller } from '../../plugins/auth.ts'
import { list as listSessions } from '../session/list.ts'
import * as SessionService from '../session/service.ts'
import { trainingReview } from './service.ts'

/**
 * Regression: losing access to a group did not take back the NAMES it had shown you.
 *
 * Membership is not permanent — any editor may remove another member — so an exercise or workout
 * that was legitimately visible when a set was logged can be unreachable by the time anything reads
 * that log back. Three reads named one anyway: the session list joined `workouts` with no
 * predicate, `stalled` joined `exercises` with none, and `dayBalance` fetched the workout name
 * through a bare correlated subquery. Each was verified to leak before the fix.
 *
 * The rule, as everywhere else: a name you cannot read, you are not shown.
 * See docs/03-domain-model.md.
 */

let h: TestApi
let alice: TestUser
let bob: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
  bob = await h.as('bob')
})

interface Shared {
  readonly groupId: string
  readonly workoutId: string
  readonly exerciseId: string
}

/** Bob's group, holding one exercise and one plan, with Alice as an editor. */
async function sharedGroupWithAlice(): Promise<Shared> {
  const group = await bob.wire('/groups', {
    method: 'POST',
    body: JSON.stringify({ name: 'Bobs Crew' }),
  })
  const groupId = expectContract(GroupMembership, group.body).id
  await bob.wire(`/groups/${groupId}/members`, {
    method: 'POST',
    body: JSON.stringify({ username: alice.username, role: 'editor' }),
  })

  const exercise = await bob.wire('/exercises', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Bobs Secret Lift',
      muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
    }),
  })
  const exerciseId = expectContract(Exercise, exercise.body).id
  await bob.wire(`/exercises/${exerciseId}/transfer`, {
    method: 'POST',
    body: JSON.stringify({ toGroupId: groupId }),
  })

  const workout = await bob.wire('/workouts', {
    method: 'POST',
    body: JSON.stringify({ name: 'Bobs Cutting Block' }),
  })
  const workoutId = expectContract(Workout, workout.body).id
  await bob.wire(`/workouts/${workoutId}/plan`, {
    method: 'PUT',
    body: JSON.stringify({
      days: [{ name: 'Leg Day', entries: [{ exerciseId, sets: [{ targetReps: 5 }] }] }],
    }),
  })
  await bob.wire(`/workouts/${workoutId}/transfer`, {
    method: 'POST',
    body: JSON.stringify({ toGroupId: groupId }),
  })

  return { groupId, workoutId, exerciseId }
}

/** Three finished sessions, which is the minimum `stalled` considers. */
async function logThreeSessions(shared: Shared): Promise<void> {
  const caller = await resolveCaller(`Bearer ${alice.token}`)
  if (caller === null) throw new Error('alice could not be resolved')

  const [day] = await db
    .select({ id: workoutDays.id })
    .from(workoutDays)
    .where(eq(workoutDays.workoutId, shared.workoutId))
    .limit(1)

  for (let i = 0; i < 3; i += 1) {
    const session = await SessionService.start(caller, {
      workoutId: shared.workoutId,
      dayId: day?.id ?? null,
    })
    await SessionService.logSet(caller, session.id, {
      exerciseId: shared.exerciseId,
      entryId: null,
      setIndex: 0,
      weightG: 60_000,
      reps: 5,
      rpe: null,
      durationS: null,
      distanceMm: null,
      isWarmup: false,
    })
    await SessionService.update(caller, session.id, { endedAt: new Date().toISOString() })
  }
}

test('losing a group hides the names it used to show', async () => {
  const shared = await sharedGroupWithAlice()
  await logThreeSessions(shared)

  await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, shared.groupId), eq(groupMembers.userId, alice.userId)))

  const after = await resolveCaller(`Bearer ${alice.token}`)
  if (after === null) throw new Error('alice could not be resolved')
  expect(after.groupIds).not.toContain(shared.groupId)

  // The direct reads already refused; these are the ones that did not.
  expect((await alice.wire(`/workouts/${shared.workoutId}`)).status).toBe(404)
  expect((await alice.wire(`/exercises/${shared.exerciseId}`)).status).toBe(404)

  // Her own sessions remain hers — but say nothing about what she can no longer open.
  const sessions = await listSessions(after, { limit: 10 })
  expect(sessions.items).not.toHaveLength(0)
  expect(sessions.items.map((s) => s.workoutName)).toEqual([null, null, null])
  expect(sessions.items.map((s) => s.dayName)).toEqual([null, null, null])

  // And the review, which is read by an AI over MCP, names neither.
  const review = await trainingReview(after, 4)
  expect(review.stalled.map((s) => s.exercise)).not.toContain('Bobs Secret Lift')
  expect(review.dayBalance.map((d) => d.workout)).not.toContain('Bobs Cutting Block')
  expect(JSON.stringify(review)).not.toContain('Bobs')
})

test('while she is still a member, the same reads DO name them', async () => {
  // The counterpart, so the fix above cannot be "return null always" and still pass.
  const shared = await sharedGroupWithAlice()
  await logThreeSessions(shared)

  const caller = await resolveCaller(`Bearer ${alice.token}`)
  if (caller === null) throw new Error('alice could not be resolved')

  const sessions = await listSessions(caller, { limit: 10 })
  expect(sessions.items[0]?.workoutName).toBe('Bobs Cutting Block')
  expect(sessions.items[0]?.dayName).toBe('Leg Day')

  const review = await trainingReview(caller, 4)
  expect(review.dayBalance.map((d) => d.workout)).toContain('Bobs Cutting Block')
})

/**
 * Regression: `transfer` reported on a workout's CONTENTS before checking the caller could edit it.
 *
 * `assertWorkoutCanTravel` throws a 409 naming the exercises that would be stranded — useful
 * to an owner, an oracle to anyone else. Running it first turned the endpoint into a probe: a
 * stranger could confirm a private workout existed and learn what it prescribed, while
 * `GET /workouts/:id` correctly answered 404 for the same id.
 */
test('transfer answers 404 for a workout you cannot edit, naming nothing', async () => {
  /**
   * The leak needs the prober to SEE the referenced exercise — otherwise the guard finds nothing to
   * complain about and falls through to the 404 anyway. So: a PRIVATE workout prescribing an
   * exercise from the seeded shared library, which every registered user reads.
   */
  // The harness seeds only the core; the starter library is opt-in per test.
  await seedLibrary(h.groupId, h.systemUserId)
  const library = await bob.wire('/exercises?scope=all&limit=1')
  const shelved = expectContract(page(Exercise), library.body).items[0]
  if (shelved === undefined) throw new Error('the seeded library is empty')

  const workout = await bob.wire('/workouts', {
    method: 'POST',
    body: JSON.stringify({ name: 'Bobs Private Block' }),
  })
  const workoutId = expectContract(Workout, workout.body).id
  await bob.wire(`/workouts/${workoutId}/plan`, {
    method: 'PUT',
    body: JSON.stringify({
      days: [{ name: 'Day 1', entries: [{ exerciseId: shelved.id, sets: [{ targetReps: 5 }] }] }],
    }),
  })

  const carol = await h.as('carol')
  const probe = await carol.wire(`/workouts/${workoutId}/transfer`, {
    method: 'POST',
    body: JSON.stringify({ toGroupId: carol.personalGroupId }),
  })

  // 404 and nothing else: not a 409 confirming the plan exists and naming what it prescribes.
  expect(probe.status).toBe(404)
  expect(JSON.stringify(probe.body)).not.toContain(shelved.name)

  // Indistinguishable from a workout that never existed.
  const absent = await carol.wire(`/workouts/${crypto.randomUUID()}/transfer`, {
    method: 'POST',
    body: JSON.stringify({ toGroupId: carol.personalGroupId }),
  })
  expect(absent.status).toBe(probe.status)
})

/**
 * Regression: the volume sums multiplied int4 by int2s before dividing, so the PER-ROW product
 * overflowed and Postgres raised `integer out of range`.
 *
 * A 500 kg sled for 50 reps is inside `MAX_WEIGHT_G` and `MAX_REPS`, so the contract accepts it and
 * the review then failed permanently for that user — for the whole window and the one before it —
 * with no way back except deleting the log.
 */
test('a set heavy enough to overflow int4 does not break the review', async () => {
  const shared = await sharedGroupWithAlice()
  const caller = await resolveCaller(`Bearer ${alice.token}`)
  if (caller === null) throw new Error('alice could not be resolved')

  const session = await SessionService.start(caller, { workoutId: shared.workoutId, dayId: null })
  await SessionService.logSet(caller, session.id, {
    exerciseId: shared.exerciseId,
    entryId: null,
    setIndex: 0,
    weightG: 500_000,
    reps: 50,
    rpe: null,
    durationS: null,
    distanceMm: null,
    isWarmup: false,
  })

  const review = await trainingReview(caller, 4)
  expect(review.muscleVolume.find((m) => m.muscle === 'quadriceps')?.volumeKg).toBe(25_000)

  const sessions = await listSessions(caller, { limit: 5 })
  expect(sessions.items[0]?.totalVolumeG).toBe(25_000_000)
})
