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
  const writes = useSessionWrites(id, submission.submit, menu.hide)
  const picks = useAdHocPicks(serverLogs)
  const ended = session.data?.endedAt != null
  const sets = workoutSets(serverLogs, unsent.sets, record, writes.undo)

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
    // After the picks: picking starts afresh, so the view's `startPicking` takes the place of theirs.
    ...useView(plan, targets.data, sets, picks),
  }
}

export type Workout = ReturnType<typeof useWorkout>

/** The sets as the server has them and as the workout counts them — those waiting included. */
const workoutSets = (
  server: readonly SetLog[],
  unsent: ReturnType<typeof useUnsentSets>['sets'],
  record: WorkoutSets['record'],
  undo: WorkoutSets['undo'],
): WorkoutSets => ({
  server,
  // Sets still waiting for a signal count as done: the next one comes up, rest starts (#9).
  all: withPending(server, unsent, Date.now()),
  waiting: new Set(unsent.map((s) => s.key)),
  record,
  undo,
})

/**
 * The day the session follows, what the screen shows of it (the contract's `workoutView`), and what
 * the athlete chose to look at (GLOSSARY.md, "Focus"): an entry or an exercise added, tapped to put
 * in focus, and a set re-opened from its mark — held until the next set is logged, or until the
 * athlete goes to pick an exercise: what they pick takes the focus.
 */
function useView(
  plan: SessionPlan | undefined,
  targets: readonly EntryTarget[] | undefined,
  sets: WorkoutSets,
  picks: {
    readonly adHocExercises: readonly SessionExercise[]
    readonly added: string | null
    readonly startPicking: () => void
  },
) {
  const latest = sets.all.at(-1)?.id ?? null
  const [held, setHeld] = useState<{
    readonly choices: WorkoutChoices
    readonly at: string | null
  }>()
  const choices = held?.at === latest ? held.choices : NO_CHOICES
  const hold = (next: WorkoutChoices) => {
    setHeld({ choices: next, at: latest })
  }
  const loads = useLoads()
  // The plan as the server says the reader can reach it (`SessionPlan`) — never decided here.
  const day = plan?.reachable === true ? plan.day : undefined
  const view: WorkoutShown = workoutView({
    day: day ?? null,
    targets: targets ?? NO_TARGETS,
    sets: sets.all,
    added: picks.adHocExercises,
    justAdded: picks.added,
    choices,
    loadFor: (entry) => loads(entry.exercise),
  })
  return {
    day,
    /** What the screen shows, by the contract's rules: the focus, the set shown, "+ set". */
    view,
    choose: (chosen: WorkoutChoices['chosen']) => {
      hold({ ...choices, chosen })
    },
    reopen: (reopened: Reopened) => {
      hold({ ...choices, reopened })
    },
    startPicking: () => {
      setHeld(undefined)
      picks.startPicking()
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
 * The exercises of a session without a plan: what it has logged, then any picked since
 * (`exercisesInSession`). Picks are local — once a set is logged, the log carries the exercise.
 */
function useAdHocPicks(logs: readonly SetLog[]) {
  const [picking, setPicking] = useState(false)
  const [declined, setDeclined] = useState(false)
  const [picked, setPicked] = useState<Exercise[]>([])
  // The first of those picked together: they are done in the order picked.
  const [added, setAdded] = useState<string | null>(null)
  return {
    adHocExercises: useMemo(() => exercisesInSession(logs, picked), [logs, picked]),
    /** Whole, as picked: how to do them can be shown. */
    picked,
    /** The first exercise of those added last: it takes the focus until the next set says otherwise. */
    added,
    picking,
    declined,
    startPicking: () => {
      setPicking(true)
    },
    cancelPicking: () => {
      setPicking(false)
      setDeclined(true)
    },
    /** Several at once (#27), in the order picked: the first takes the focus. */
    pick: (exercises: readonly Exercise[]) => {
      const ids = new Set(exercises.map((e) => e.id))
      setPicked((now) => [...now.filter((e) => !ids.has(e.id)), ...exercises])
      setAdded(exercises[0]?.id ?? null)
      setPicking(false)
    },
  }
}

/** Finishing, notes and undo — each through `submit`, so a refusal is said on the screen. */
function useSessionWrites(
  id: string,
  submit: ReturnType<typeof useSubmit>['submit'],
  closeMenu: () => void,
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
      void submit(async () => {
        await removeLog.mutateAsync(logId)
      })
    },
  }
}
