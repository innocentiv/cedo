/**
 * What says which SERIES a set counts in: its plan entry, or — logged with none — its exercise.
 * Two entries for one exercise in a day are two series; a set of that exercise logged without an
 * entry is a third. See GLOSSARY.md, "Series".
 */
export interface SeriesMember {
  readonly entryId: string | null
  readonly exerciseId: string
}

export const sameSeries = (a: SeriesMember, b: SeriesMember): boolean =>
  a.entryId === null ? b.entryId === null && a.exerciseId === b.exerciseId : a.entryId === b.entryId

/**
 * The index the next set of `member`'s series takes: one past the highest logged in it, warm-ups
 * included — one sequence, in the order performed. Not a count: counting reused an index after an
 * undo — log sets 1-3, undo set 2, log again, and there were two "Set 3" and no "Set 2" — because a
 * count does not know which one was removed. So a number below the highest is never given again;
 * undoing the LAST set frees its number, and the next set takes it, as a correction would.
 *
 * The server numbers every set with this — under the session's lock, over the logs as the caller
 * sees them, or in a whole session's order sent — and nothing else does. The lock is what keeps a number unique: a
 * database constraint could not, because an entry can be removed from a plan underneath its logs,
 * and those logs then join the exercise's entry-free series with the numbers they already had.
 */
export const nextSetIndex = (
  logs: readonly (SeriesMember & { readonly setIndex: number })[],
  member: SeriesMember,
): number =>
  logs
    .filter((log) => sameSeries(log, member))
    .reduce((next, log) => Math.max(next, log.setIndex + 1), 0)

/** The working sets done in `member`'s series — what a logger shows as "N done". */
export const workingSetsDone = (
  logs: readonly (SeriesMember & { readonly isWarmup: boolean })[],
  member: SeriesMember,
): number => logs.filter((log) => !log.isWarmup && sameSeries(log, member)).length
