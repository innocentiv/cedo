import { beforeEach, describe, expect, test } from 'bun:test'
import { Exercise, GroupMembership, ProgressionSuggestion, Workout } from '@cedo/contract'
import { z } from 'zod'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'

/**
 * Regression: a workout shared with a group used to hand every member the FULL record of exercises
 * they could not otherwise see — name, description, instructions, media — and the progression
 * endpoint leaked the name and prescribed load. Neither read path applied `visible()`.
 */
let h: TestApi
let alice: TestUser
let bob: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
  bob = await h.as('bob')
})

const SECRET = 'A description Bob must never see'

async function sharedWorkoutUsingAPrivateExercise() {
  const secret = expectContract(
    Exercise,
    (
      await alice.wire('/exercises', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Alice Secret Movement',
          description: SECRET,
          muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
        }),
      })
    ).body,
  )

  const workout = expectContract(
    Workout,
    (await alice.wire('/workouts', { method: 'POST', body: JSON.stringify({ name: 'Plan' }) }))
      .body,
  )
  await alice.wire(`/workouts/${workout.id}/plan`, {
    method: 'PUT',
    body: JSON.stringify({
      days: [
        {
          name: 'D',
          entries: [{ exerciseId: secret.id, sets: [{ targetReps: 5, targetWeightG: 100_000 }] }],
        },
      ],
    }),
  })

  const squad = expectContract(
    GroupMembership,
    (await alice.wire('/groups', { method: 'POST', body: JSON.stringify({ name: 'Squad' }) })).body,
  )
  await alice.wire(`/groups/${squad.id}/members`, {
    method: 'POST',
    body: JSON.stringify({ username: 'bob', role: 'reader' }),
  })
  return { secret, workout, squad }
}

