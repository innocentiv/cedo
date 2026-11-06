import { useMemo, useReducer, useState } from 'react'
import {
  type ChoiceEvent,
  type Chosen,
  type Exercise,
  NO_CHOICES,
  type SessionEntry,
  type SessionEntryTarget,
  type SessionExercise,
  type SessionPlan,
  type SetLog,
  type WorkoutChoices,
  type WorkoutView,
  choicesAfter,
  exercisesInSession,
  workoutView,
} from '@cedo/contract'
import { type PendingLog, type SessionSets, setsOfSession } from '../api/pending.ts'
import { useSession, useSessionTargets } from '../api/queries.ts'
import { useQueuedSends, useRemoveLog, useUpdateSession } from '../api/session-queries.ts'
import { useRecordSet } from './record-set.ts'
import { useLoads } from './use-loads.ts'
import { useSubmit } from './use-submit.ts'

/** Stable, so an absent session does not recompute the exercises on every render. */
const NO_LOGS: readonly SetLog[] = []
const NO_TARGETS: readonly SessionEntryTarget[] = []

/** Tells `choicesAfter` what the athlete did. */
type Did = (event: ChoiceEvent) => void

/** What the workout screen shows: the contract's `workoutView`, of this session. */
export type WorkoutShown = WorkoutView<
  SessionEntry,
  SessionExercise,
  PendingLog,
  SessionEntryTarget
>

/**
 * A session's sets, as every part of the workout reads and changes them: as `setsOfSession` reads
 * them — those still waiting for a signal counted as done (#9) — and the writes to them.
 */
export interface WorkoutSets extends SessionSets {
  readonly record: ReturnType<typeof useRecordSet>
  /** Takes back a set the server has: its entry takes the focus, from what it said (#63). */
  readonly undo: (log: SetLog) => void
}

/**
 * Everything the workout screen reads and writes, and the little it holds of its own — the menu, the
 * how-to, the exercises picked into a session without a plan (#24). The route renders it; the rules
 * are the contract's `session-flow` and `workout-view`.
 */
export function useWorkout(id: string) {
  const session = useSession(id)
  const plan = session.data?.plan
  const targets = useSessionTargets(id, plan?.reachable === true)
  const sends = useQueuedSends(id)
  const record = useRecordSet(id)
  const submission = useSubmit()
  const menu = useMenu()
  const [howTo, setHowTo] = useState<{ exercise: Exercise; cue: string | null } | null>(null)
  const serverLogs = session.data?.logs ?? NO_LOGS
  // What the athlete chose (GLOSSARY.md, "Focus"): each thing they do here goes to `choicesAfter`.
  const [choices, did] = useReducer(choicesAfter, NO_CHOICES)
  const writes = useSessionWrites(id, submission.submit, menu.hide, did)
  const picks = useAdHocPicks(serverLogs, did)
  const ended = session.data?.endedAt != null
  const sets = workoutSets(setsOfSession(serverLogs, sends), record, writes.undo, did)

  return {
    id,
    session,
    plan,
    targets,
    sets,
    ended,
    /**
     * A session with no plan and nothing in it yet opens on the picker (#24) — there is nothing
     * else to do on it — until the athlete cancels it.
     */
    opensOnPicker:
      session.data !== undefined &&
      plan === null &&
      !ended &&
      picks.adHocExercises.length === 0 &&
      !picks.declined,
    /** What the session already holds — its day's entries, and what was added — for the picker. */
    inSession: new Set([
      ...(plan?.reachable === true ? plan.day.entries.map((e) => e.exerciseId) : []),
      ...picks.adHocExercises.map((e) => e.id),
    ]),
    error: record.error ?? submission.error,
    refused: submission.error,
    busy: submission.busy,
    menu,
    howTo,
    setHowTo,
    ...picks,
    ...writes,
    ...useView(plan, targets.data, sets, picks.adHocExercises, [choices, did]),
  }
}

