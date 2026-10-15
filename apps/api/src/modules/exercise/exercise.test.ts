import { beforeEach, describe, expect, test } from 'bun:test'
import { ApiError, Exercise, Media, Workout, WorkoutSession, page } from '@cedo/contract'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'

const Page = page(Exercise)

let h: TestApi
let alice: TestUser
let bob: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
  bob = await h.as('bob')
})

const anExercise = (over: Record<string, unknown> = {}) => ({
  name: 'Test Lift',
  muscles: [
    { muscle: 'pectoralis_major', loadPct: 70 },
    { muscle: 'triceps_brachii', loadPct: 30 },
  ],
  ...over,
})

const createFor = (user: TestUser, over: Record<string, unknown> = {}) =>
  user.wire('/exercises', { method: 'POST', body: JSON.stringify(anExercise(over)) })

const created = async (user: TestUser, over: Record<string, unknown> = {}) =>
  expectContract(Exercise, (await createFor(user, over)).body)

describe('create', () => {
  test("lands in the caller's personal group and is immediately readable", async () => {
    const exercise = await created(alice, { name: 'Bench Press' })
    expect(exercise.ownerGroupId).toBe(alice.personalGroupId)
    expect(exercise.canEdit).toBe(true)
    expect(exercise.isFavourite).toBe(false)
    expect(exercise.muscles).toHaveLength(2)

    const fetched = expectContract(Exercise, (await alice.wire(`/exercises/${exercise.id}`)).body)
    expect(fetched.id).toBe(exercise.id)
  })

  test('enforces the contract invariants at the boundary', async () => {
    const bad = await alice.wire('/exercises', {
      method: 'POST',
      body: JSON.stringify(anExercise({ muscles: [{ muscle: 'quadriceps', loadPct: 99 }] })),
    })
    expect(bad.status).toBe(422)
    expectContract(ApiError, bad.body)
  })

  test('rejects an unknown muscle rather than storing it', async () => {
    const bad = await alice.wire('/exercises', {
      method: 'POST',
      body: JSON.stringify(anExercise({ muscles: [{ muscle: 'bicep', loadPct: 100 }] })),
    })
    expect(bad.status).toBe(422)
  })

  test('defaults tracking to weight_reps and accepts the other modes', async () => {
    expect((await created(alice)).tracking).toBe('weight_reps')
    const plank = await created(alice, {
      name: 'Plank',
      tracking: 'duration',
      muscles: [{ muscle: 'rectus_abdominis', loadPct: 100 }],
    })
    expect(plank.tracking).toBe('duration')
  })
})

