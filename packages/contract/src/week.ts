import { elapsedS } from './session-flow.ts'

/**
 * Weeks as an athlete reads them (#25): Monday to Sunday, in the device's own time — the server does
 * not know where its people are, so the app says where its week starts (`TodayQuery`) and groups its
 * history here. Every step is a calendar step (`new Date(y, m, d + 7)`), never 7 × 24 hours, so a
 * week across a clock change is still seven days.
 */

/** Monday, M to S: the strip of a week's days. */
export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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

/** `52 min`, `1 h 5 min`: how long a session took, as a history row says it. */
export function formatMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${String(minutes)} min`
  const rest = minutes % 60
  return `${String(Math.floor(minutes / 60))} h${rest === 0 ? '' : ` ${String(rest)} min`}`
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
