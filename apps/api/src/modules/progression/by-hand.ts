import type { ProgressionSuggestion, TargetByHand } from '@cedo/contract'
import { againstOf, targetByHand } from '@cedo/contract'
import { type Transaction, db } from '../../db/client.ts'
import { invalid, notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { loadsOf } from '../equipment/held.ts'
import { loadEntries } from './entries.ts'
import { suggest } from './evaluate.ts'
import { lockSteps, writeByHand } from './write-steps.ts'

/**
 * A person sets their own target on an entry (ADR-0026): `PUT /workouts/:id/entries/:entryId/target`,
 * the one function an MCP tool will call too (#58). Any entry they can see, a reader of the plan
 * included: a target is its person's, not the plan's, and setting one never writes the plan. From
 * the target they are shown now; only what the rule moves (`targetByHand`), else refused with what
 * to do. Under the person's step lock, taken BEFORE it is read: a finish or a correction at once
 * cannot leave it set from a target already moved.
 */
export async function setTargetByHand(
  caller: Caller,
  workoutId: string,
  entryId: string,
  input: TargetByHand,
): Promise<ProgressionSuggestion> {
  return await db.transaction(async (tx) => {
    await lockSteps(tx, caller)
    const before = await entryTarget(tx, caller, workoutId, entryId)
    const set = targetByHand(before.entry.progression, before.suggestion.suggested, input)
    if ('refused' in set) throw invalid(set.refused, [{ path: '', message: set.refused }])
    await writeByHand(tx, caller, {
      entryId,
      from: before.suggestion.suggested,
      target: set.target,
      against: againstOf(before.entry.progression, before.working),
    })
    return (await entryTarget(tx, caller, workoutId, entryId)).suggestion
  })
}

/** One entry of a workout the caller can see, its working sets, and the target they are shown. */
async function entryTarget(tx: Transaction, caller: Caller, workoutId: string, entryId: string) {
  const loaded = await loadEntries(caller, workoutId, null, tx)
  const entry = loaded?.entries.find((e) => e.id === entryId)
  if (loaded === null || entry === undefined) throw notFound('entry')
  const prescribed = loaded.prescribed.filter((s) => s.entryId === entryId)
  const steps = loaded.steps.filter((s) => s.entryId === entryId)
  const loadFor = await loadsOf(caller.userId, caller.weightUnit, tx)
  const [suggestion] = suggest([entry], prescribed, steps, loadFor)
  if (suggestion === undefined) throw notFound('entry')
  return { entry, suggestion, working: prescribed.filter((s) => !s.isWarmup) }
}