describe('sharing a workout does not share its exercises', () => {
  test('transferring is REFUSED while an exercise would be invisible to the group', async () => {
    const { workout, squad } = await sharedWorkoutUsingAPrivateExercise()

    const res = await alice.wire(`/workouts/${workout.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: squad.id }),
    })
    expect(res.status).toBe(409)
    expect(JSON.stringify(res.body)).toContain('Alice Secret Movement')

    // The workout did not move.
    expect(
      expectContract(Workout, (await alice.wire(`/workouts/${workout.id}`)).body).ownerGroupId,
    ).toBe(alice.personalGroupId)
  })

  /**
   * Every user reads the starter library, so a plan built from it can go to any group. The check
   * used to require each exercise to be OWNED by the target group, which refused the most ordinary
   * share there is — "here is my programme" — for every plan built from seeded exercises.
   */
  test('a plan built from the shared library can be shared — every member already reads it', async () => {
    const { seedLibrary } = await import('../../db/seed.ts')
    await seedLibrary(h.groupId, h.systemUserId)
    const squat = expectContract(
      z.object({ items: z.array(Exercise) }),
      (await alice.wire('/exercises?q=Back%20Squat&limit=1')).body,
    ).items[0]
    if (squat === undefined) throw new Error('the library has no Back Squat')

    const workout = expectContract(
      Workout,
      (await alice.wire('/workouts', { method: 'POST', body: JSON.stringify({ name: 'Legs' }) }))
        .body,
    )
    await alice.wire(`/workouts/${workout.id}/plan`, {
      method: 'PUT',
      body: JSON.stringify({
        days: [{ name: 'D', entries: [{ exerciseId: squat.id, sets: [{ targetReps: 5 }] }] }],
      }),
    })
    const squad = expectContract(
      GroupMembership,
      (await alice.wire('/groups', { method: 'POST', body: JSON.stringify({ name: 'Squad' }) }))
        .body,
    )
    await alice.wire(`/groups/${squad.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ username: 'bob', role: 'reader' }),
    })

    const res = await alice.wire(`/workouts/${workout.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: squad.id }),
    })
    expect(res.status).toBe(200)
    const asBob = expectContract(Workout, (await bob.wire(`/workouts/${workout.id}`)).body)
    expect(asBob.days[0]?.entries[0]?.exercise?.name).toBe(squat.name)
  })

  /**
   * The rule must hold for FUTURE members. Judged against the members at the moment of transfer, a
   * group with only its creator passed, and everyone added afterwards saw "Unavailable exercise".
   */
  test('refused even into a group whose only member can see it — members join later', async () => {
    const { workout } = await sharedWorkoutUsingAPrivateExercise()
    const solo = expectContract(
      GroupMembership,
      (await alice.wire('/groups', { method: 'POST', body: JSON.stringify({ name: 'Solo' }) }))
        .body,
    )
    const res = await alice.wire(`/workouts/${workout.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: solo.id }),
    })
    expect(res.status).toBe(409)
  })

  test('duplicating INTO a shared group is held to the same rule as transferring', async () => {
    const { workout, squad } = await sharedWorkoutUsingAPrivateExercise()
    const res = await alice.wire(`/workouts/${workout.id}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: squad.id }),
    })
    expect(res.status).toBe(409)
    expect(JSON.stringify(res.body)).toContain('Alice Secret Movement')
  })

  /**
   * Saving is the third way an exercise reaches a group, and it is held to the same rule as
   * transferring and duplicating. Without it, any editor could add a private exercise to a group's
   * plan and every other member got an "Unavailable exercise" row.
   */
  test('saving a group plan with a private exercise is refused; group and library ones are fine', async () => {
    const { secret, squad } = await sharedWorkoutUsingAPrivateExercise()
    const groupPlan = expectContract(
      Workout,
      (await alice.wire('/workouts', { method: 'POST', body: JSON.stringify({ name: 'Ours' }) }))
        .body,
    )
    await alice.wire(`/workouts/${groupPlan.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: squad.id }),
    })
    const save = async (exerciseId: string) =>
      await alice.wire(`/workouts/${groupPlan.id}/plan`, {
        method: 'PUT',
        body: JSON.stringify({
          days: [{ name: 'D', entries: [{ exerciseId, sets: [{ targetReps: 5 }] }] }],
        }),
      })

    const refused = await save(secret.id)
    expect(refused.status).toBe(409)
    expect(JSON.stringify(refused.body)).toContain('Alice Secret Movement')

    // Moved into the group, the same exercise is fine.
    await alice.wire(`/exercises/${secret.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: squad.id }),
    })
    expect((await save(secret.id)).status).toBe(200)
  })

  test('it succeeds once the exercise is shared too', async () => {
    const { secret, workout, squad } = await sharedWorkoutUsingAPrivateExercise()

    await alice.wire(`/exercises/${secret.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: squad.id }),
    })
    const res = await alice.wire(`/workouts/${workout.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: squad.id }),
    })
    expect(res.status).toBe(200)

    // Now Bob may legitimately see both.
    expect((await bob.wire(`/exercises/${secret.id}`)).status).toBe(200)
  })

  /** Defence in depth: visibility can change AFTER a workout was shared. */
  test('an exercise that becomes invisible later is redacted, not leaked', async () => {
    const { secret, workout, squad } = await sharedWorkoutUsingAPrivateExercise()

    await alice.wire(`/exercises/${secret.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: squad.id }),
    })
    await alice.wire(`/workouts/${workout.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: squad.id }),
    })
    // Alice pulls the exercise back out of the squad.
    await alice.wire(`/exercises/${secret.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: alice.personalGroupId }),
    })

    const seen = await bob.wire(`/workouts/${workout.id}`)
    expect(seen.status).toBe(200)
    const body = JSON.stringify(seen.body)
    expect(body).not.toContain(SECRET)
    expect(body).not.toContain('Alice Secret Movement')
    // The contract says `exercise: null` when the caller cannot see it.
    const plan0 = expectContract(Workout, seen.body)
    expect(plan0.days[0]?.entries[0]?.exercise).toBeNull()

    // The prescription itself is still legible.
    const plan = expectContract(Workout, seen.body)
    expect(plan.days[0]?.entries[0]?.sets[0]?.target.weightG).toBe(100_000)
  })

  /**
   * A copy cannot reference an exercise its owner cannot see, so duplicating such a plan must be
   * refused — and refused BEFORE anything is written. It used to create the copy first and then
   * fail on its plan, leaving an empty "Plan" in Bob's group on every retry.
   */
  test('duplicating a plan with a hidden exercise is refused, and leaves nothing behind', async () => {
    const { secret, workout, squad } = await sharedWorkoutUsingAPrivateExercise()
    await alice.wire(`/exercises/${secret.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: squad.id }),
    })
    await alice.wire(`/workouts/${workout.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: squad.id }),
    })
    await alice.wire(`/exercises/${secret.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: alice.personalGroupId }),
    })

    const res = await bob.wire(`/workouts/${workout.id}/duplicate`, { method: 'POST', body: '{}' })
    expect(res.status).toBe(409)
    expect(JSON.stringify(res.body)).not.toContain('Alice Secret Movement')

    const mine = expectContract(
      z.object({ items: z.array(z.object({ id: z.uuid() })) }),
      (await bob.wire('/workouts?scope=mine')).body,
    )
    expect(mine.items).toHaveLength(0)
  })

  /**
   * The transfer form of the same rule. The check used to look only at exercises the CALLER could
   * see, so one hidden from them was skipped rather than refused — and the plan moved into a group
   * where it could only ever be an "Unavailable exercise" row.
   */
  test('transferring a plan with an exercise hidden from the caller is refused, unnamed', async () => {
    const squad = expectContract(
      GroupMembership,
      (await alice.wire('/groups', { method: 'POST', body: JSON.stringify({ name: 'Squad' }) }))
        .body,
    )
    await alice.wire(`/groups/${squad.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ username: 'bob', role: 'editor' }),
    })
    const { secret, workout } = await sharedWorkoutUsingAPrivateExercise()
    await alice.wire(`/exercises/${secret.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: squad.id }),
    })
    await alice.wire(`/workouts/${workout.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: squad.id }),
    })
    await alice.wire(`/exercises/${secret.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: alice.personalGroupId }),
    })

    const bobs = expectContract(
      GroupMembership,
      (await bob.wire('/groups', { method: 'POST', body: JSON.stringify({ name: 'Bobs' }) })).body,
    )
    const res = await bob.wire(`/workouts/${workout.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: bobs.id }),
    })
    expect(res.status).toBe(409)
    expect(JSON.stringify(res.body)).not.toContain('Alice Secret Movement')
    expect(
      expectContract(Workout, (await alice.wire(`/workouts/${workout.id}`)).body).ownerGroupId,
    ).toBe(squad.id)
  })

  test('progression never names an exercise the caller cannot see', async () => {
    const { secret, workout, squad } = await sharedWorkoutUsingAPrivateExercise()
    await alice.wire(`/exercises/${secret.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: squad.id }),
    })
    await alice.wire(`/workouts/${workout.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: squad.id }),
    })
    await alice.wire(`/exercises/${secret.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: alice.personalGroupId }),
    })

    const res = await bob.wire(`/workouts/${workout.id}/progression`)
    expect(res.status).toBe(200)
    expect(JSON.stringify(res.body)).not.toContain('Alice Secret Movement')
    expect(expectContract(z.array(ProgressionSuggestion), res.body)).toHaveLength(0)
  })
})
