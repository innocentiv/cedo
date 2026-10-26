import { beforeEach, describe, expect, test } from 'bun:test'
import {
  ApiError,
  Exercise,
  ExerciseHistory,
  GroupMembership,
  SetLog,
  WorkoutSession,
  WorkoutSessionSummary,
  kgToG,
  page,
} from '@cedo/contract'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'

/**
 * A past mistake fixed (#31): a set of a finished session corrected or removed, or the whole
 * session deleted. Finishing still ends the logging — a finished session takes no new set — but
 * what it holds is the lifter's own record, and theirs to fix, with no time limit. Everything
 * computed from it follows, being computed on read. See GLOSSARY.md, "Session".
 */

let h: TestApi
let alice: TestUser
let bob: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
  bob = await h.as('bob')
})

const send = async (user: TestUser, path: string, method: string, body?: unknown) =>
  await user.wire(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

async function anExercise(user: TestUser, tracking = 'weight_reps'): Promise<string> {
  const res = await send(user, '/exercises', 'POST', {
    name: tracking === 'weight_reps' ? 'Bench Press' : 'Pull-up',
    tracking,
    muscles: [{ muscle: 'pectoralis_major', loadPct: 100 }],
  })
  return expectContract(Exercise, res.body).id
}

/** A session started, `sets` logged in it in order, and finished. */
async function aFinishedSession(
  user: TestUser,
  exerciseId: string,
  sets: readonly Record<string, unknown>[],
): Promise<{ id: string; logs: SetLog[] }> {
  const { id } = expectContract(WorkoutSession, (await send(user, '/sessions', 'POST', {})).body)
  const logs: SetLog[] = []
  for (const set of sets) {
    const res = await send(user, `/sessions/${id}/logs`, 'POST', { exerciseId, ...set })
    logs.push(expectContract(SetLog, res.body))
  }
  const finished = await send(user, `/sessions/${id}`, 'PATCH', {
    endedAt: new Date().toISOString(),
  })
  expect(finished.status).toBe(200)
  return { id, logs }
}

const read = async (user: TestUser, id: string) =>
  expectContract(WorkoutSession, (await user.wire(`/sessions/${id}`)).body)
const correct = async (user: TestUser, sessionId: string, logId: string, body: unknown) =>
  await send(user, `/sessions/${sessionId}/logs/${logId}`, 'PATCH', body)
const refusal = (body: unknown) => expectContract(ApiError, body).error.message

describe('a set of a finished session, corrected', () => {
  test('takes what it names, keeps what it leaves out, and is answered as read', async () => {
    const bench = await anExercise(alice)
    const { id, logs } = await aFinishedSession(alice, bench, [
      { weightG: kgToG(100), reps: 5, rpe: 8 },
    ])
    const set = logs[0]
    if (set === undefined) throw new Error('nothing was logged')

    const res = await correct(alice, id, set.id, { weightG: kgToG(80), isWarmup: true })
    expect(expectContract(SetLog, res.body)).toMatchObject({
      id: set.id,
      weightG: kgToG(80),
      reps: 5,
      rpe: 8,
      isWarmup: true,
      setIndex: 0,
    })
    expect((await read(alice, id)).logs.map((l) => [l.weightG, l.reps, l.isWarmup])).toEqual([
      [kgToG(80), 5, true],
    ])
  })

  /** Judged on read: the session that set the best no longer does, and the next one now does. */
  test('moves the personal bests, and the history, with it', async () => {
    const bench = await anExercise(alice)
    const first = await aFinishedSession(alice, bench, [{ weightG: kgToG(100), reps: 5 }])
    const second = await aFinishedSession(alice, bench, [{ weightG: kgToG(90), reps: 5 }])
    expect((await read(alice, second.id)).logs[0]?.personalBest).toBe(false)

    const typo = first.logs[0]
    if (typo === undefined) throw new Error('nothing was logged')
    expect((await correct(alice, first.id, typo.id, { weightG: kgToG(80) })).status).toBe(200)

    expect((await read(alice, second.id)).logs[0]?.personalBest).toBe(true)
    const history = expectContract(
      ExerciseHistory,
      (await alice.wire(`/exercises/${bench}/history`)).body,
    )
    expect(history.sessions.flatMap((s) => s.sets.map((set) => set.weightG))).toEqual([
      kgToG(90),
      kgToG(80),
    ])
  })

  test('nothing for nothing: an empty correction changes nothing, and answers the set', async () => {
    const bench = await anExercise(alice)
    const { id, logs } = await aFinishedSession(alice, bench, [{ weightG: kgToG(100), reps: 5 }])
    const set = logs[0]
    if (set === undefined) throw new Error('nothing was logged')
    const res = await correct(alice, id, set.id, {})
    expect(expectContract(SetLog, res.body)).toMatchObject({ weightG: kgToG(100), reps: 5 })
  })

  test('takes assistance only on a bodyweight movement, as a logged set does', async () => {
    const bench = await anExercise(alice)
    const pullUp = await anExercise(alice, 'bodyweight_reps')
    const lifted = await aFinishedSession(alice, bench, [{ weightG: kgToG(100), reps: 5 }])
    const assisted = await aFinishedSession(alice, pullUp, [{ reps: 5 }])
    const [benchSet, pullUpSet] = [lifted.logs[0], assisted.logs[0]]
    if (benchSet === undefined || pullUpSet === undefined) throw new Error('nothing was logged')

    const refused = await correct(alice, lifted.id, benchSet.id, { weightG: -kgToG(20), reps: 6 })
    expect(refused.status).toBe(422)
    // Rolled back whole: not even the reps it named.
    expect((await read(alice, lifted.id)).logs[0]).toMatchObject({ weightG: kgToG(100), reps: 5 })

    const res = await correct(alice, assisted.id, pullUpSet.id, { weightG: -kgToG(20) })
    expect(expectContract(SetLog, res.body).weightG).toBe(-kgToG(20))
  })
})

describe('a set of a finished session, removed', () => {
  test('is gone from it, and the session is still finished', async () => {
    const bench = await anExercise(alice)
    const { id, logs } = await aFinishedSession(alice, bench, [{ reps: 5 }, { reps: 6 }])
    const [kept, mistake] = logs
    if (kept === undefined || mistake === undefined) throw new Error('nothing was logged')

    expect((await send(alice, `/sessions/${id}/logs/${mistake.id}`, 'DELETE')).status).toBe(200)
    const session = await read(alice, id)
    expect(session.logs.map((l) => l.id)).toEqual([kept.id])
    expect(session.endedAt).not.toBeNull()
  })

  test('and finishing still ends the logging: a finished session takes no new set', async () => {
    const bench = await anExercise(alice)
    const { id } = await aFinishedSession(alice, bench, [{ reps: 5 }])
    const added = await send(alice, `/sessions/${id}/logs`, 'POST', { exerciseId: bench, reps: 5 })
    expect(added.status).toBe(409)
    expect(refusal(added.body)).toBe('That session has already been finished')
  })
})

describe('a whole session, deleted', () => {
  test('goes with its sets, from the history and from what was lifted', async () => {
    const bench = await anExercise(alice)
    const kept = await aFinishedSession(alice, bench, [{ weightG: kgToG(80), reps: 5 }])
    const twice = await aFinishedSession(alice, bench, [{ weightG: kgToG(80), reps: 5 }])

    expect((await send(alice, `/sessions/${twice.id}`, 'DELETE')).status).toBe(200)
    expect((await alice.wire(`/sessions/${twice.id}`)).status).toBe(404)
    const list = expectContract(page(WorkoutSessionSummary), (await alice.wire('/sessions')).body)
    expect(list.items.map((s) => s.id)).toEqual([kept.id])
    const history = expectContract(
      ExerciseHistory,
      (await alice.wire(`/exercises/${bench}/history`)).body,
    )
    expect(history.sessions).toHaveLength(1)
    expect((await send(alice, `/sessions/${twice.id}`, 'DELETE')).status).toBe(404)
  })

  /** One started by mistake: deleted while in progress, and the next one starts. */
  test('in progress too, which lets the next one start', async () => {
    const { id } = expectContract(WorkoutSession, (await send(alice, '/sessions', 'POST', {})).body)
    expect((await send(alice, `/sessions/${id}`, 'DELETE')).status).toBe(200)
    expect((await send(alice, '/sessions', 'POST', {})).status).toBe(200)
  })
})

describe("someone else's", () => {
  test('is a 404 to correct, to remove a set of, or to delete — and stays as it was', async () => {
    const bench = await anExercise(alice)
    const { id, logs } = await aFinishedSession(alice, bench, [{ weightG: kgToG(100), reps: 5 }])
    const set = logs[0]
    if (set === undefined) throw new Error('nothing was logged')

    expect((await correct(bob, id, set.id, { reps: 1 })).status).toBe(404)
    expect((await send(bob, `/sessions/${id}/logs/${set.id}`, 'DELETE')).status).toBe(404)
    expect((await send(bob, `/sessions/${id}`, 'DELETE')).status).toBe(404)
    // Nor through a session of his own: a set is found only in the session it was logged in.
    const { id: his } = await aFinishedSession(bob, await anExercise(bob), [{ reps: 5 }])
    expect((await correct(bob, his, set.id, { reps: 1 })).status).toBe(404)
    expect((await send(bob, `/sessions/${his}/logs/${set.id}`, 'DELETE')).status).toBe(404)

    expect((await read(alice, id)).logs).toMatchObject([{ id: set.id, reps: 5 }])
  })
})

/**
 * A set logged against an exercise the lifter has since lost — they left the group it lives in —
 * is still theirs to fix: how many, how hard, whether a warm-up, or gone. Only a new weight is
 * refused: without the exercise there is no saying whether a negative one is assistance.
 */
test('a set of an exercise out of reach is corrected and removed, but takes no new weight', async () => {
  const squad = expectContract(
    GroupMembership,
    (await send(alice, '/groups', 'POST', { name: 'Squad' })).body,
  )
  const joined = await send(alice, `/groups/${squad.id}/members`, 'POST', {
    username: 'bob',
    role: 'reader',
  })
  expect(joined.status).toBe(200)
  const bench = await anExercise(alice)
  const moved = await send(alice, `/exercises/${bench}/transfer`, 'POST', { toGroupId: squad.id })
  expect(moved.status).toBe(200)
  const { id, logs } = await aFinishedSession(bob, bench, [
    { weightG: kgToG(60), reps: 5 },
    { weightG: kgToG(60), reps: 5 },
  ])
  const [first, second] = logs
  if (first === undefined || second === undefined) throw new Error('nothing was logged')
  expect((await send(alice, `/groups/${squad.id}/members/${bob.userId}`, 'DELETE')).status).toBe(
    200,
  )

  const counted = await correct(bob, id, first.id, { reps: 6, rpe: 9, isWarmup: true })
  expect(expectContract(SetLog, counted.body)).toMatchObject({ reps: 6, rpe: 9, exercise: null })
  const weighed = await correct(bob, id, first.id, { weightG: kgToG(70) })
  expect(weighed.status).toBe(404)
  expect((await send(bob, `/sessions/${id}/logs/${second.id}`, 'DELETE')).status).toBe(200)
  expect((await read(bob, id)).logs).toMatchObject([{ id: first.id, weightG: kgToG(60) }])
})
