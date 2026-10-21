/**
 * What each read the API offers is built from, so a client caching them knows what a write makes
 * stale. A fact about the response shapes this package defines — a `Workout` carries each entry's
 * whole `Exercise` — and so kept beside them, where it can be tested.
 *
 * It used to be written per WRITE instead: each mutation listed the reads it affected, and the
 * lists had gaps nobody could see. Renaming an exercise refreshed the library and left the open
 * plan, its progression and a live session showing the old name for the cache's whole window.
 * A read now says what it embeds once, and what a write affects is derived. See
 * docs/08-frontend.md.
 */

/**
 * What a read is built from, and so what a write changes. A session's logs are part of the
 * session: logging and finishing both write to it.
 */
export type Source = 'exercise' | 'workout' | 'session' | 'token' | 'group'

export interface ReadSources {
  /** The source the read is OF. A write to it must be read back before the next write. */
  readonly of: Source
  /** Other sources it carries data from — a name, a tracking mode, a count, an id. */
  readonly embeds: readonly Source[]
}

export const READS = {
  /**
   * Every read but the token list embeds `group`: membership decides what it may answer. Leaving a
   * group takes its plans and exercises with it, and the names they lent your history.
   */
  exerciseList: { of: 'exercise', embeds: ['group'] },
  exercise: { of: 'exercise', embeds: ['group'] },
  /** Logged sets, by session. */
  exerciseHistory: { of: 'exercise', embeds: ['session', 'group'] },
  workoutList: { of: 'workout', embeds: ['group'] },
  /** Every entry carries its whole exercise. */
  workout: { of: 'workout', embeds: ['exercise', 'group'] },
  /** An exercise's name and tracking mode, judged against the caller's logged sessions. */
  progression: { of: 'workout', embeds: ['exercise', 'session', 'group'] },
  /**
   * What a session asks of each entry: its plan, carried forward over the sessions before it, and
   * last time's sets. Of the plan, as progression is — so logging a set refreshes it behind the
   * Log button rather than holding it busy.
   */
  sessionTargets: { of: 'workout', embeds: ['exercise', 'session', 'group'] },
  /** Each session names its workout and day. */
  sessionList: { of: 'session', embeds: ['workout', 'group'] },
  /**
   * Each logged set names its exercise and how it is measured. And the session points into its
   * plan — a workout, a day, an entry per set — which a plan save or delete can set to null.
   */
  session: { of: 'session', embeds: ['exercise', 'workout', 'group'] },
  tokens: { of: 'token', embeds: [] },
  groups: { of: 'group', embeds: [] },
  /** A group's members, as the caller may see them. */
  groupMembers: { of: 'group', embeds: [] },
} as const satisfies Record<string, ReadSources>

export type Read = keyof typeof READS

const isRead = (name: string): name is Read => name in READS
const READ_NAMES: readonly Read[] = Object.keys(READS).filter((name) => isRead(name))

/**
 * The reads a write to `source` makes stale, split by urgency: those OF it, which the next write
 * may depend on (the next set is numbered from the session's refreshed logs), and those that only
 * EMBED it, which can catch up in the background — awaiting them kept the Log button busy until
 * progression had been recomputed, after every set.
 */
export function affectedBy(source: Source): {
  readonly awaited: readonly Read[]
  readonly background: readonly Read[]
} {
  const embedding = (read: Read): boolean =>
    (READS[read].embeds as readonly Source[]).includes(source)
  return {
    awaited: READ_NAMES.filter((read) => READS[read].of === source),
    background: READ_NAMES.filter((read) => READS[read].of !== source && embedding(read)),
  }
}
