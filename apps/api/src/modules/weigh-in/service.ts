import { type SQL, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { type Bodyweight, type WeighIn, type WeighInInput, utcDayWeeksBefore } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { users, weighIns } from '../../db/schema.ts'
import { notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { athleteRecords } from '../athlete-record/records.ts'
import { type Training, ownOrCoached } from '../coaching/training.ts'

/**
 * Weigh-ins (#42): the caller's bodyweight, or — given `athleteId` — an athlete's they coach. An
 * athlete record (../athlete-record/records.ts): read, written and removed as every one is. What
 * is a weigh-in's own: one a day — another that day replaces it — read over a period. See
 * GLOSSARY.md, "Weigh-in".
 */

const records = athleteRecords(weighIns, 'weigh-in')

/** Their weigh-ins, with who took each — `and` more, to narrow them. */
const select = (training: Training, ...more: SQL[]) =>
  db
    .select({
      id: weighIns.id,
      day: weighIns.day,
      weightG: weighIns.weightG,
      ...records.authorColumns,
    })
    .from(weighIns)
    .leftJoin(users, records.byAuthor)
    .where(records.of(training, ...more))
    .orderBy(desc(weighIns.day))

type Row = Awaited<ReturnType<typeof select>>[number]

const toWeighIn = (training: Training, row: Row): WeighIn => ({
  id: row.id,
  day: row.day,
  weightG: row.weightG,
  ...records.authored(training, row),
})

/**
 * The weigh-ins of the last `weeks`, newest first, and the latest before them — what the period's
 * change is measured from. At most a year's, one a day, so never paged. The period's first day is
 * the server's: a day either way at its edge, which a trend over weeks does not feel.
 */
export async function bodyweightOf(training: Training, weeks: number): Promise<Bodyweight> {
  const since = utcDayWeeksBefore(Date.now(), weeks)
  const [inPeriod, [before]] = await Promise.all([
    select(training, gte(weighIns.day, since)),
    select(training, lt(weighIns.day, since)).limit(1),
  ])
  return {
    weighIns: inPeriod.map((row) => toWeighIn(training, row)),
    before: before === undefined ? null : toWeighIn(training, before),
  }
}

export async function list(
  caller: Caller,
  athleteId: string | undefined,
  weeks: number,
): Promise<Bodyweight> {
  return await bodyweightOf(await ownOrCoached(caller, athleteId), weeks)
}

/** That day's bodyweight — replacing one already taken that day, by whoever took it. */
export async function create(
  caller: Caller,
  athleteId: string | undefined,
  input: WeighInInput,
): Promise<WeighIn> {
  const training = await ownOrCoached(caller, athleteId)
  const taken = { authorId: training.reader.userId, weightG: input.weightG, takenAt: sql`now()` }
  const [written] = await db
    .insert(weighIns)
    .values({ athleteId: training.athleteId, day: input.day, ...taken })
    .onConflictDoUpdate({ target: [weighIns.athleteId, weighIns.day], set: taken })
    .returning({ id: weighIns.id })
  const [row] = await select(training, eq(weighIns.id, records.inserted(written).id)).limit(1)
  if (row === undefined) throw notFound('weigh-in')
  return toWeighIn(training, row)
}

/** Removed — by whoever took it, or by the person it is about. */
export const remove = records.remove
