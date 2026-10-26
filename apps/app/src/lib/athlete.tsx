import { useState } from 'react'
import { useRouter } from 'expo-router'
import { type Athlete, sessionLine, sessionName } from '@cedo/contract'
import { Columns, Empty, ListRow, Loaded, Screen, Stack, Text } from '../ui/index.ts'
import {
  useAthleteHistory,
  useAthleteReview,
  useAthleteTrainingNow,
  useAthletes,
} from '../api/athlete-queries.ts'
import { Attention, Consistency, Days, FIRST_PERIOD, Muscles, Period } from './progress-parts.tsx'
import { History } from './today-parts.tsx'

/**
 * An athlete's training, read by their coach (#30): the session they are in now, their Progress as
 * they read it themselves, and their history by week — read-only, nothing on it to press that would
 * change it. A screen of its own on a phone; on a desktop, the pane beside the athletes. See
 * docs/08-frontend.md, "The coach's view".
 */
export function AthleteView({
  id,
  pane = false,
}: {
  readonly id: string
  readonly pane?: boolean
}): React.JSX.Element {
  const athletes = useAthletes()
  const athlete = athletes.data?.find((a) => a.user.id === id)
  const sessionHref = (sessionId: string) => `/athletes/${id}/sessions/${sessionId}`

  const contents =
    athletes.data !== undefined && athlete === undefined ? (
      // Stopped sharing, left, or never did: their training is not the reader's to see.
      <Empty
        title="Not shared with you"
        detail="They no longer share their training with a group you run."
        testID="athlete-gone"
      />
    ) : (
      <Stack gap="xxl">
        <TrainingNow id={id} sessionHref={sessionHref} />
        <Review id={id} />
        <TheirHistory id={id} sessionHref={sessionHref} />
      </Stack>
    )

  if (pane) {
    return (
      <Stack gap="lg" testID="athlete-pane">
        <Stack gap="xs">
          <Text variant="title">{athlete?.user.displayName ?? ''}</Text>
          {athlete === undefined ? null : <Text tone="muted">{sharedThrough(athlete)}</Text>}
        </Stack>
        {contents}
      </Stack>
    )
  }
  return (
    <Screen title={athlete?.user.displayName ?? ''} wide testID="athlete-screen">
      {athlete === undefined ? null : <Text tone="muted">{sharedThrough(athlete)}</Text>}
      {contents}
    </Screen>
  )
}

/** `@sam · through Squad`: who they are, and the groups they share their training through. */
const sharedThrough = (athlete: Athlete): string =>
  `@${athlete.user.username} · through ${athlete.groups.map((g) => g.name).join(', ')}`

/** The session they are in, if they are: their sets so far, read when the page is opened. */
function TrainingNow({
  id,
  sessionHref,
}: {
  readonly id: string
  readonly sessionHref: (sessionId: string) => string
}): React.JSX.Element {
  const router = useRouter()
  return (
    <Loaded query={useAthleteTrainingNow(id)} testID="athlete-now">
      {(page) => {
        const session = page.items[0]
        if (session === undefined) return null
        return (
          <Stack gap="xs">
            <Text variant="label" tone="accent">
              Training now
            </Text>
            <ListRow
              title={sessionName(session)}
              subtitle={sessionLine(session)}
              onPress={() => {
                router.push(sessionHref(session.id))
              }}
              testID="athlete-training-now"
            />
          </Stack>
        )
      }}
    </Loaded>
  )
}

/** Their Progress: the same review, and the same parts, as the athlete's own tab. */
function Review({ id }: { readonly id: string }): React.JSX.Element {
  const [weeks, setWeeks] = useState(FIRST_PERIOD)
  return (
    <Stack gap="lg">
      <Period value={weeks} onChange={setWeeks} />
      <Loaded query={useAthleteReview(id, Number(weeks))} testID="athlete-progress">
        {(review) => (
          <Columns
            main={
              <>
                <Consistency review={review} />
                <Attention review={review} />
              </>
            }
            side={
              <Stack gap="xxl">
                <Days review={review} />
                <Muscles review={review} />
              </Stack>
            }
          />
        )}
      </Loaded>
    </Stack>
  )
}

function TheirHistory({
  id,
  sessionHref,
}: {
  readonly id: string
  readonly sessionHref: (sessionId: string) => string
}): React.JSX.Element {
  const history = useAthleteHistory(id)
  return (
    <Loaded query={history} testID="athlete-history">
      {(data) => (
        <History
          sessions={data.pages.flatMap((page) => page.items)}
          sessionHref={sessionHref}
          older={
            history.hasNextPage
              ? {
                  load: () => {
                    void history.fetchNextPage()
                  },
                  busy: history.isFetchingNextPage,
                }
              : null
          }
        />
      )}
    </Loaded>
  )
}
