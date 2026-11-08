import { getRandomValues } from 'expo-crypto'
import type { LoggedHere } from '../ui/index.ts'
import { newIdempotencyKey } from '../api/retry.ts'
import { useLogSet } from '../api/session-queries.ts'
import { primeChime } from './chime.ts'
import { useSubmit } from './use-submit.ts'

/**
 * The workout screen's writes to its sets: logging one — a warm-up or a working set, against a plan
 * entry or none — with its reserve, said before it is logged (#37). The set's number is the
 * server's to give, in its series, the same way for this screen and an AI.
 */
export function useRecordSet(sessionId: string) {
  const logSet = useLogSet(sessionId)
  // Its own submission, so a set waiting for a signal never holds Finish, nor clears its refusal.
  const { submit, error } = useSubmit()

  return {
    error,
    log: (
      set: LoggedHere & { readonly exerciseId: string; readonly entryId: string | null },
    ): void => {
      // The tap that logs a set starts the sound its rest will end with: iOS asks for a tap.
      primeChime()
      // Its key and its time are made here, once: however many times it is sent, it is this one set
      // (#9), and its rest counts from now however often it is read. Its random bytes are
      // expo-crypto's: React Native has no `crypto` of its own (#77).
      const key = newIdempotencyKey(getRandomValues)
      const loggedAt = new Date().toISOString()
      void submit(async () => {
        await logSet.mutateAsync({
          input: {
            exerciseId: set.exerciseId,
            entryId: set.entryId,
            weightG: set.effort.weightG,
            reps: set.effort.reps,
            reserve: set.reserve,
            durationS: set.effort.durationS,
            distanceMm: set.effort.distanceMm,
            isWarmup: set.isWarmup,
          },
          key,
          loggedAt,
        })
      })
    },
  }
}
