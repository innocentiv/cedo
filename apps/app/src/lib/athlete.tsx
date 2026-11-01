import { useCallback, useRef, useState } from 'react'
import { useFocusEffect, useRouter } from 'expo-router'
import { type Athlete, sessionLine, sessionName } from '@cedo/contract'
import { Empty, ListRow, Loaded, Screen, Stack, Text } from '../ui/index.ts'
import {
  useAthleteHistory,
  useAthleteReview,
  useAthleteTrainingNow,
  useAthletes,
  useReadAthleteAgain,
} from '../api/athlete-queries.ts'
import { athleteSession } from './addresses.ts'
import { AthleteEquipmentCard } from './athlete-equipment.tsx'
import { Notes } from './athlete-notes.tsx'
import { BodyweightCard, FIRST_PERIOD, Period, Review } from './progress-parts.tsx'
import { PagedHistory } from './today-parts.tsx'

/**
 * An athlete's training, read by their coach (#30): the session they are in now, their Progress as
 * they read it themselves, and their history by week — read-only, nothing on it to press that would
 * change it. Their notes and weigh-ins are the exception: a coach writes those too (#41, #42). A screen of its own on
 * a phone; on a desktop, the pane beside the athletes. Read again each time the coach comes back to
 * it, never polled. See docs/08-frontend.md, "The coach's view".
 */
export function AthleteView({
  id,
  pane = false,
  onBack,
}: {
  readonly id: string
  readonly pane?: boolean
  /** Back to the athletes, on a phone: an installed app has no browser Back. */
  readonly onBack?: () => void
}): React.JSX.Element {
  const athletes = useAthletes()
  const athlete = athletes.data?.find((a) => a.user.id === id)
  const [weeks, setWeeks] = useState(FIRST_PERIOD)
  const shared = athlete !== undefined
  const review = useAthleteReview(id, weeks, shared)
  const history = useAthleteHistory(id, shared)
  useReadAgainOnReturn(id)

  const contents = shared ? (
    <Stack gap="xxl">
      <TrainingNow id={id} />
      <Stack gap="lg">
        <Period weeks={weeks} onChange={setWeeks} />
        <Review query={review} testID="athlete-progress" />
        <BodyweightCard athleteId={id} weeks={weeks} testID="athlete-bodyweight" />
      </Stack>
      <AthleteEquipmentCard id={id} />
      <Notes athleteId={id} testID="athlete-notes" />
      <PagedHistory history={history} sessionHref={athleteSession(id)} testID="athlete-history" />
    </Stack>
  ) : athletes.data === undefined ? (
    <Loaded query={athletes} testID="athlete">
      {() => null}
    </Loaded>
  ) : (
    // Stopped sharing, left, or never did: their training is not the reader's to see.
    <Empty
      title="Not shared with you"
      detail="They no longer share their training with a group you run."
      testID="athlete-gone"
    />
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
    <Screen title={athlete?.user.displayName ?? ''} onBack={onBack} wide testID="athlete-screen">
      {athlete === undefined ? null : <Text tone="muted">{sharedThrough(athlete)}</Text>}
      {contents}
    </Screen>
  )
}

/** Their reads again each time the page is come back to — not the first time: just read. */
function useReadAgainOnReturn(id: string): void {
  const readAgain = useReadAthleteAgain(id)
  const first = useRef(true)
  useFocusEffect(
    useCallback(() => {
      if (first.current) first.current = false
      else void readAgain()
    }, [readAgain]),
  )
}

/** `@sam · through Squad`: who they are, and the groups they share their training through. */
const sharedThrough = (athlete: Athlete): string =>
  `@${athlete.user.username} · through ${athlete.groups.map((g) => g.name).join(', ')}`

/** The session they are in, if they are: a row that opens their sets so far. */
function TrainingNow({ id }: { readonly id: string }): React.JSX.Element {
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
                router.push(athleteSession(id)(session.id))
              }}
              testID="athlete-training-now"
            />
          </Stack>
        )
      }}
    </Loaded>
  )
}
