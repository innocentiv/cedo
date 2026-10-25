import { useMemo, useState } from 'react'
import { type Exercise, type SetLog, exercisesInSession } from '@cedo/contract'
import { type PendingLog, withPending } from '../api/pending.ts'
import { useSession, useSessionTargets } from '../api/queries.ts'
import { useRemoveLog, useUnsentSets, useUpdateSession } from '../api/session-queries.ts'
import { useRecordSet } from './record-set.ts'
import { useSubmit } from './use-submit.ts'

/** Stable, so an absent session does not recompute the exercises on every render. */
const NO_LOGS: readonly SetLog[] = []

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
 * are the contract's `session-flow`.
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
    // The plan as the server says the reader can reach it (`SessionPlan`) — never decided here.
    day: plan?.reachable === true ? plan.day : undefined,
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
    error: record.error ?? submission.error,
    refused: submission.error,
    busy: submission.busy,
    menu,
    howTo,
    setHowTo,
    ...picks,
    ...writes,
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
  return {
    adHocExercises: useMemo(() => exercisesInSession(logs, picked), [logs, picked]),
    /** Whole, as picked: how to do them can be shown. */
    picked,
    /** The exercise added last: it takes the focus until the next set says otherwise. */
    added: picked.at(-1)?.id ?? null,
    picking,
    declined,
    startPicking: () => {
      setPicking(true)
    },
    cancelPicking: () => {
      setPicking(false)
      setDeclined(true)
    },
    /** Several at once (#27), in the order picked: the last takes the focus. */
    pick: (exercises: readonly Exercise[]) => {
      const ids = new Set(exercises.map((e) => e.id))
      setPicked((now) => [...now.filter((e) => !ids.has(e.id)), ...exercises])
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
