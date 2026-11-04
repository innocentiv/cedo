import { Fragment, useState } from 'react'
import { useRouter } from 'expo-router'
import type { LoggedExercise, SessionDay, SessionExercise, SetLog } from '@cedo/contract'
import { byExercise, formatWithReserve, loggedLabel, loggedTitle } from '@cedo/contract'
import { useUnsentSets } from '../api/session-queries.ts'
import { useWeightUnit } from './weight-unit.ts'
import { exerciseName } from './exercise-name.ts'
import { Card, ListRow, Stack, Text } from '../ui/index.ts'
import { FixSet } from './fix-set.tsx'

/** The pieces the live session screen is assembled from, so the route itself stays control flow. */

/**
 * The plan behind a session is out of the reader's reach — they left the group it lives in, as the
 * server decides it (`SessionPlan`). Said in one line, above a session that stays fully usable: the
 * session is theirs either way.
 */
export function PlanUnavailable(): React.JSX.Element {
  return (
    <Text tone="danger" testID="session-plan-unavailable">
      The plan behind this session is unavailable. Your sets are kept, and you can still log and
      finish.
    </Text>
  )
}

/**
 * Sets logged but not yet sent, shown as soon as logged: a set not sent must not look like a set
 * not logged (#9). When one is held up — no signal, or an answer lost on the way back — the screen
 * asks for the app to stay open: they are kept in memory, and sent in order when the signal
 * returns. Not undoable until sent: there is nothing on the server to take back yet. Named from the
 * day or the ad-hoc picks, since the server has not named them yet.
 */
export function UnsentSets({
  sessionId,
  day,
  adHoc,
}: {
  readonly sessionId: string
  readonly day: SessionDay | undefined
  readonly adHoc: readonly SessionExercise[]
}): React.JSX.Element | null {
  const unit = useWeightUnit()
  const { sets, heldUp } = useUnsentSets(sessionId)
  if (sets.length === 0) return null
  const exerciseOf = (exerciseId: string): LoggedExercise | null =>
    day?.entries.find((e) => e.exerciseId === exerciseId)?.exercise ??
    adHoc.find((e) => e.id === exerciseId) ??
    null
  const count = `${sets.length} ${sets.length === 1 ? 'set' : 'sets'}`
  return (
    <Card testID="session-unsent">
      <Stack gap="xs">
        {heldUp ? (
          <Text variant="label" tone="accent">
            {`Keep cedo open — ${count} will be sent when the signal is back.`}
          </Text>
        ) : null}
        {sets.map(({ input, key }) => {
          const exercise = exerciseOf(input.exerciseId)
          return (
            <ListRow
              key={key}
              title={`${exerciseName(exercise)} · not sent yet`}
              subtitle={formatWithReserve(input, exercise?.tracking ?? null, unit)}
              testID={`unsent-set-${key}`}
            />
          )
        })}
      </Stack>
    </Card>
  )
}

/**
 * Which set of a list is open to be fixed, below its row (#63): one at a time, by id — so it shows
 * the set as read again after a fix, and closes once the set is removed. Tapping it again closes it.
 */
function useOpenSet() {
  const [open, setOpen] = useState<string | null>(null)
  return {
    isOpen: (log: SetLog) => open === log.id,
    toggle: (log: SetLog) => {
      setOpen((now) => (now === log.id ? null : log.id))
    },
    close: () => {
      setOpen(null)
    },
  }
}

/**
 * What has actually been done this session in progress, and where any of it is fixed (#63): a set
 * tapped opens right below itself to be corrected or removed — apart from the set being logged and
 * its rest, which take back only the set just logged. Once finished, its sets read back by exercise
 * instead (`SetsByExercise`), and are fixed the same way.
 */
export function LoggedSets({
  sessionId,
  logs,
}: {
  readonly sessionId: string
  /**
   * Each log names its exercise and how it is measured, as far as the caller can still see it —
   * so a weighted pull-up's "+20 kg" reads as added weight even after a reload, or once its plan is
   * out of reach, where the screen used to fall back to a 20 kg lift.
   */
  readonly logs: readonly SetLog[]
}): React.JSX.Element | null {
  const unit = useWeightUnit()
  const fixing = useOpenSet()
  if (logs.length === 0) return null
  return (
    <Stack gap="xs" testID="session-logs">
      <Text variant="label" tone="muted">
        This session
      </Text>
      <Text variant="caption" tone="faint">
        Tap a set to correct or remove it.
      </Text>
      {logs.map((log) => (
        <Fragment key={log.id}>
          <ListRow
            title={`${exerciseName(log.exercise)} · ${loggedLabel(log, logs)}`}
            subtitle={formatWithReserve(log, log.exercise?.tracking ?? null, unit)}
            selected={fixing.isOpen(log)}
            onPress={() => {
              fixing.toggle(log)
            }}
            testID={`logged-set-${log.id}`}
          />
          {fixing.isOpen(log) ? (
            <FixSet sessionId={sessionId} log={log} onDone={fixing.close} />
          ) : null}
        </Fragment>
      ))}
    </Stack>
  )
}

/**
 * A finished session's sets by exercise (#25), each exercise once in the order first done: how it
 * is read back. Its personal bests marked green, as they are judged now. Each set opens right below
 * itself to be fixed (#31, #63) where the reader may fix it — their own, `sessionId` given; a
 * coach's view reads them only.
 */
export function SetsByExercise({
  logs,
  historyHref,
  sessionId,
}: {
  readonly logs: readonly SetLog[]
  /** The session whose sets these are, when the reader may fix them. */
  readonly sessionId?: string
  /**
   * Where an exercise's history is, opened from its name — read by a coach (#30), whose session page
   * is the way into an athlete's history. Never for an exercise the reader cannot see: no name.
   */
  readonly historyHref?: (exerciseId: string) => string
}): React.JSX.Element {
  const unit = useWeightUnit()
  const router = useRouter()
  const fixing = useOpenSet()
  return (
    <Stack gap="xl" testID="session-logs">
      {byExercise(logs).map((sets) => (
        <Stack key={sets[0]?.exerciseId} gap="xs">
          {historyHref === undefined || sets[0]?.exercise == null ? (
            <Text variant="label" tone="muted">
              {exerciseName(sets[0]?.exercise ?? null)}
            </Text>
          ) : (
            <ListRow
              title={exerciseName(sets[0].exercise)}
              trailing="History"
              onPress={() => {
                router.push(historyHref(sets[0]?.exerciseId ?? ''))
              }}
              testID={`exercise-history-of-${sets[0].exerciseId}`}
            />
          )}
          {sets.map((log) => (
            <Fragment key={log.id}>
              <ListRow
                title={loggedTitle(log, logs)}
                subtitle={formatWithReserve(log, log.exercise?.tracking ?? null, unit)}
                accessory={
                  log.personalBest ? (
                    <Text variant="label" tone="best">
                      PB
                    </Text>
                  ) : undefined
                }
                selected={fixing.isOpen(log)}
                onPress={
                  sessionId === undefined
                    ? undefined
                    : () => {
                        fixing.toggle(log)
                      }
                }
                testID={`logged-set-${log.id}`}
              />
              {sessionId !== undefined && fixing.isOpen(log) ? (
                <FixSet sessionId={sessionId} log={log} onDone={fixing.close} />
              ) : null}
            </Fragment>
          ))}
        </Stack>
      ))}
    </Stack>
  )
}
