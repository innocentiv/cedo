import { useMemo, useState } from 'react'
import { type Exercise, type SetLog, exercisesInSession } from '@cedo/contract'
import { withPending } from '../api/pending.ts'
import { useSession, useSessionTargets } from '../api/queries.ts'
import { useRemoveLog, useUnsentSets, useUpdateSession } from '../api/session-queries.ts'
import { useRecordSet } from './record-set.ts'
import { useSubmit } from './use-submit.ts'

/** Stable, so an absent session does not recompute the exercises on every render. */
const NO_LOGS: readonly SetLog[] = []

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
  const [menuOpen, setMenuOpen] = useState(false)
  const [howTo, setHowTo] = useState<{ exercise: Exercise; cue: string | null } | null>(null)
  const serverLogs = session.data?.logs ?? NO_LOGS

  return {
    id,
    session,
    plan,
    // The plan as the server says the reader can reach it (`SessionPlan`) — never decided here.
    day: plan?.reachable === true ? plan.day : undefined,
    targets,
    record,
    serverLogs,
    // Sets still waiting for a signal count as done: the next one comes up, rest starts (#9).
    logs: withPending(serverLogs, unsent.sets, Date.now()),
    waiting: new Set(unsent.sets.map((s) => s.key)),
    ended: session.data?.endedAt != null,
    error: record.error ?? submission.error,
    refused: submission.error,
    busy: submission.busy,
    menu: {
      open: menuOpen,
      show: () => {
        setMenuOpen(true)
      },
      hide: () => {
        setMenuOpen(false)
      },
    },
    howTo,
    setHowTo,
    ...useAdHocPicks(serverLogs),
    ...useSessionWrites(id, submission.submit, () => {
      setMenuOpen(false)
    }),
  }
}

export type Workout = ReturnType<typeof useWorkout>

/**
 * The exercises of a session without a plan: what it has logged, then any picked since
 * (`exercisesInSession`). Picks are local — once a set is logged, the log carries the exercise.
 */
function useAdHocPicks(logs: readonly SetLog[]) {
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<Exercise[]>([])
  return {
    adHocExercises: useMemo(() => exercisesInSession(logs, picked), [logs, picked]),
    picking,
    setPicking,
    pick: (exercise: Exercise) => {
      setPicked((now) => (now.some((e) => e.id === exercise.id) ? now : [...now, exercise]))
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
