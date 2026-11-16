import { type TrainingReview, msToDays } from '@cedo/contract'

/**
 * Pure: dates in, adherence out, as of `now` — handed in, never read here, so the calendar
 * arithmetic is unit-tested (adherence.test.ts) at a day of the test's choosing.
 */

export function adherenceOf(
  /** Newest first, as the review reads them. */
  sessions: readonly { startedAt: Date }[],
  weeks: number,
  /** When the review is read, epoch ms. */
  now: number,
): TrainingReview['adherence'] {
  const times = sessions.map((s) => s.startedAt.getTime())
  const last = times[0]

  let longestGapDays = 0
  for (let i = 0; i + 1 < times.length; i++) {
    const a = times[i]
    const b = times[i + 1]
    if (a === undefined || b === undefined) continue
    longestGapDays = Math.max(longestGapDays, Math.round(msToDays(a - b)))
  }

  /**
   * Counted in DISTINCT CALENDAR DAYS, not sessions. Counting sessions reported a two-day streak
   * for a morning and an evening workout on the same date, while the field is named `...Days` and
   * an AI coach reasons about it as days.
   *
   * A one-day rest does not break it: training every other day is a streak, which a naive
   * consecutive-days count would miss.
   */
  const days = [...new Set(times.map((t) => Math.floor(msToDays(t))))].toSorted((a, b) => b - a)
  let currentStreakDays = 0
  const today = Math.floor(msToDays(now))
  if (days[0] !== undefined && today - days[0] <= 1) {
    currentStreakDays = 1
    for (let i = 0; i + 1 < days.length; i++) {
      const a = days[i]
      const b = days[i + 1]
      if (a === undefined || b === undefined) break
      if (a - b > 2) break
      currentStreakDays += 1
    }
  }

  return {
    sessions: sessions.length,
    perWeek: Math.round((sessions.length / weeks) * 10) / 10,
    currentStreakDays,
    longestGapDays,
    lastSessionAt: last === undefined ? null : new Date(last).toISOString(),
  }
}
