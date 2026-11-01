import { useMemo, useState } from 'react'
import {
  type EntryTarget,
  type Exercise,
  NO_CHOICES,
  type Reopened,
  type SessionEntry,
  type SessionExercise,
  type SessionPlan,
  type SetLog,
  type WorkoutChoices,
  type WorkoutView,
  exercisesInSession,
  workoutView,
} from '@cedo/contract'
import { type PendingLog, withPending } from '../api/pending.ts'
import { useSession, useSessionTargets } from '../api/queries.ts'
import { useRemoveLog, useUnsentSets, useUpdateSession } from '../api/session-queries.ts'
import { useRecordSet } from './record-set.ts'
import { useLoads } from './use-loads.ts'
import { useSubmit } from './use-submit.ts'

/** Stable, so an absent session does not recompute the exercises on every render. */
const NO_LOGS: readonly SetLog[] = []
const NO_TARGETS: readonly EntryTarget[] = []

/** What the workout screen shows: the contract's `workoutView`, of this session. */
export type WorkoutShown = WorkoutView<SessionEntry, SessionExercise, PendingLog, EntryTarget>

/**
 * A session's sets, as every part of the workout reads and changes them: as the server has them,
 * with those still waiting for a signal (which count as done, #9), and the writes to them.
 */
export interface WorkoutSets {
  readonly server: readonly SetLog[]
  readonly all: readonly PendingLog[]
  readonly waiting: ReadonlySet<string>
  readonly record: ReturnType<typeof useRecordSet>
  readonly undo: (logId: string) => void
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
  const unsent = useUnsentSets(id)
  const record = useRecordSet(id)
  const submission = useSubmit()
  const menu = useMenu()
  const [howTo, setHowTo] = useState<{ exercise: Exercise; cue: string | null } | null>(null)
  const serverLogs = session.data?.logs ?? NO_LOGS
  const choices = useChoices()
  const writes = useSessionWrites(id, submission.submit, menu.hide, choices.forget)
  const picks = useAdHocPicks(serverLogs, choices)
  const ended = session.data?.endedAt != null
  const sets = workoutSets(serverLogs, unsent.sets, record, writes.undo, choices.forget)

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
    ...useView(plan, targets.data, sets, picks.adHocExercises, choices),
  }
}

export type Workout = ReturnType<typeof useWorkout>

/**
 * The sets as the server has them and as the workout counts them — those waiting included. Logging
 * or undoing one forgets what the athlete chose: the next set is what ends a choice.
 */
const workoutSets = (
  server: readonly SetLog[],
  unsent: ReturnType<typeof useUnsentSets>['sets'],
  record: WorkoutSets['record'],
  undo: WorkoutSets['undo'],
  forget: () => void,
): WorkoutSets => ({
  server,
  // Sets still waiting for a signal count as done: the next one comes up, rest starts (#9).
  all: withPending(server, unsent, Date.now()),
  waiting: new Set(unsent.map((s) => s.key)),
  record: {
    ...record,
    log: (...set) => {
      forget()
      record.log(...set)
    },
  },
  undo,
})

/**
 * What the athlete chose to look at (GLOSSARY.md, "Focus"): an entry or an exercise added, tapped
 * or picked to put in focus, and a set re-opened from its mark. Held until this device logs or
 * undoes a set, or goes to pick an exercise — by what was done, not by which set is latest: a set
 * logged without a signal changes id when the server has it, and a choice held to its id was lost
 * as it landed.
 */
function useChoices() {
  const [held, setHeld] = useState<WorkoutChoices>(NO_CHOICES)
  return {
    held,
    choose: (chosen: WorkoutChoices['chosen']) => {
      setHeld((now) => ({ ...now, chosen }))
    },
    reopen: (reopened: Reopened) => {
      setHeld((now) => ({ ...now, reopened }))
    },
    forget: () => {
      setHeld(NO_CHOICES)
    },
  }
}

/**
 * The day the session follows, and what the screen shows of it (the contract's `workoutView`) with
 * what the athlete chose.
 */
function useView(
  plan: SessionPlan | undefined,
  targets: readonly EntryTarget[] | undefined,
  sets: WorkoutSets,
  added: readonly SessionExercise[],
  choices: ReturnType<typeof useChoices>,
) {
  const loads = useLoads()
  // The plan as the server says the reader can reach it (`SessionPlan`) — never decided here.
  const day = plan?.reachable === true ? plan.day : undefined
  const view: WorkoutShown = workoutView({
    day: day ?? null,
    targets: targets ?? NO_TARGETS,
    sets: sets.all,
    added,
    choices: choices.held,
    loadFor: (entry) => loads(entry.exercise),
  })
  return {
    day,
    /** What the screen shows, by the contract's rules: the focus, the set shown, "+ set". */
    view,
    choose: choices.choose,
    reopen: choices.reopen,
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
 * logged, the log carries the exercise. Picking one chooses it, so it takes the focus.
 */
function useAdHocPicks(
  logs: readonly SetLog[],
  choices: Pick<ReturnType<typeof useChoices>, 'choose' | 'forget'>,
) {
  const [picking, setPicking] = useState(false)
  const [declined, setDeclined] = useState(false)
  const [picked, setPicked] = useState<Exercise[]>([])
  return {
    adHocExercises: useMemo(() => exercisesInSession(logs, picked), [logs, picked]),
    /** Whole, as picked: how to do them can be shown. */
    picked,
    picking,
    declined,
    /** Going to pick forgets what was chosen: what is picked takes the focus. */
    startPicking: () => {
      choices.forget()
      setPicking(true)
    },
    cancelPicking: () => {
      setPicking(false)
      setDeclined(true)
    },
    /**
     * Several at once (#27), in the order picked: the first is chosen, so it takes the focus as a
     * tap would — until a set is logged.
     */
    pick: (exercises: readonly Exercise[]) => {
      const ids = new Set(exercises.map((e) => e.id))
      setPicked((now) => [...now.filter((e) => !ids.has(e.id)), ...exercises])
      const [first] = exercises
      if (first !== undefined) choices.choose({ added: first.id })
      setPicking(false)
    },
  }
}

/** Finishing, notes and undo — each through `submit`, so a refusal is said on the screen. */
function useSessionWrites(
  id: string,
  submit: ReturnType<typeof useSubmit>['submit'],
  closeMenu: () => void,
  forgetChoices: () => void,
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
    undo: (logId: string) => {
      forgetChoices()
      void submit(async () => {
        await removeLog.mutateAsync(logId)
      })
    },
  }
}
