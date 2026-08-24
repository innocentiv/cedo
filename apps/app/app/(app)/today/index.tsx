import { useRouter } from 'expo-router'
import { formatWeight } from '@cedo/contract'
import type { WorkoutSessionSummary } from '@cedo/contract'
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
            trailing={session.totalVolumeG === 0 ? undefined : formatWeight(session.totalVolumeG)}
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
  const sessions = useSessions({ limit: 20 })
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
      <Loaded query={sessions} testID="today">
        {(data) => {
          const open = data.items.find((s) => s.endedAt === null)
          const past = data.items.filter((s) => s.endedAt !== null)
          return (
            <Stack gap="lg">
              <FormError message={startError} testID="today-error" />
              {open === undefined ? (
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
              )}
              <History sessions={past} />
            </Stack>
          )
        }}
      </Loaded>
    </Screen>
  )
}
