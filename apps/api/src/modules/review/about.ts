import { eq } from 'drizzle-orm'
import { type TrainingReview, bodyweightTrend } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { users } from '../../db/schema.ts'
import type { Training } from '../session/service.ts'
import { bodyweightOf } from '../weigh-in/service.ts'

/**
 * What a review says of the athlete themselves (#42): their bodyweight and its change over the
 * period, and the year they were born — what a plan is weighed against, beside what they lifted.
 */
export async function aboutThem(
  training: Training,
  weeks: number,
): Promise<Pick<TrainingReview, 'bodyweight' | 'birthYear'>> {
  const [bodyweight, [them]] = await Promise.all([
    bodyweightOf(training, weeks),
    // Projected: a user row carries its password hash.
    db
      .select({ birthYear: users.birthYear })
      .from(users)
      .where(eq(users.id, training.athleteId))
      .limit(1),
  ])
  return { bodyweight: bodyweightTrend(bodyweight), birthYear: them?.birthYear ?? null }
}
