import { beforeEach, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { ApiError, Bodyweight, WeighIn } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { weighIns } from '../../db/schema.ts'
import { coachedSquad, ok, send } from '../../test/coaching.ts'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'
import { own } from '../coaching/training.ts'
import { create } from './service.ts'

/**
 * Weigh-ins (#42): what is a weigh-in's own — one a day, another that day replacing it, read over a
 * period. Read, written and removed as every athlete record is:
 * ../athlete-record/athlete-record.test.ts. See GLOSSARY.md, "Weigh-in".
 */

let h: TestApi
let coach: TestUser
let athlete: TestUser

const bodyweight = async (user: TestUser, path = '/weigh-ins', weeks = 8) =>
  expectContract(Bodyweight, (await user.wire(`${path}?weeks=${String(weeks)}`)).body)

const weigh = async (user: TestUser, path: string, day: string, weightG: number) =>
  expectContract(WeighIn, await ok(user, path, { day, weightG }))

/** `YYYY-MM-DD`, `days` before today in UTC. */
const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

beforeEach(async () => {
  h = await makeApi()
  ;({ coach, athlete } = await coachedSquad(h))
})

const theirs = () => `/athletes/${athlete.userId}/weigh-ins`

describe('weigh-ins', () => {
  test('are one a day: another that day replaces it', async () => {
    const first = await weigh(athlete, '/weigh-ins', daysAgo(0), 83_000)
    expect(first).toMatchObject({ day: daysAgo(0), weightG: 83_000 })
    await weigh(athlete, '/weigh-ins', daysAgo(0), 82_600)
    const { weighIns: kept } = await bodyweight(athlete)
    expect(kept.map((w) => w.weightG)).toEqual([82_600])
  })

  test('taken by a coach that day, replace the athlete’s, and are then the coach’s', async () => {
    await weigh(athlete, '/weigh-ins', daysAgo(0), 82_400)
    await weigh(coach, theirs(), daysAgo(0), 82_000)
    const [read] = (await bodyweight(athlete)).weighIns
    expect(read).toMatchObject({ weightG: 82_000, author: { id: coach.userId } })
  })

  test("are a period's, and the latest before it, which its change is from", async () => {
    await db.insert(weighIns).values(
      [
        [70, 86_000],
        [60, 85_000],
        [20, 84_000],
        [5, 83_000],
      ].map(([ago = 0, weightG = 0]) => ({
        athleteId: athlete.userId,
        authorId: athlete.userId,
        day: daysAgo(ago),
        weightG,
      })),
    )
    const period = await bodyweight(athlete, '/weigh-ins', 8)
    expect(period.weighIns.map((w) => w.weightG)).toEqual([83_000, 84_000])
    expect(period.before?.weightG).toBe(85_000)
  })

  test('refuse a weight past what a person weighs, a day to come, and anything more', async () => {
    for (const body of [
      { day: daysAgo(0), weightG: 19_999 },
      { day: daysAgo(0), weightG: 400_001 },
      { day: daysAgo(-2), weightG: 82_400 },
      { day: daysAgo(0), weightG: 82_400, note: 'after breakfast' },
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- one refusal at a time.
      const refused = await send(athlete, '/weigh-ins', body)
      expect(refused.status).toBe(422)
      expectContract(ApiError, refused.body)
    }
    expect((await bodyweight(athlete)).weighIns).toEqual([])
  })

  /** Taken at once on one day, kept once: the unique day decides, not a read before the write. */
  test('taken at once on one day, kept once', async () => {
    await Promise.all(Array.from({ length: 30 }, async () => await db.execute(sql`select 1`)))
    await Promise.all(
      Array.from(
        { length: 30 },
        async (_, i) => await create(own(athlete.caller), { day: daysAgo(0), weightG: 80_000 + i }),
      ),
    )
    expect((await bodyweight(athlete)).weighIns).toHaveLength(1)
  })
})
