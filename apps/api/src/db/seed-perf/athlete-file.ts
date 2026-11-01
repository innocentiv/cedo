import { sql } from 'drizzle-orm'
import { db } from '../client.ts'
import { PERF_VOLUME, type Shape } from './shape.ts'

/**
 * The athlete's file: notes (#41) and weigh-ins (#42) — `perUser` of each about each user `who`
 * picks, written by themselves a day apart, so a person's are found by index among everyone's and
 * walked in their order.
 */
async function seedNotes(who: ReturnType<typeof sql>, perUser: number): Promise<void> {
  await db.execute(sql`
    insert into athlete_notes (athlete_id, author_id, text, written_at)
    select u.id, u.id, 'Remember: note ' || n, now() - n * interval '1 day'
      from users u
      cross join generate_series(1, ${perUser}) n
     where ${who}
  `)
}

/** One a day, going back from today: a weight that wanders between 80 and 85 kg. */
async function seedWeighIns(who: ReturnType<typeof sql>, perUser: number): Promise<void> {
  await db.execute(sql`
    insert into weigh_ins (athlete_id, author_id, day, weight_g)
    select u.id, u.id, current_date - n, 80000 + (n * 37 % 5000)
      from users u
      cross join generate_series(0, ${perUser} - 1) n
     where ${who}
  `)
}

/** Every user there is so far: the background the profiles' files are found among. */
export const seedBackgroundFiles = async (): Promise<void> => {
  await seedNotes(sql`true`, PERF_VOLUME.notesPerUser)
  await seedWeighIns(sql`true`, PERF_VOLUME.weighInsPerUser)
}

/** One profile's: as many as its shape says. */
export const seedProfileFile = async (
  userId: string,
  shape: Pick<Shape, 'notes' | 'weighIns'>,
): Promise<void> => {
  await seedNotes(sql`u.id = ${userId}::uuid`, shape.notes)
  await seedWeighIns(sql`u.id = ${userId}::uuid`, shape.weighIns)
}
