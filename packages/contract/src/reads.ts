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
 * session: logging and finishing both write to it. `target` is the caller's targets — their steps
 * (ADR-0026) — written by what moves one: finishing a session, fixing a finished one (#31), a target
 * set by hand; no read is OF it, it names what only those change. `athlete`
 * is someone else's training, read by their coach (#30): they write it, on their own device, so
 * no write here is ever OF it — it catches up on the cache's window, and with what it embeds.
 * `equipment` is what the caller has to train with (#34): every exercise read says whether they
 * can do it (#35). `note` is athlete notes (#41) — the caller's own, and an athlete's, which their
 * coach writes too: unlike the rest of `athlete`, a write here is OF it. `weighIn` is weigh-ins
 * (#42), written alike, and read too by the review, which says the latest.
 */
export type Source =
  | 'exercise'
  | 'workout'
  | 'session'
  | 'target'
  | 'token'
  | 'group'
  | 'athlete'
  | 'equipment'
  | 'note'
  | 'weighIn'
  | 'instance'

export interface ReadSources {
  /** The source the read is OF. A write to it must be read back before the next write. */
  readonly of: Source
  /** Other sources it carries data from — a name, a tracking mode, a count, an id. */
  readonly embeds: readonly Source[]
  /**
   * Caught up behind a write to what it is OF, never awaited: nothing the next write does depends on
   * it, and it costs a whole aggregation to read again — the training review, after every set.
   */
  readonly lagging?: true
}

export const READS = {
  /**
   * Every read but the token list embeds `group`: membership decides what it may answer. Leaving a
   * group takes its plans and exercises with it, and the names they lent your history.
   */
  exerciseList: { of: 'exercise', embeds: ['group', 'equipment'] },
  exercise: { of: 'exercise', embeds: ['group', 'equipment'] },
  /** Logged sets, by session. */
  exerciseHistory: { of: 'exercise', embeds: ['session', 'group'] },
  /** The exercises logged most lately (#27): a set logged moves one to the top. */
  recentExercises: { of: 'exercise', embeds: ['session', 'group', 'equipment'] },
  workoutList: { of: 'workout', embeds: ['group'] },
  /** Every entry carries its whole exercise. */
  workout: { of: 'workout', embeds: ['exercise', 'group', 'equipment'] },
  /**
   * The caller's targets on a plan (ADR-0026): an exercise's name and tracking mode, their steps —
   * `target`, which only a finish, a fix or a target set by hand moves, never a set logged in a
   * session in progress — and weights snapped to their equipment (#36).
   */
  progression: { of: 'workout', embeds: ['exercise', 'target', 'group', 'equipment'] },
  /**
   * What a session asks of each entry: its plan, carried forward by the caller's steps, and last
   * time's sets. Of the plan: a save changes what it prescribes. Not `session`: its own sets never
   * count, and logging one would read it again for nothing — but `target`, which a finish moves,
   * and in weights the caller's equipment loads (#36).
   */
  sessionTargets: { of: 'workout', embeds: ['exercise', 'target', 'group', 'equipment'] },
  /**
   * Each session names its workout and day, and counts its personal bests — judged by each
   * exercise's tracking mode, as far as the reader can see the exercise (#25).
   */
  sessionList: { of: 'session', embeds: ['exercise', 'workout', 'group'] },
  /**
   * The first screen (#25): the session in progress and this week's — sessions — and the next day
   * of the current workout, by name and its exercises' names.
   */
  today: { of: 'session', embeds: ['exercise', 'workout', 'group'] },
  /** The training review (#28): every session of the period, judged. */
  review: { of: 'session', embeds: ['exercise', 'workout', 'group', 'weighIn'], lagging: true },
  /**
   * Each logged set names its exercise and how it is measured. And the session points into its
   * plan — a workout, a day, an entry per set — which a plan save or delete can set to null. Its
   * day's exercises say whether each is doable (#35), by what the athlete has.
   */
  session: { of: 'session', embeds: ['exercise', 'workout', 'group', 'equipment'] },
  /** Who shares their training with a group the caller edits: membership, and its switch. */
  athletes: { of: 'group', embeds: [] },
  /** An athlete's sessions, named as their coach can see what they followed and logged (#30). */
  athleteSessions: { of: 'athlete', embeds: ['exercise', 'workout', 'group'] },
  athleteSession: { of: 'athlete', embeds: ['exercise', 'workout', 'group'] },
  athleteHistory: { of: 'athlete', embeds: ['exercise', 'group'] },
  athleteReview: { of: 'athlete', embeds: ['exercise', 'workout', 'group', 'weighIn'] },
  /** What they have to train with (#34), while they share it. */
  athleteEquipment: { of: 'athlete', embeds: ['group'] },
  /** What the caller has to train with (#34). */
  equipment: { of: 'equipment', embeds: [] },
  /** What is known about the caller (#41), and about an athlete while they share their training. */
  notes: { of: 'note', embeds: [] },
  athleteNotes: { of: 'note', embeds: ['group'] },
  /** Their bodyweight over a period (#42), and an athlete's while they share their training. */
  bodyweight: { of: 'weighIn', embeds: [] },
  athleteBodyweight: { of: 'weighIn', embeds: ['group'] },
  tokens: { of: 'token', embeds: [] },
  groups: { of: 'group', embeds: [] },
  /** A group's members, as the caller may see them. */
  groupMembers: { of: 'group', embeds: [] },
  /** The instance itself (#71): whether it takes new accounts, which only its curator changes. */
  instance: { of: 'instance', embeds: [] },
} as const satisfies Record<string, ReadSources>

export type Read = keyof typeof READS

const isRead = (name: string): name is Read => name in READS
const READ_NAMES: readonly Read[] = Object.keys(READS).filter((name) => isRead(name))

/**
 * The reads a write to `source` makes stale, split by urgency: those OF it, which the next write
 * may depend on (the next set is numbered from the session's refreshed logs), and those that only
 * EMBED it, which can catch up in the background — awaiting them kept the Log button busy until
 * progression had been recomputed, after every set. A write to several sources at once — a fix to
 * a finished session is to `session` and `target` — makes stale what any of them would.
 */
export function affectedBy(...sources: readonly Source[]): {
  readonly awaited: readonly Read[]
  readonly background: readonly Read[]
} {
  const embedding = (read: Read): boolean =>
    (READS[read].embeds as readonly Source[]).some((source) => sources.includes(source))
  const lagging = (read: Read): boolean => (READS[read] as ReadSources).lagging === true
  const of = (read: Read): boolean => sources.includes(READS[read].of)
  return {
    awaited: READ_NAMES.filter((read) => of(read) && !lagging(read)),
    background: READ_NAMES.filter(
      (read) => (of(read) && lagging(read)) || (!of(read) && embedding(read)),
    ),
  }
}
