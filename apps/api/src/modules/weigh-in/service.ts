import { type SQL, and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import type { Bodyweight, WeighIn, WeighInInput } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { users, weighIns } from '../../db/schema.ts'
import { notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { ownOrCoached } from '../coaching/athletes.ts'
import type { Training } from '../session/service.ts'

/**
 * Weigh-ins (#42): the caller's bodyweight, or — given `athleteId` — an athlete's they coach. Read
 * and written as athlete notes are (../note/service.ts): by both; removed by whoever took it, or by
 * the person it is about. One a day: another that day replaces it. See GLOSSARY.md, "Weigh-in".
 */

const DAY_MS = 86_400_000

/** Their weigh-ins, with who took each — `and` more, to narrow them. */
const select = (training: Training, ...more: SQL[]) =>
  db
    .select({
      id: weighIns.id,
      day: weighIns.day,
      weightG: weighIns.weightG,
      authorId: weighIns.authorId,
      // Projected: a user row carries its password hash.
      authorName: users.displayName,
    })
    .from(weighIns)
    .leftJoin(users, eq(users.id, weighIns.authorId))
    .where(and(eq(weighIns.athleteId, training.athleteId), ...more))
    .orderBy(desc(weighIns.day))

type Row = Awaited<ReturnType<typeof select>>[number]

const toWeighIn = (training: Training, row: Row): WeighIn => {
  const mine = row.authorId === training.reader.userId
  return {
    id: row.id,
    day: row.day,
    weightG: row.weightG,
    author:
      row.authorId === null || row.authorName === null
        ? null
        : { id: row.authorId, displayName: row.authorName },
    canDelete: mine || training.athleteId === training.reader.userId,
  }
}

/**
 * The weigh-ins of the last `weeks`, newest first, and the latest before them — what the period's
 * change is measured from. At most a year's, one a day, so never paged. The period's first day is
 * the server's: a day either way at its edge, which a trend over weeks does not feel.
 */
export async function bodyweightOf(training: Training, weeks: number): Promise<Bodyweight> {
  const since = new Date(Date.now() - weeks * 7 * DAY_MS).toISOString().slice(0, 10)
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
  const taken = { authorId: caller.userId, weightG: input.weightG, takenAt: sql`now()` }
  const [written] = await db
    .insert(weighIns)
    .values({ athleteId: training.athleteId, day: input.day, ...taken })
    .onConflictDoUpdate({ target: [weighIns.athleteId, weighIns.day], set: taken })
    .returning({ id: weighIns.id })
  // Thrown, not defaulted: an empty id would reach a uuid column as a 500 (ownable/service.ts).
  if (written === undefined) throw new Error('A weigh-in was written and returned nothing')
  const [row] = await select(training, eq(weighIns.id, written.id)).limit(1)
  if (row === undefined) throw notFound('weigh-in')
  return toWeighIn(training, row)
}

/** Removed — by whoever took it, or by the person it is about. */
export async function remove(
  caller: Caller,
  athleteId: string | undefined,
  id: string,
): Promise<void> {
  const training = await ownOrCoached(caller, athleteId)
  const theirs = training.athleteId === caller.userId
  const removed = await db
    .delete(weighIns)
    .where(
      and(
        eq(weighIns.athleteId, training.athleteId),
        eq(weighIns.id, id),
        theirs ? undefined : eq(weighIns.authorId, caller.userId),
      ),
    )
    .returning({ id: weighIns.id })
  if (removed.length === 0) throw notFound('weigh-in')
}
