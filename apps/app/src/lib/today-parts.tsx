import { useRouter } from 'expo-router'
import {
  type NextDay,
  type SessionStart,
  type Today,
  type WorkoutSessionSummary,
  WEEKDAY_INITIALS,
  byWeek,
  dayOfWeek,
  personalBestsShort,
  sessionLine,
  weekStrip,
} from '@cedo/contract'
import { Button, Card, Empty, ListRow, NavButton, Stack, Text, WeekStrip } from '../ui/index.ts'

/**
 * Today's parts (#25): what to do now — the session in progress, else the next day of the current
 * workout — the week, and history by week. What is next and what counts are the server's
 * (`GET /today`) and the contract's (`week.ts`); these only lay them out. See docs/08-frontend.md,
 * "Today".
 */

const nameOf = (session: WorkoutSessionSummary): string =>
  session.dayName ?? session.workoutName ?? 'Without a plan'

/** What to do now, then the week: the first thing the screen says. */
export function Now({
  today,
  weekStart,
  onStart,
  busy,
}: {
  readonly today: Today
  readonly weekStart: string
  readonly onStart: (start: SessionStart) => void
  readonly busy: boolean
}): React.JSX.Element {
  const adHoc = { workoutId: null, dayId: null }
  return (
    <Stack gap="xl">
      {today.inProgress === null ? (
        <Stack gap="sm">
          {today.next === null ? (
            <NothingNext />
          ) : (
            <UpNextDay next={today.next} onStart={onStart} busy={busy} />
          )}
          <Button
            title="Log without a plan"
            variant="ghost"
            onPress={() => {
              onStart(adHoc)
            }}
            testID="start-adhoc"
          />
        </Stack>
      ) : (
        <InProgress session={today.inProgress} />
      )}
      <ThisWeek week={today.week} weekStart={weekStart} />
    </Stack>
  )
}

/** A session in progress is the whole of what to do: Resume, and nothing to start beside it. */
function InProgress({ session }: { readonly session: WorkoutSessionSummary }): React.JSX.Element {
  const router = useRouter()
  return (
    <Card testID="today-resume">
      <Stack gap="lg">
        <Stack gap="xs">
          <Text variant="label" tone="accent">
            In progress
          </Text>
          <Text variant="title">{nameOf(session)}</Text>
          <Text tone="muted">{sessionLine(session)}</Text>
        </Stack>
        <Button
          title="Resume"
          size="large"
          onPress={() => {
            router.push(`/today/session/${session.id}`)
          }}
          testID="resume-session"
        />
      </Stack>
    </Card>
  )
}

/** The next day of the current workout, and Start: one tap from opening the app to the first set. */
function UpNextDay({
  next,
  onStart,
  busy,
}: {
  readonly next: NextDay
  readonly onStart: (start: SessionStart) => void
  readonly busy: boolean
}): React.JSX.Element {
  return (
    <Card testID="today-next">
      <Stack gap="lg">
        <Stack gap="xs">
          <Text variant="caption" tone="muted">
            {`Next in ${next.workoutName}`}
          </Text>
          <Text variant="title" testID="today-next-day">
            {next.dayName}
          </Text>
          <Text tone="muted">
            {next.exercises.length === 0 ? 'No exercises yet' : next.exercises.join(', ')}
          </Text>
        </Stack>
        <Stack gap="xs">
          <Button
            title={`Start ${next.dayName}`}
            size="large"
            busy={busy}
            onPress={() => {
              onStart({ workoutId: next.workoutId, dayId: next.dayId })
            }}
            testID="today-start-next"
          />
          <NavButton
            title="Another day"
            href={`/workouts/${next.workoutId}`}
            testID="today-other-day"
          />
        </Stack>
      </Stack>
    </Card>
  )
}

/** No current workout yet: where one comes from. */
function NothingNext(): React.JSX.Element {
  return (
    <Card testID="today-start">
      <Stack gap="lg">
        <Stack gap="xs">
          <Text variant="heading">Nothing to follow yet</Text>
          <Text tone="muted">Start a day of a workout, and the next one waits here.</Text>
        </Stack>
        <NavButton title="Choose a workout" href="/workouts" variant="primary" />
      </Stack>
    </Card>
  )
}

/** The week so far: a mark per day, today ringed, and how many sessions. */
function ThisWeek({
  week,
  weekStart,
}: {
  readonly week: readonly string[]
  readonly weekStart: string
}): React.JSX.Element {
  const trained = weekStrip(new Date(weekStart), week)
  const today = dayOfWeek(new Date())
  return (
    <Stack gap="sm">
      <Text variant="label" tone="muted" testID="today-week-count">
        {`${week.length === 1 ? '1 session' : `${String(week.length)} sessions`} this week`}
      </Text>
      <WeekStrip
        days={WEEKDAY_INITIALS.map((initial, index) => ({
          index,
          initial,
          trained: trained[index] === true,
          today: index === today,
        }))}
        testID="today-week"
      />
    </Stack>
  )
}

/** Finished sessions, newest first, by week: each its day, how long, its sets, and its bests. */
export function History({
  sessions,
}: {
  readonly sessions: readonly WorkoutSessionSummary[]
}): React.JSX.Element {
  const router = useRouter()
  if (sessions.length === 0) {
    return (
      <Empty title="No history yet" detail="Finished sessions appear here." testID="today-empty" />
    )
  }
  return (
    <Stack gap="lg">
      <Text variant="heading">History</Text>
      {byWeek(sessions, new Date()).map((week) => (
        <Stack key={week.label} gap="xs">
          <Text variant="label" tone="muted">
            {week.label}
          </Text>
          {week.items.map((session) => {
            const bests = personalBestsShort(session.personalBests)
            return (
              <ListRow
                key={session.id}
                title={nameOf(session)}
                subtitle={sessionLine(session)}
                accessory={
                  bests === null ? undefined : (
                    <Text variant="label" tone="best">
                      {bests}
                    </Text>
                  )
                }
                onPress={() => {
                  router.push(`/today/session/${session.id}`)
                }}
                testID={`session-row-${session.id}`}
              />
            )
          })}
        </Stack>
      ))}
    </Stack>
  )
}
