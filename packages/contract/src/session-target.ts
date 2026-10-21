import { z } from 'zod'
import { LoggedDistanceMm, LoggedDurationS, LoggedReps, LoggedWeightG } from './measurement.ts'
import { SetTarget } from './progression.ts'

/** What a logged set measured — what "last time" carries. */
export const LoggedEffort = z.object({
  reps: LoggedReps.nullable(),
  weightG: LoggedWeightG.nullable(),
  durationS: LoggedDurationS.nullable(),
  distanceMm: LoggedDistanceMm.nullable(),
})
export type LoggedEffort = z.output<typeof LoggedEffort>

/**
 * What one entry of a session asks for, and what was done last time — `GET /sessions/:id/targets`,
 * what the logger is pre-filled with.
 *
 * `target` is the plan's prescription carried forward by the entry's rule over the sessions that
 * started BEFORE this one, never this one itself: counted with its own sets, the next set of a
 * session whose sets had all hit would be offered the advanced weight mid-session. The plan is not
 * written to: it stays what its author prescribed, and progression carries it forward from there.
 */
export const EntryTarget = z.object({
  entryId: z.uuid(),
  /** What the plan prescribes. */
  prescribed: SetTarget,
  /** What this session asks for. */
  target: SetTarget,
  /** Whether the rule moved it — the logger says so beside the prescription. */
  changed: z.boolean(),
  /**
   * The working sets of the latest earlier session that logged this exercise — in this plan or any
   * other, or none — in set order. Null when there is none.
   */
  last: z.array(LoggedEffort).nullable(),
})
export type EntryTarget = z.output<typeof EntryTarget>
