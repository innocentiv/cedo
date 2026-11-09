import { elapsedS } from './session-flow.ts'
import { formatMinutes } from './units.ts'

/**
 * Weeks as an athlete reads them (#25): Monday to Sunday, in the device's own time — the server does
 * not know where its people are, so the app says where its week starts (`TodayQuery`) and groups its
 * history here. Every step is a calendar step (`new Date(y, m, d + 7)`), never 7 × 24 hours, so a
 * week across a clock change is still seven days.
 */

/** Monday, M to S: the strip of a week's days. */
export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** `Oct`, `Thu`: each name's first three letters. */
const MONTHS = MONTHS_LONG.map((month) => month.slice(0, 3))
const WEEKDAYS = WEEKDAYS_LONG.map((weekday) => weekday.slice(0, 3))

/** The day of the week, Monday 0 to Sunday 6: where it sits on the week's strip. */
export const dayOfWeek = (at: Date): number => (at.getDay() + 6) % 7

/** Midnight starting the Monday of `at`'s week, local time. */
export function startOfWeek(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() - dayOfWeek(at))
}

const weeksLater = (weekStart: Date, weeks: number): Date =>
  new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7 * weeks)

/** `1 set`, `3 sets`: a count and what it counts, as said aloud. */
export const counted = (count: number, one: string, many = `${one}s`): string =>
  `${String(count)} ${count === 1 ? one : many}`

/** A day of a week's strip, Monday 0 to Sunday 6. */
export interface WeekDay {
  readonly index: number
  /** `M`, `T`… */
  readonly initial: string
  readonly trained: boolean
  readonly today: boolean
}

/**
 * The week starting `weekStart` as its strip shows it: each day, whether someone trained on it, and
 * which is `now`'s.
 */
export function weekStrip(weekStart: Date, startedAt: readonly string[], now: Date): WeekDay[] {
  const end = weeksLater(weekStart, 1)
  const trained = new Set(
    startedAt
      .map((started) => new Date(started))
      .filter((at) => at >= weekStart && at < end)
      .map((at) => dayOfWeek(at)),
  )
  const today = now >= weekStart && now < end ? dayOfWeek(now) : null
  return WEEKDAY_INITIALS.map((initial, index) => ({
    index,
    initial,
    trained: trained.has(index),
    today: index === today,
  }))
}

/** `Thu 23 Oct`: a day as a history row says it. */
export const formatDay = (at: Date): string =>
  `${WEEKDAYS[at.getDay()] ?? ''} ${String(at.getDate())} ${MONTHS[at.getMonth()] ?? ''}`

/** `Tuesday 3 November`: the day in full, as Today heads its page (#61). */
export const formatLongDay = (at: Date): string =>
  `${WEEKDAYS_LONG[at.getDay()] ?? ''} ${String(at.getDate())} ${MONTHS_LONG[at.getMonth()] ?? ''}`

export interface WeekOf<T> {
  /** `This week`, `Last week`, `Week of 6 Oct`. */
  readonly label: string
  readonly items: T[]
}

/**
 * Sessions grouped by the week they were started in, in the order given — newest first, as history
 * is read — each week labelled as said aloud from `now`.
 */
export function byWeek<T extends { readonly startedAt: string }>(
  items: readonly T[],
  now: Date,
): WeekOf<T>[] {
  const thisWeek = startOfWeek(now).getTime()
  const lastWeek = weeksLater(startOfWeek(now), -1).getTime()
  const weeks = new Map<number, T[]>()
  for (const item of items) {
    const start = startOfWeek(new Date(item.startedAt)).getTime()
    weeks.set(start, [...(weeks.get(start) ?? []), item])
  }
  return [...weeks].map(([start, inWeek]) => ({
    label:
      start === thisWeek
        ? 'This week'
        : start === lastWeek
          ? 'Last week'
          : `Week of ${formatDay(new Date(start)).slice(4)}`,
    items: inWeek,
  }))
}

/**
 * A session by the day it followed, else its workout. A plan it follows that the reader cannot see
 * — the athlete's own, read by their coach (#30); a group's, after leaving it — is unavailable, as
 * an exercise out of reach is: never "without a plan", which would say it followed none.
 */
export function sessionName(session: {
  readonly workoutId: string | null
  readonly workoutName: string | null
  readonly dayName: string | null
}): string {
  if (session.dayName !== null) return session.dayName
  if (session.workoutName !== null) return session.workoutName
  return session.workoutId === null ? 'Without a plan' : 'Plan unavailable'
}

/**
 * The same session, opened (#30): named by the day its plan reaches, so its page and its row in the
 * history say one name. A day out of the reader's reach is unavailable, as in the row.
 */
export function openedSessionName(session: {
  readonly workoutId: string | null
  readonly plan:
    | { readonly reachable: true; readonly day: { readonly name: string } }
    | {
        readonly reachable: false
      }
    | null
}): string {
  return sessionName({
    workoutId: session.workoutId,
    workoutName: null,
    dayName: session.plan?.reachable === true ? session.plan.day.name : null,
  })
}

/**
 * `Thu 23 Oct · 52 min · 18 sets`: a session in history, in one line. No duration while it is in
 * progress: it has not taken any time yet that is its own to say.
 */
export function sessionLine(session: {
  readonly startedAt: string
  readonly endedAt: string | null
  readonly setCount: number
}): string {
  const parts = [formatDay(new Date(session.startedAt))]
  if (session.endedAt !== null) {
    parts.push(formatMinutes(elapsedS(session.startedAt, Date.parse(session.endedAt))))
  }
  parts.push(counted(session.setCount, 'set'))
  return parts.join(' · ')
}

/** `PB`, `3 PBs` — a history row's short word for them, said in the gym's own; nothing, for none. */
export const personalBestsShort = (count: number): string | null =>
  count === 0 ? null : count === 1 ? 'PB' : `${String(count)} PBs`

/** `A personal best`, `3 personal bests` — and nothing, for none. */
export const personalBestsLabel = (count: number): string | null =>
  count === 0 ? null : count === 1 ? 'A personal best' : counted(count, 'personal best')
