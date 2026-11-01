import { eq } from 'drizzle-orm'
import { type TrainingReview, ageThisYear, bodyweightTrend } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { users } from '../../db/schema.ts'
import type { Training } from '../session/service.ts'
import { bodyweightOf } from '../weigh-in/service.ts'

/**
 * What a review says of the athlete themselves (#42): their bodyweight and its change over the
 * period, and their age — what a plan is weighed against, beside what they lifted. The age, never
 * the year they were born: a coach reads this too, and the year is the athlete's alone.
 */
export async function aboutThem(
  training: Training,
  weeks: number,
): Promise<Pick<TrainingReview, 'bodyweight' | 'age'>> {
  const [bodyweight, [them]] = await Promise.all([
    bodyweightOf(training, weeks),
    // Projected: a user row carries its password hash.
    db
      .select({ birthYear: users.birthYear })
      .from(users)
      .where(eq(users.id, training.athleteId))
      .limit(1),
  ])
  const birthYear = them?.birthYear ?? null
  return {
    bodyweight: bodyweightTrend(bodyweight),
    age: birthYear === null ? null : ageThisYear(birthYear, new Date()),
  }
}
