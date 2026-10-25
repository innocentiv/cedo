import { useEffect, useRef, useState } from 'react'
import { type Exercise, type Workout, planIssues } from '@cedo/contract'
import { ApiError } from '../api/http.ts'
import { useReplacePlan } from '../api/queries.ts'
import { type DayDraft, toPlanInput } from './plan-draft.ts'
import { type PlanSync, type SyncEvent, startSync, step, unsaved } from './plan-sync.ts'

/** Every exercise the plan can name: the ones it already resolves, and any picked since. */
function knownExercises(workout: Workout, picked: ReadonlyMap<string, Exercise>) {
  const known = new Map<string, Exercise>()
  for (const day of workout.days) {
    for (const entry of day.entries) {
      if (entry.exercise !== null) known.set(entry.exerciseId, entry.exercise)
    }
  }
  for (const [id, exercise] of picked) known.set(id, exercise)
  return known
}

/**
 * Every exercise the plan can name, and picking another into it. A ref as well as state: an
 * exercise picked is known to the very change that adds it, before the next render.
 */
function usePicked(workout: Workout) {
  const picked = useRef<ReadonlyMap<string, Exercise>>(new Map())
  const [, setPicked] = useState(picked.current)
  return {
    library: knownExercises(workout, picked.current),
    known: () => knownExercises(workout, picked.current),
    /** An exercise picked into the plan: known from now on, its name and how it is measured. */
    pick: (exercise: Exercise) => {
      picked.current = new Map(picked.current).set(exercise.id, exercise)
      setPicked(picked.current)
    },
  }
}

/**
 * One save, and what came of it: saved; refused, with the server's reason; or — saved elsewhere
 * since (409) — the plan as it is now, read again. Null when even that read failed: the page keeps
 * what it shows, and the next change tries again.
 */
async function saveOnce(
  save: () => Promise<Workout>,
  reread: () => Promise<Workout | undefined>,
): Promise<SyncEvent | null> {
  try {
    return { kind: 'saved', workout: await save() }
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      const fresh = await reread()
      return fresh === undefined
        ? null
        : { kind: 'reloaded', workout: fresh, reason: error.message }
    }
    return { kind: 'refused', reason: error instanceof Error ? error.message : 'Not saved' }
  }
}

/**
 * A workout's plan, edited in place (#26, ADR-0022): the page's copy, every change saved as it is
 * made, and what to say about it. When to send and what a refusal does are `plan-sync.ts`'s; this
 * sends, and reads the plan again after a conflict.
 */
export function usePlanEditor(workout: Workout, reread: () => Promise<Workout | undefined>) {
  const replace = useReplacePlan(workout.id)
  const { library, known, pick } = usePicked(workout)
  const [sync, setSync] = useState<PlanSync>(() => startSync(workout))
  // Answers arrive after renders: each event steps from the latest state, not a render's.
  const latest = useRef(sync)
  const issuesOf = (days: readonly DayDraft[]) => planIssues(toPlanInput(days), known())

  const dispatch = (event: SyncEvent): void => {
    const next = step(latest.current, event, (days) => issuesOf(days).length === 0)
    latest.current = next.state
    setSync(next.state)
    if (next.send !== null) void send(next.send, next.state.version)
  }

  const send = async (days: readonly DayDraft[], version: number): Promise<void> => {
    const outcome = await saveOnce(
      async () => await replace.mutateAsync({ ...toPlanInput(days), version }),
      reread,
    )
    if (outcome !== null) dispatch(outcome)
  }

  // Read again elsewhere — another device saved it — it is taken while nothing here is unsaved.
  useEffect(() => {
    dispatch({ kind: 'fetched', workout })
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- on a new read only.
  }, [workout])

  const issues = issuesOf(sync.days)
  return {
    days: sync.days,
    library,
    change: (days: readonly DayDraft[]) => {
      dispatch({ kind: 'edit', days })
    },
    pick,
    /** What the page says of the plan it shows. */
    status: {
      saving: sync.sending !== null,
      unsaved: unsaved(sync),
      issues,
      said: sync.said,
    },
  }
}

export type PlanEditor = ReturnType<typeof usePlanEditor>
