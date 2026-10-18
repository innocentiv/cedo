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
 * What a write changes. A session's logs are part of the session: logging and finishing both are.
 * A media item stands alone until an exercise is saved with it — that save is the exercise write —
 * so no read is built from `media` itself, and creating one makes nothing stale.
 */
export type Resource = 'exercise' | 'workout' | 'session' | 'token' | 'group' | 'media'

export interface ReadSources {
  /** The resource the read is OF. A write to it must be read back before the next write. */
  readonly of: Resource
  /** Other resources it carries data from — a name, a tracking mode, a count. */
  readonly embeds: readonly Resource[]
}

export const READS = {
  exerciseList: { of: 'exercise', embeds: [] },
  exercise: { of: 'exercise', embeds: [] },
  /** Logged sets, by session. */
  exerciseHistory: { of: 'exercise', embeds: ['session'] },
  workoutList: { of: 'workout', embeds: [] },
  /** Every entry carries its whole exercise. */
  workout: { of: 'workout', embeds: ['exercise'] },
  /** An exercise's name and tracking mode, judged against the caller's logged sessions. */
  progression: { of: 'workout', embeds: ['exercise', 'session'] },
  /** Each session names its workout and day. */
  sessionList: { of: 'session', embeds: ['workout'] },
  /** Each logged set names its exercise and how it is measured. */
  session: { of: 'session', embeds: ['exercise'] },
  tokens: { of: 'token', embeds: [] },
  groups: { of: 'group', embeds: [] },
} as const satisfies Record<string, ReadSources>

export type Read = keyof typeof READS

const isRead = (name: string): name is Read => name in READS
const READ_NAMES: readonly Read[] = Object.keys(READS).filter((name) => isRead(name))

/**
 * The reads a write to `resource` makes stale, split by urgency: those OF it, which the next write
 * may depend on (the next set is numbered from the session's refreshed logs), and those that only
 * EMBED it, which can catch up in the background — awaiting them kept the Log button busy until
 * progression had been recomputed, after every set.
 */
export function affectedBy(resource: Resource): {
  readonly awaited: readonly Read[]
  readonly background: readonly Read[]
} {
  const embedding = (read: Read): boolean =>
    (READS[read].embeds as readonly Resource[]).includes(resource)
  return {
    awaited: READ_NAMES.filter((read) => READS[read].of === resource),
    background: READ_NAMES.filter((read) => READS[read].of !== resource && embedding(read)),
  }
}
