import { sql } from 'drizzle-orm'
import { db } from '../client.ts'
import { PERF_VOLUME } from './shape.ts'

/**
 * Athlete notes (#41): `perUser` about each user `who` picks — written by themselves, a day apart,
 * so a person's list is found by its index among everyone's and walked in its order.
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

/** Every user there is so far: the background the profiles' notes are found among. */
export const seedBackgroundNotes = async (): Promise<void> => {
  await seedNotes(sql`true`, PERF_VOLUME.notesPerUser)
}

/** One profile's: as many as its shape says. */
export const seedProfileNotes = async (userId: string, count: number): Promise<void> => {
  await seedNotes(sql`u.id = ${userId}::uuid`, count)
}
