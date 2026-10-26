import { beforeEach, describe, expect, test } from 'bun:test'
import { Exercise, PushKey, RestAlert, SetLog, Workout, WorkoutSession } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { pushSubscriptions } from '../../db/schema.ts'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'
import { type Deliver, type Delivered, sendDueAlerts } from './alerts.ts'
import { forgetPushKeys } from './keys.ts'

let h: TestApi
let alice: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
  forgetPushKeys()
})

const send = async (user: TestUser, path: string, body: unknown, method = 'POST') => {
  const res = await user.wire(path, { method, body: JSON.stringify(body) })
  if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status}`)
  return res.body
}

const device = (name: string) => ({
  endpoint: `https://web.push.apple.com/${name}`,
  keys: { p256dh: `key-${name}`, auth: `auth-${name}` },
})

/** A fake push service: what it was handed, answering each device as `answer` says. */
function pushService(answer: (endpoint: string) => Delivered = () => 'sent') {
  const sent: { endpoint: string; alert: RestAlert }[] = []
  const deliver: Deliver = async (d, payload) => {
    sent.push({ endpoint: d.endpoint, alert: RestAlert.parse(JSON.parse(payload)) })
    return await Promise.resolve(answer(d.endpoint))
  }
  return { sent, deliver }
}

/** Alice in a session of three 5 × 100 kg squats, resting 90 s; logs one, and returns it. */
async function resting() {
  const squat = expectContract(
    Exercise,
    await send(alice, '/exercises', {
      name: 'Squat',
      muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
    }),
  )
  const workout = expectContract(Workout, await send(alice, '/workouts', { name: 'Legs' }))
  const set = { targetReps: 5, targetWeightG: 100_000 }
  const plan = expectContract(
    Workout,
    await send(
      alice,
      `/workouts/${workout.id}/plan`,
      {
        days: [
          {
            name: 'A',
            entries: [{ exerciseId: squat.id, restSeconds: 90, sets: [set, set, set] }],
          },
        ],
      },
      'PUT',
    ),
  )
  const day = plan.days[0]
  const entry = day?.entries[0]
  if (day === undefined || entry === undefined) throw new Error('no plan')
  const session = expectContract(
    WorkoutSession,
    await send(alice, '/sessions', { workoutId: workout.id, dayId: day.id }),
  )
  const log = expectContract(
    SetLog,
    await send(alice, `/sessions/${session.id}/logs`, {
      exerciseId: squat.id,
      entryId: entry.id,
      weightG: 100_000,
      reps: 5,
    }),
  )
  const ends = Date.parse(log.loggedAt) + 90_000
  return {
    id: session.id,
    since: log.loggedAt,
    at: (afterEndS: number) => new Date(ends + afterEndS * 1000),
  }
}

describe('the push key', () => {
  test('is made once, kept, and the same on every read', async () => {
    const first = expectContract(PushKey, (await alice.wire('/push/key')).body)
    forgetPushKeys()
    const again = expectContract(PushKey, (await alice.wire('/push/key')).body)
    expect(first.publicKey.length).toBeGreaterThan(40)
    expect(again.publicKey).toBe(first.publicKey)
  })
})

describe('a device told when a rest is over', () => {
  test('is subscribed again harmlessly, and is the account signed in on it now', async () => {
    await send(alice, '/push/subscriptions', device('phone'))
    await send(alice, '/push/subscriptions', device('phone'))
    const bob = await h.as('bob')
    await send(bob, '/push/subscriptions', device('phone'))
    const rows = await db.select().from(pushSubscriptions)
    expect(rows.map((r) => r.userId)).toEqual([bob.userId])
  })

  test('is only ever a push service — never an address the server would post to on anyone’s say', async () => {
    for (const endpoint of [
      'https://push.example.com/x',
      'https://10.0.0.1/x',
      'http://web.push.apple.com/x',
    ]) {
      const refused = await alice.wire('/push/subscriptions', {
        method: 'POST',
        body: JSON.stringify({ ...device('x'), endpoint }),
      })
      expect(refused.status).toBe(422)
    }
  })

  test('is one of a few a person has: past the cap, the oldest go', async () => {
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      await send(alice, '/push/subscriptions', device(name))
    }
    const kept = (await db.select().from(pushSubscriptions)).map((r) => r.endpoint).toSorted()
    expect(kept).toEqual(['c', 'd', 'e', 'f', 'g'].map((n) => device(n).endpoint))
  })

  test('is told no more — but only by its own account', async () => {
    await send(alice, '/push/subscriptions', device('phone'))
    const bob = await h.as('bob')
    const gone = `/push/subscriptions?endpoint=${encodeURIComponent(device('phone').endpoint)}`
    await bob.wire(gone, { method: 'DELETE' })
    expect(await db.select().from(pushSubscriptions)).toHaveLength(1)
    expect((await alice.wire(gone, { method: 'DELETE' })).status).toBe(200)
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0)
  })
})

/** The rest's end, pushed (#38): once, to every device, saying the next set. */
describe('the alert', () => {
  test('is sent when the rest ends, to every device, naming the next set', async () => {
    await send(alice, '/push/subscriptions', device('phone'))
    await send(alice, '/push/subscriptions', device('laptop'))
    const rest = await resting()
    const service = pushService()

    expect(await sendDueAlerts(rest.at(-1), service.deliver)).toBe(0)
    expect(await sendDueAlerts(rest.at(1), service.deliver)).toBe(2)
    expect(service.sent.map((s) => s.endpoint).toSorted()).toEqual([
      device('laptop').endpoint,
      device('phone').endpoint,
    ])
    expect(service.sent[0]?.alert).toEqual({
      title: 'Rest over',
      body: 'Squat — Set 2 of 3: 5 × 100 kg',
      url: `/today/session/${rest.id}`,
    })
    // Once.
    expect(await sendDueAlerts(rest.at(2), service.deliver)).toBe(0)
  })

  test('+30 s moves it', async () => {
    await send(alice, '/push/subscriptions', device('phone'))
    const rest = await resting()
    const service = pushService()
    await send(alice, `/sessions/${rest.id}/rest`, { sets: 1, change: 'extend' })
    expect(await sendDueAlerts(rest.at(1), service.deliver)).toBe(0)
    expect(await sendDueAlerts(rest.at(31), service.deliver)).toBe(1)
  })

  test('skipping the rest, or finishing the session, sends none', async () => {
    await send(alice, '/push/subscriptions', device('phone'))
    const service = pushService()
    const skipped = await resting()
    await send(alice, `/sessions/${skipped.id}/rest`, { sets: 1, change: 'skip' })
    expect(await sendDueAlerts(skipped.at(1), service.deliver)).toBe(0)
    await send(alice, `/sessions/${skipped.id}`, { endedAt: new Date().toISOString() }, 'PATCH')

    const finished = await resting()
    await send(alice, `/sessions/${finished.id}`, { endedAt: new Date().toISOString() }, 'PATCH')
    expect(await sendDueAlerts(finished.at(1), service.deliver)).toBe(0)
  })

  test('a device gone for good is told no more', async () => {
    await send(alice, '/push/subscriptions', device('phone'))
    const rest = await resting()
    const service = pushService(() => 'gone')
    await sendDueAlerts(rest.at(1), service.deliver)
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0)
  })

  test('long after it ended — the server was down — it is not sent late', async () => {
    await send(alice, '/push/subscriptions', device('phone'))
    const rest = await resting()
    const service = pushService()
    expect(await sendDueAlerts(rest.at(10 * 60), service.deliver)).toBe(0)
    expect(service.sent).toEqual([])
  })
})
