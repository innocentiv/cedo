import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  Athlete,
  Exercise,
  ExerciseHistory,
  GroupMembership,
  SessionDetail,
  TrainingReview,
  WorkoutSession,
  WorkoutSessionSummary,
  page,
} from '@cedo/contract'
import { createApp } from '../../app.ts'
import { share } from '../../test/coaching.ts'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'

/**
 * A coach reads the training an athlete shares with a group they edit (#11) — read-only, and only
 * while it is shared. Names follow ADR-0019: what the coach cannot see is unavailable to them.
 * See docs/adr/0021-coaching-through-groups.md.
 */

let h: TestApi
let coach: TestUser
let athlete: TestUser
let squadId: string
let squadLift: string
let privateLift: string
let finished: string
let inProgress: string

const post = async (user: TestUser, path: string, body: unknown, method = 'POST') => {
  const res = await user.wire(path, { method, body: JSON.stringify(body) })
  if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status}`)
  return res.body
}

const anExercise = async (user: TestUser, name: string) =>
  expectContract(
    Exercise,
    await post(user, '/exercises', { name, muscles: [{ muscle: 'quadriceps', loadPct: 100 }] }),
  ).id

beforeEach(async () => {
  h = await makeApi()
  coach = await h.as('coach')
  athlete = await h.as('athlete')
  squadId = expectContract(GroupMembership, await post(coach, '/groups', { name: 'Squad' })).id
  await post(coach, `/groups/${squadId}/members`, { username: athlete.username, role: 'reader' })

  // One exercise the coach can see — the squad's — and one in the athlete's personal group.
  squadLift = await anExercise(coach, 'Squad Sled Push')
  await post(coach, `/exercises/${squadLift}/transfer`, { toGroupId: squadId })
  privateLift = await anExercise(athlete, 'Athletes Private Lift')

  finished = expectContract(WorkoutSession, await post(athlete, '/sessions', {})).id
  for (const exerciseId of [squadLift, privateLift]) {
    await post(athlete, `/sessions/${finished}/logs`, { exerciseId, weightG: 50_000, reps: 5 })
  }
  await post(athlete, `/sessions/${finished}`, { endedAt: new Date().toISOString() }, 'PATCH')
  inProgress = expectContract(WorkoutSession, await post(athlete, '/sessions', {})).id
})

const athletes = async (user: TestUser) =>
  expectContract(z.array(Athlete), (await user.wire('/athletes')).body)

/** Every read a coach makes of the athlete, by its status. */
const statuses = async (user: TestUser, athleteId = athlete.userId) =>
  await Promise.all(
    [
      `/athletes/${athleteId}/sessions`,
      `/athletes/${athleteId}/sessions/${finished}`,
      `/athletes/${athleteId}/exercises/${squadLift}/history`,
      `/athletes/${athleteId}/review`,
      `/athletes/${athleteId}/equipment`,
    ].map(async (path) => (await user.wire(path)).status),
  )

describe('the athletes a coach reads', () => {
  test('are the members sharing with a group they edit, through which groups', async () => {
    expect(await athletes(coach)).toEqual([])
    await share(athlete, squadId, true)
    expect(await athletes(coach)).toMatchObject([
      {
        user: { id: athlete.userId, username: athlete.username },
        groups: [{ id: squadId, name: 'Squad' }],
      },
    ])
  })

  test('never include a reader of the group, nor the coach themselves', async () => {
    await share(athlete, squadId, true)
    await share(coach, squadId, true)
    expect(await athletes(athlete)).toEqual([])
    expect((await athletes(coach)).map((a) => a.user.id)).toEqual([athlete.userId])
  })
})

describe("a coach reads an athlete's training", () => {
  beforeEach(async () => {
    await share(athlete, squadId, true)
  })

  test('every session, the one in progress too', async () => {
    const listed = expectContract(
      page(WorkoutSessionSummary),
      (await coach.wire(`/athletes/${athlete.userId}/sessions`)).body,
    )
    expect(listed.items.map((s) => s.id)).toEqual([inProgress, finished])
    expect(listed.items.find((s) => s.id === finished)?.setCount).toBe(2)
  })

  test('naming only what the coach can see — the athlete’s private exercise is unavailable', async () => {
    const session = expectContract(
      SessionDetail,
      (await coach.wire(`/athletes/${athlete.userId}/sessions/${finished}`)).body,
    )
    expect(session.logs.map((l) => l.exercise?.name ?? null)).toEqual(['Squad Sled Push', null])
    expect(session.logs.map((l) => l.weightG)).toEqual([50_000, 50_000])
  })

  test("an exercise's history, for one the coach can see — and none for one they cannot", async () => {
    const history = expectContract(
      ExerciseHistory,
      (await coach.wire(`/athletes/${athlete.userId}/exercises/${squadLift}/history`)).body,
    )
    expect(history.sessions.map((s) => s.sessionId)).toEqual([finished])
    expect(
      (await coach.wire(`/athletes/${athlete.userId}/exercises/${privateLift}/history`)).status,
    ).toBe(404)
  })

  /** Their Progress (#30): the review the athlete reads of their own, with what the coach can see. */
  test('their training reviewed, as they review it themselves — named as the coach sees it', async () => {
    const theirs = expectContract(
      TrainingReview,
      (await coach.wire(`/athletes/${athlete.userId}/review?weeks=4`)).body,
    )
    const own = expectContract(TrainingReview, (await athlete.wire('/review?weeks=4')).body)
    expect(theirs.weeks).toBe(4)
    expect(theirs.adherence).toEqual(own.adherence)
    expect((await coach.wire('/review?weeks=4')).body).not.toEqual(theirs)
    expect((await coach.wire(`/athletes/${athlete.userId}/review?weeks=53`)).status).toBe(422)
  })

  test("only the athlete's own sessions: someone else's id under their name is a 404", async () => {
    const coachsOwn = expectContract(WorkoutSession, await post(coach, '/sessions', {})).id
    expect((await coach.wire(`/athletes/${athlete.userId}/sessions/${coachsOwn}`)).status).toBe(404)
  })
})

describe('nobody else reads it', () => {
  test('not before the athlete shares', async () => {
    expect(await statuses(coach)).toEqual([404, 404, 404, 404, 404])
  })

  test('not a reader of the group, nor someone outside it', async () => {
    await share(athlete, squadId, true)
    const teammate = await h.as('teammate')
    await post(coach, `/groups/${squadId}/members`, { username: teammate.username, role: 'reader' })
    const stranger = await h.as('stranger')
    expect(await statuses(teammate)).toEqual([404, 404, 404, 404, 404])
    expect(await statuses(stranger)).toEqual([404, 404, 404, 404, 404])
  })

  test('not the coach once the athlete stops sharing — the past included', async () => {
    await share(athlete, squadId, true)
    expect(await statuses(coach)).toEqual([200, 200, 200, 200, 200])
    await share(athlete, squadId, false)
    expect(await statuses(coach)).toEqual([404, 404, 404, 404, 404])
    expect(await athletes(coach)).toEqual([])
  })

  test('not the coach once the athlete leaves the group', async () => {
    await share(athlete, squadId, true)
    await athlete.wire(`/groups/${squadId}/members/${athlete.userId}`, { method: 'DELETE' })
    expect(await statuses(coach)).toEqual([404, 404, 404, 404, 404])
  })

  test('not the coach once they leave the group themselves', async () => {
    await share(athlete, squadId, true)
    const other = await h.as('other')
    await post(coach, `/groups/${squadId}/members`, { username: other.username, role: 'editor' })
    await coach.wire(`/groups/${squadId}/members/${coach.userId}`, { method: 'DELETE' })
    expect(await statuses(coach)).toEqual([404, 404, 404, 404, 404])
    expect(await statuses(other)).toEqual([200, 200, 200, 200, 200])
  })

  test('a coach reading their own training as an athlete is a 404 — it is under /sessions', async () => {
    await share(coach, squadId, true)
    expect((await coach.wire(`/athletes/${coach.userId}/sessions`)).status).toBe(404)
  })
})

/**
 * Their notes (#41) and their weigh-ins (#42) are what a coach writes — ADR 0021's amendment; none
 * of their training.
 */
test('every /athletes route reads but their notes and weigh-ins: a coach changes none of an athlete’s training', () => {
  const routes = createApp().routes.filter((r) => r.path.startsWith('/athletes'))
  expect(routes.length).toBeGreaterThan(0)
  const writes = routes.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`)
  expect(writes).toEqual([
    'POST /athletes/:id/notes',
    'PATCH /athletes/:id/notes/:noteId',
    'DELETE /athletes/:id/notes/:noteId',
    'POST /athletes/:id/weigh-ins',
    'DELETE /athletes/:id/weigh-ins/:weighInId',
  ])
})
