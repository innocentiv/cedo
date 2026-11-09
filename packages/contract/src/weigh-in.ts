import { z } from 'zod'
import { RecordAuthorship } from './athlete-record.ts'
import { Id } from './primitives.ts'
import { type WeightUnit, formatWeight } from './units.ts'
import { formatDay } from './week.ts'

/**
 * Weigh-ins (#42): a person's bodyweight, one a day — another that day replaces it. The latest is
 * their bodyweight, the ones before it its trend. An athlete record, read and written as every one
 * is (`RecordAuthorship`). See GLOSSARY.md, "Weigh-in".
 */

const MIN_BODYWEIGHT_G = 20_000
const MAX_BODYWEIGHT_G = 400_000

const DAY_MS = 86_400_000

/** `2026-11-01`: the day `at` (ms) falls on in UTC — the server's day, never a person's. */
const utcDayOf = (at: number): string => new Date(at).toISOString().slice(0, 10)

/** The days from `at` back `weeks` weeks, as `utcDayOf` says them: where a period begins. */
export const utcDayWeeksBefore = (at: number, weeks: number): string =>
  utcDayOf(at - weeks * 7 * DAY_MS)

/**
 * A day on the person's own calendar, `YYYY-MM-DD` — theirs, not the server's: a weigh-in at 7am in
 * Sydney is a day ahead of UTC. So no later than tomorrow in UTC, the furthest any calendar runs.
 */
const CalendarDay = z.iso
  .date()
  .refine((day) => day <= utcDayOf(Date.now() + DAY_MS), 'Cannot be a day still to come')

/** `POST` — that day's bodyweight, replacing one already taken that day. */
export const WeighInInput = z.strictObject({
  day: CalendarDay.describe("The day it was taken, on the athlete's calendar: YYYY-MM-DD"),
  weightG: z
    .int()
    .min(MIN_BODYWEIGHT_G, 'At least 20 kg')
    .max(MAX_BODYWEIGHT_G, 'At most 400 kg')
    .describe('Bodyweight in GRAMS: 82.4 kg is 82400'),
})
export type WeighInInput = z.output<typeof WeighInInput>

export const WeighIn = z.object({
  id: Id,
  day: z.iso.date(),
  weightG: z.int(),
  /** Who took it, and whether the reader may remove it. */
  ...RecordAuthorship.shape,
})
export type WeighIn = z.output<typeof WeighIn>

/**
 * `GET /weigh-ins?weeks=` — those of the period, newest first, and the latest before it: what the
 * period's change is measured from.
 */
export const Bodyweight = z.object({
  weighIns: z.array(WeighIn),
  before: WeighIn.nullable(),
})
export type Bodyweight = z.output<typeof Bodyweight>

const DayWeight = WeighIn.pick({ day: true, weightG: true })

/** Their bodyweight and where it came from over a period: what a review says of it. */
export const BodyweightTrend = z.object({
  /** The latest weigh-in, in the period or before it. */
  latest: DayWeight,
  /** What the change is from: the latest before the period, else its first — null with no other. */
  from: DayWeight.nullable(),
})
export type BodyweightTrend = z.output<typeof BodyweightTrend>

const pick = (w: WeighIn) => ({ day: w.day, weightG: w.weightG })

/** The latest weigh-in and what it changed from over the period — null with none at all. */
export function bodyweightTrend(bodyweight: Bodyweight): BodyweightTrend | null {
  const { weighIns, before } = bodyweight
  const latest = weighIns[0] ?? before
  if (latest === null) return null
  const from = weighIns.length === 0 ? null : (before ?? weighIns.at(-1) ?? null)
  return { latest: pick(latest), from: from === null || from === latest ? null : pick(from) }
}

/** A calendar day as a local date: `new Date('2026-11-01')` is UTC midnight — 31 Oct west of it. */
const localDay = (day: string): Date => {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** `Sun 1 Nov`. */
export const formatCalendarDay = (day: string): string => formatDay(localDay(day))

/** `−1.6 kg`, `+0.4 kg`, `no change`. */
export function formatWeightChange(changeG: number, unit: WeightUnit): string {
  if (changeG === 0) return 'no change'
  return `${changeG > 0 ? '+' : '−'}${formatWeight(Math.abs(changeG), unit)}`
}

/** Today on this device's calendar, `YYYY-MM-DD`: the day a weigh-in taken now is of. */
export const calendarDayOf = (at: Date): string =>
  [at.getFullYear(), at.getMonth() + 1, at.getDate()]
    .map((n, i) => String(n).padStart(i === 0 ? 4 : 2, '0'))
    .join('-')

/** A trend's parts, as a screen sets them out: `82.4 kg`, `Fri 30 Oct`, `−1.6 kg since Tue 1 Sep`. */
export function trendParts(
  trend: BodyweightTrend,
  unit: WeightUnit,
): { readonly weight: string; readonly on: string; readonly change: string | null } {
  const { latest, from } = trend
  return {
    weight: formatWeight(latest.weightG, unit),
    on: formatCalendarDay(latest.day),
    change:
      from === null
        ? null
        : `${formatWeightChange(latest.weightG - from.weightG, unit)} since ${formatCalendarDay(from.day)}`,
  }
}

/** `82.4 kg on Fri 30 Oct, −1.6 kg since Tue 1 Sep`: a trend, as a review says it. */
export function trendLine(trend: BodyweightTrend, unit: WeightUnit): string {
  const { weight, on, change } = trendParts(trend, unit)
  return change === null ? `${weight} on ${on}` : `${weight} on ${on}, ${change}`
}

/**
 * `Thu 29 Oct · 82.8 kg`, and `· Dana Okafor` when someone else took it: named only when neither
 * the reader nor the person it is of — a coach's, on the athlete's own Progress.
 */
export function weighInRow(
  weighIn: WeighIn,
  unit: WeightUnit,
  who: { readonly readerId: string; readonly athleteId: string },
): string {
  const row = `${formatCalendarDay(weighIn.day)} · ${formatWeight(weighIn.weightG, unit)}`
  const { author } = weighIn
  return author === null || author.id === who.readerId || author.id === who.athleteId
    ? row
    : `${row} · ${author.displayName}`
}
