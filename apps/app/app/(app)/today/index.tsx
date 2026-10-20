import { useRouter } from 'expo-router'
import { formatWeight } from '@cedo/contract'
import type { WorkoutSessionSummary } from '@cedo/contract'
import { useWeightUnit } from '../../../src/lib/weight-unit.ts'
import {
  Button,
  Empty,
  FormError,
  ListRow,
  Loaded,
  NavButton,
  Screen,
  Stack,
  Text,
} from '../../../src/ui/index.ts'
import { useSessions, useStartSession } from '../../../src/api/queries.ts'
import { useSubmit } from '../../../src/lib/use-submit.ts'

/** Finished sessions, newest first. Split out so the screen body stays one readable shape. */
function History({
  sessions,
}: {
  readonly sessions: readonly WorkoutSessionSummary[]
}): React.JSX.Element {
  const router = useRouter()
  const unit = useWeightUnit()
  return (
    <Stack gap="sm">
      <Text variant="label" tone="muted">
        Recent sessions
      </Text>
      {sessions.length === 0 ? (
        <Empty
          title="No history yet"
          detail="Finished sessions appear here."
          testID="today-empty"
        />
      ) : (
        sessions.map((session) => (
          <ListRow
            key={session.id}
            title={session.dayName ?? session.workoutName ?? 'Ad-hoc session'}
            subtitle={new Date(session.startedAt).toLocaleDateString()}
            // Weight lifted, said as such: a session of planks lifted nothing, which is not
            // the same as having done nothing.
            trailing={
              session.liftedG === 0 ? undefined : `${formatWeight(session.liftedG, unit)} lifted`
            }
            onPress={() => {
              router.push(`/today/session/${session.id}`)
            }}
            testID={`session-row-${session.id}`}
          />
        ))
      )}
    </Stack>
  )
}

export default function Today(): React.JSX.Element {
  const router = useRouter()
  // Two questions, both the server's to answer: the session in progress — there is at most one, and
  // it may be older than any page of history — and the finished ones.
  const current = useSessions({ inProgress: true, limit: 1 })
  const sessions = useSessions({ inProgress: false, limit: 20 })
  const start = useStartSession()
  const { submit, busy, error: startError } = useSubmit()

  const startAdHoc = () => {
    void submit(async () => {
      const session = await start.mutateAsync({ workoutId: null, dayId: null })
      router.push(`/today/session/${session.id}`)
    })
  }

  return (
    <Screen title="Today" testID="today-screen">
      <Stack gap="lg">
        <FormError message={startError} testID="today-error" />
        {/* Each answered on its own: a history that fails does not hide the session to resume. */}
        <Loaded query={current} testID="today-current">
          {({ items: [open] }) =>
            open === undefined ? (
              <Stack gap="sm" testID="today-start">
                <Text tone="muted">Nothing in progress.</Text>
                <NavButton title="Start from a plan" href="/workouts" variant="primary" />
                <Button
                  title="Log without a plan"
                  variant="secondary"
                  onPress={startAdHoc}
                  busy={busy}
                  testID="start-adhoc"
                />
              </Stack>
            ) : (
              <Stack gap="sm" testID="today-resume">
                <Text variant="label" tone="accent">
                  In progress
                </Text>
                <ListRow
                  title={open.dayName ?? open.workoutName ?? 'Ad-hoc session'}
                  subtitle={`${open.setCount} sets logged`}
                  onPress={() => {
                    router.push(`/today/session/${open.id}`)
                  }}
                  testID="resume-session"
                />
              </Stack>
            )
          }
        </Loaded>
        <Loaded query={sessions} testID="today">
          {(data) => <History sessions={data.items} />}
        </Loaded>
      </Stack>
    </Screen>
  )
}
