import { z } from 'zod'
import { LoadLimit } from './load.ts'
import { LoggedEffort } from './log.ts'
import { SetTarget } from './progression.ts'

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
})
export type EntryTarget = z.output<typeof EntryTarget>