export type Workout = ReturnType<typeof useWorkout>

/** The sets as `setsOfSession` reads them, and the writes to them. Logging one tells `choicesAfter`. */
const workoutSets = (
  read: SessionSets,
  record: WorkoutSets['record'],
  undo: WorkoutSets['undo'],
  did: Did,
): WorkoutSets => ({
  ...read,
  record: {
    ...record,
    log: (...set) => {
      did({ kind: 'logged' })
      record.log(...set)
    },
  },
  undo,
})

/**
 * The day the session follows, and what the screen shows of it (the contract's `workoutView`) with
 * what the athlete chose.
 */
function useView(
  plan: SessionPlan | undefined,
  targets: readonly SessionEntryTarget[] | undefined,
  sets: WorkoutSets,
  added: readonly SessionExercise[],
  [choices, did]: readonly [WorkoutChoices, Did],
) {
  const loads = useLoads()
  // The plan as the server says the reader can reach it (`SessionPlan`) — never decided here.
  const day = plan?.reachable === true ? plan.day : undefined
  const view: WorkoutShown = workoutView({
    day: day ?? null,
    targets: targets ?? NO_TARGETS,
    sets: sets.all,
    added,
    choices,
    loadFor: (entry) => loads(entry.exercise),
  })
  return {
    day,
    /** What the screen shows, by the contract's rules: the focus, the set shown, "+ set". */
    view,
    /** An entry tapped in Up next, an exercise among those added, or "+ set": put in focus. */
    choose: (chosen: Chosen) => {
      did({ kind: 'tapped', chosen })
    },
  }
}

/** The session's menu: open, or not. */
function useMenu() {
  const [open, setOpen] = useState(false)
  return {
    open,
    show: () => {
      setOpen(true)
    },
    hide: () => {
      setOpen(false)
    },
  }
}

/**
 * The exercises logged with no plan entry — the whole of a session without a plan, or the swaps in
 * one with a plan — then any picked since (`exercisesInSession`). Picks are local: once a set is
 * logged, the log carries the exercise. Going to pick, and what is picked, say so to `choicesAfter`.
 */
function useAdHocPicks(logs: readonly SetLog[], did: Did) {
  const [picking, setPicking] = useState(false)
  const [declined, setDeclined] = useState(false)
  const [picked, setPicked] = useState<Exercise[]>([])
  return {
    adHocExercises: useMemo(() => exercisesInSession(logs, picked), [logs, picked]),
    /** Whole, as picked: how to do them can be shown. */
    picked,
    picking,
    declined,
    startPicking: () => {
      did({ kind: 'pickerOpened' })
      setPicking(true)
    },
    cancelPicking: () => {
      setPicking(false)
      setDeclined(true)
    },
    /** Several at once (#27), in the order picked. */
    pick: (exercises: readonly Exercise[]) => {
      const ids = new Set(exercises.map((e) => e.id))
      setPicked((now) => [...now.filter((e) => !ids.has(e.id)), ...exercises])
      did({ kind: 'picked', exercises })
      setPicking(false)
    },
  }
}

/** Finishing, notes and undo — each through `submit`, so a refusal is said on the screen. */
function useSessionWrites(
  id: string,
  submit: ReturnType<typeof useSubmit>['submit'],
  closeMenu: () => void,
  did: Did,
) {
  const update = useUpdateSession(id)
  const removeLog = useRemoveLog(id)
  return {
    finish: async () => {
      await submit(async () => {
        await update.mutateAsync({ endedAt: new Date().toISOString() })
        closeMenu()
      })
    },
    saveNotes: async (notes: string | null) => {
      await submit(async () => {
        await update.mutateAsync({ notes })
      })
    },
    // A set finished on another device answers 404, and says so.
    undo: (log: SetLog) => {
      did({ kind: 'undone', set: log })
      void submit(async () => {
        await removeLog.mutateAsync(log.id)
      })
    },
  }
}
