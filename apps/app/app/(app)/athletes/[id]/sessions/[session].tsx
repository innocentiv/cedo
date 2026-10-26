import { useLocalSearchParams, useRouter } from 'expo-router'
import { Loaded, Screen, SessionHeader, Stack, Text } from '../../../../../src/ui/index.ts'
import { useAthleteSession } from '../../../../../src/api/athlete-queries.ts'
import { SetsByExercise } from '../../../../../src/lib/session-parts.tsx'
import { useGoBack } from '../../../../../src/lib/use-go-back.ts'
import { FinishedSummary } from '../../../../../src/lib/workout-summary.tsx'

/**
 * One of an athlete's sessions, read by their coach (#30): what it came to once finished, or the
 * sets so far while they are training — read when opened, never polled — and their notes. An
 * exercise opens their history of it. Read-only: nothing here changes their training.
 */
export default function AthleteSession(): React.JSX.Element {
  // `[session]`, not `[sessionId]`: route filenames are kebab-case, and `[id]` is the athlete.
  const { id, session: sessionId } = useLocalSearchParams<{ id: string; session: string }>()
  const router = useRouter()
  const goBack = useGoBack(`/athletes/${id ?? ''}`)
  const session = useAthleteSession(id ?? '', sessionId ?? '')
  return (
    <Loaded query={session} testID="athlete-session">
      {(data) => (
        <Screen
          wide
          testID="athlete-session-screen"
          header={
            <SessionHeader
              title={data.plan?.reachable === true ? data.plan.day.name : 'Session'}
              startedAt={data.startedAt}
              endedAt={data.endedAt}
              onBack={goBack}
              testID="athlete-session-header"
            />
          }
        >
          <Stack gap="xxl">
            {data.endedAt === null ? null : <FinishedSummary session={data} />}
            {data.notes === null ? null : (
              <Stack gap="xs" testID="athlete-session-notes">
                <Text variant="label" tone="muted">
                  Notes
                </Text>
                <Text>{data.notes}</Text>
              </Stack>
            )}
            <SetsByExercise
              logs={data.logs}
              historyOf={(exerciseId) => {
                router.push(`/athletes/${id ?? ''}/exercises/${exerciseId}`)
              }}
            />
          </Stack>
        </Screen>
      )}
    </Loaded>
  )
}
