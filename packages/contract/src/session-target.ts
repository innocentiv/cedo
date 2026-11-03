import { z } from 'zod'
import { formatEffort } from './effort.ts'
import type { TrackingMode } from './exercise.ts'
import { LOAD_LIMIT_WORDS, LoadLimit } from './load.ts'
import { LoggedEffort } from './log.ts'
import { Held, SetTarget } from './progression.ts'
import { formatReserve, formatWithReserve } from './rpe.ts'
import type { WeightUnit } from './units.ts'

/**
 * What one entry of a session asks for, and what was done last time — `GET /sessions/:id/targets`,
 * what the logger is pre-filled with.
 *
 * `target` is the plan's prescription carried forward by the entry's rule over the sessions that
 * started BEFORE this one, never this one itself: counted with its own sets, the next set of a
 * session whose sets had all hit would be offered the advanced weight mid-session. The plan is not
 * written to: it stays what its author prescribed, and progression carries it forward from there.
 *
 * `target`'s weight is one the athlete can load (#36) — the heaviest their equipment loads that is
 * not above it — and progression judged their last session against that, not the plan's.
 */
export const EntryTarget = z.object({
  entryId: z.uuid(),
  /** What the plan prescribes. */
  prescribed: SetTarget,
  /** What this session asks for. */
  target: SetTarget,
  /** Whether the rule moved it — the logger says so beside the prescription. */
  changed: z.boolean(),
  /** Why the rule held it, if something did (#45) — the logger says so when it was the effort. */
  held: Held.nullable(),
  /**
   * Where the athlete's equipment stopped its weight (#36): their heaviest, under a heavier plan,
   * or their lightest, over a lighter one. Null otherwise — and while what they load is unknown.
   */
  limit: LoadLimit.nullable(),
  /**
   * The working sets of the latest earlier session that logged this exercise — in this plan or any
   * other, or none — in the order they were logged. Null when there is none.
   */
  last: z.array(LoggedEffort).nullable(),
  /**
   * What each warm-up asks, in set order: its own line, its weight following the working target in
   * proportion (`warmupsFor`, ADR-0026) — worked out as it is read, never kept.
   */
  warmups: z.array(SetTarget),
})
export type EntryTarget = z.output<typeof EntryTarget>

/**
 * What the logger says beside an entry's target: moved by the rule, beside what the plan says; held
 * for effort (#45), with the reserve a set left — the one reason a prescription held that is nowhere
 * else on the screen, since last time's sets, beside it, show a missed rep but not a ground-out one; or as
 * prescribed. Where the athlete's equipment stopped it (#36) is said after the target.
 */
export function targetLine(asked: EntryTarget, tracking: TrackingMode, unit: WeightUnit): string {
  const limit = asked.limit === null ? '' : ` · ${LOAD_LIMIT_WORDS[asked.limit]}`
  const target = `${formatWithReserve(asked.target, tracking, unit)}${limit}`
  if (asked.changed) {
    return `Progressed to ${target} · the plan says ${formatEffort(asked.prescribed, tracking, unit)}`
  }
  if (asked.held?.reason === 'effort') {
    // "a recent set", not "last time": with a streak to clear, an older session can be the one.
    return `Held at ${target} · a recent set left ${formatReserve(asked.held.reserve)} in reserve`
  }
  return `Prescribed ${target}`
}