/** The ACL invariant, for the first entity that really exercises it. */
describe('access control', () => {
  test('everyone can read the seeded library but a reader cannot edit it', async () => {
    const { seedLibrary } = await import('../../db/seed.ts')
    await seedLibrary(h.groupId, h.systemUserId)

    const listed = expectContract(Page, (await bob.wire('/exercises?limit=100')).body)
    const fromLibrary = listed.items.find((e) => e.ownerGroupId === h.groupId)
    if (fromLibrary === undefined)
      throw new Error('the seeded library produced no visible exercise')
    expect(fromLibrary.canEdit).toBe(false)

    const patched = await bob.wire(`/exercises/${fromLibrary.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Hijacked' }),
    })
    expect(patched.status).toBe(404)
  })

  /**
   * Regression: authentication used to run in `resolve`, which Elysia executes AFTER schema
   * validation — so an anonymous caller sending a malformed body was told their body was wrong
   * when the real answer was that they were not signed in.
   */
  test('an anonymous request is rejected as unauthenticated before its body is validated', async () => {
    const res = await h.wire('/exercises', {
      method: 'POST',
      body: JSON.stringify({ nonsense: true }),
    })
    expect(res.status).toBe(401)
    expect(expectContract(ApiError, res.body).error.code).toBe('unauthenticated')
  })

  test('every route requires authentication', async () => {
    const id = crypto.randomUUID()
    for (const [path, init] of [
      ['/exercises', {}],
      ['/exercises', { method: 'POST', body: '{}' }],
      [`/exercises/${id}`, {}],
      [`/exercises/${id}`, { method: 'DELETE' }],
      [`/exercises/${id}/favourite`, { method: 'PUT' }],
    ] as const) {
      expect((await h.wire(path, init)).status).toBe(401)
    }
  })
})

describe('delete', () => {
  /**
   * Plans and logged history reference exercises with ON DELETE RESTRICT, so deleting one in use
   * must be refused — as a 409 the caller can act on, not the 500 a raw foreign-key violation was.
   * The message names nothing: the referencing plans and logs may belong to people the caller
   * cannot see.
   */
  test('one that logged history still uses is refused with 409, and survives', async () => {
    const exercise = await created(alice)
    const session = expectContract(
      WorkoutSession,
      (await alice.wire('/sessions', { method: 'POST', body: '{}' })).body,
    )
    await alice.wire(`/sessions/${session.id}/logs`, {
      method: 'POST',
      body: JSON.stringify({ exerciseId: exercise.id, setIndex: 0, reps: 5 }),
    })

    const res = await alice.wire(`/exercises/${exercise.id}`, { method: 'DELETE' })
    expect(res.status).toBe(409)
    expect(expectContract(ApiError, res.body).error.code).toBe('conflict')
    expect((await alice.wire(`/exercises/${exercise.id}`)).status).toBe(200)
  })

  test('as is one a plan still uses', async () => {
    const exercise = await created(alice)
    const workout = expectContract(
      Workout,
      (await alice.wire('/workouts', { method: 'POST', body: JSON.stringify({ name: 'P' }) })).body,
    )
    await alice.wire(`/workouts/${workout.id}/plan`, {
      method: 'PUT',
      body: JSON.stringify({
        days: [{ name: 'D', entries: [{ exerciseId: exercise.id, sets: [{ targetReps: 5 }] }] }],
      }),
    })

    expect((await alice.wire(`/exercises/${exercise.id}`, { method: 'DELETE' })).status).toBe(409)
  })
})

describe('update', () => {
  test('a partial patch leaves other fields alone', async () => {
    const exercise = await created(alice, { name: 'Bench Press', description: 'Original' })
    const patched = expectContract(
      Exercise,
      (
        await alice.wire(`/exercises/${exercise.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ description: 'Updated' }),
        })
      ).body,
    )
    expect(patched.name).toBe('Bench Press')
    expect(patched.description).toBe('Updated')
    expect(patched.muscles).toHaveLength(2)
  })

  test('a partial patch leaves DEFAULTED fields alone too — tracking, instructions, media', async () => {
    const link = await alice.wire('/media/link', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Form' }),
    })
    const mediaId = expectContract(Media, link.body).id
    const plank = await created(alice, {
      name: 'Plank',
      tracking: 'duration',
      instructions: 'Hold a straight line.',
      equipment: 'Mat',
      isUnilateral: true,
      mediaIds: [mediaId],
    })

    const patched = expectContract(
      Exercise,
      (
        await alice.wire(`/exercises/${plank.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ description: 'Core' }),
        })
      ).body,
    )
    expect(patched.tracking).toBe('duration')
    expect(patched.instructions).toBe('Hold a straight line.')
    expect(patched.equipment).toBe('Mat')
    expect(patched.isUnilateral).toBe(true)
    expect(patched.media.map((m) => m.id)).toEqual([mediaId])
  })

  test('replacing muscles replaces them wholesale', async () => {
    const exercise = await created(alice)
    const patched = expectContract(
      Exercise,
      (
        await alice.wire(`/exercises/${exercise.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ muscles: [{ muscle: 'quadriceps', loadPct: 100 }] }),
        })
      ).body,
    )
    expect(patched.muscles).toEqual([{ muscle: 'quadriceps', loadPct: 100 }])
  })

  test('advances updatedAt', async () => {
    const exercise = await created(alice)
    await Bun.sleep(5)
    const patched = expectContract(
      Exercise,
      (
        await alice.wire(`/exercises/${exercise.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ description: 'Changed' }),
        })
      ).body,
    )
    expect(new Date(patched.updatedAt).getTime()).toBeGreaterThan(
      new Date(exercise.updatedAt).getTime(),
    )
  })
})

describe('duplicate and transfer', () => {
  test('duplicating the library gives you an editable copy without touching the original', async () => {
    const { seedLibrary } = await import('../../db/seed.ts')
    await seedLibrary(h.groupId, h.systemUserId)
    const listed = expectContract(Page, (await bob.wire('/exercises?limit=100')).body)
    const original = listed.items.find((e) => e.ownerGroupId === h.groupId)
    if (original === undefined) throw new Error('the seeded library produced no visible exercise')

    const copy = expectContract(
      Exercise,
      (await bob.wire(`/exercises/${original.id}/duplicate`, { method: 'POST', body: '{}' })).body,
    )
    expect(copy.id).not.toBe(original.id)
    expect(copy.ownerGroupId).toBe(bob.personalGroupId)
    expect(copy.canEdit).toBe(true)
    expect(copy.muscles).toEqual(original.muscles)

    // The original is unchanged and still not editable.
    const after = expectContract(Exercise, (await bob.wire(`/exercises/${original.id}`)).body)
    expect(after.canEdit).toBe(false)
    expect(after.name).toBe(original.name)
  })
})

describe('listing', () => {
  test('filters by muscle', async () => {
    await created(alice, { name: 'Chest Thing' })
    await created(alice, {
      name: 'Leg Thing',
      muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
    })

    const legs = expectContract(Page, (await alice.wire('/exercises?muscle=quadriceps')).body)
    expect(legs.items.map((e) => e.name)).toEqual(['Leg Thing'])
  })
})
