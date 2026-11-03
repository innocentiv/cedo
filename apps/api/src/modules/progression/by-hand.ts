import type { ProgressionSuggestion, TargetByHand } from '@cedo/contract'
import { againstOf, targetByHand } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { invalid, notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { loadsOf } from '../equipment/held.ts'
import { loadEntries } from './entries.ts'
import { suggest } from './evaluate.ts'
import { writeByHand } from './write-steps.ts'

/**
 * A person sets their own target on an entry (ADR-0026) — `PUT /workouts/:id/entries/:entryId/target`
 * and MCP's `target_set`, one function. Any entry they can see, a reader of the plan included: a
 * target is its person's, not the plan's, and setting one never writes the plan. From the target
 * they are shown now; only what the rule moves (`targetByHand`), else refused with what to do.
 */
export async function setTargetByHand(
  caller: Caller,
  workoutId: string,
  entryId: string,
  input: TargetByHand,
): Promise<ProgressionSuggestion> {
  const before = await entryTarget(caller, workoutId, entryId)
  const set = targetByHand(before.entry.progression, before.suggestion.suggested, input)
  if ('refused' in set) throw invalid(set.refused, [{ path: '', message: set.refused }])
  await db.transaction(async (tx) => {
    await writeByHand(tx, caller, {
      entryId,
      from: before.suggestion.suggested,
      target: set.target,
      against: againstOf(before.entry.progression, before.working),
    })
  })
  return (await entryTarget(caller, workoutId, entryId)).suggestion
}

/** One entry of a workout the caller can see, its working sets, and the target they are shown. */
async function entryTarget(caller: Caller, workoutId: string, entryId: string) {
  const loaded = await loadEntries(caller, workoutId, null)
  const entry = loaded?.entries.find((e) => e.id === entryId)
  if (loaded === null || entry === undefined) throw notFound('entry')
  const prescribed = loaded.prescribed.filter((s) => s.entryId === entryId)
  const steps = loaded.steps.filter((s) => s.entryId === entryId)
  const loadFor = await loadsOf(caller.userId, caller.weightUnit)
  const [suggestion] = suggest([entry], prescribed, steps, loadFor)
  if (suggestion === undefined) throw notFound('entry')
  return { entry, suggestion, working: prescribed.filter((s) => !s.isWarmup) }
}
