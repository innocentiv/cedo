import { useLocalSearchParams } from 'expo-router'
import { openedSessionName } from '@cedo/contract'
import { Columns, Loaded, Screen, SessionHeader } from '../../../../../src/ui/index.ts'
import { useAthleteSession } from '../../../../../src/api/athlete-queries.ts'
import { athleteExercise } from '../../../../../src/lib/addresses.ts'
import { SetsByExercise } from '../../../../../src/lib/session-parts.tsx'
import { useGoBack } from '../../../../../src/lib/use-go-back.ts'
import { FinishedSummary, ReadNotes } from '../../../../../src/lib/workout-summary.tsx'

/**
 * One of an athlete's sessions, read by their coach (#30): what it came to once finished, or the
 * sets so far while they are training — read each time it is opened, never polled — and their
 * notes, beside the sets by exercise. An exercise opens their history of it. Read-only: nothing
 * here changes their training.
 */
export default function AthleteSession(): React.JSX.Element {
  // `[session]`, not `[sessionId]`: route filenames are kebab-case, and `[id]` is the athlete.
  const { id = '', session: sessionId = '' } = useLocalSearchParams<{
    id: string
    session: string
  }>()
  const goBack = useGoBack(`/athletes/${id}`)
  return (
    <Loaded query={useAthleteSession(id, sessionId)} testID="athlete-session">
      {(data) => (
        <Screen
          wide
          testID="athlete-session-screen"
          header={
            <SessionHeader
              title={openedSessionName(data)}
              startedAt={data.startedAt}
              endedAt={data.endedAt}
              onBack={goBack}
              testID="athlete-session-header"
            />
          }
        >
          <Columns
            main={
              <>
                {data.endedAt === null ? null : <FinishedSummary session={data} />}
                <ReadNotes notes={data.notes} />
              </>
            }
            side={<SetsByExercise logs={data.logs} historyHref={athleteExercise(id)} />}
          />
        </Screen>
      )}
    </Loaded>
  )
}
