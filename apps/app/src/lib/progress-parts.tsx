import {
  type MuscleRow,
  ReviewQuery,
  type TrainingReview,
  counted,
  driftLine,
  fallingLine,
  formatDay,
  muscleRows,
  stallLine,
} from '@cedo/contract'
import {
  Card,
  type ChipOption,
  Chips,
  Columns,
  ListRow,
  Loaded,
  Meter,
  type QueryLike,
  Stack,
  Text,
} from '../ui/index.ts'
import { useWeightUnit } from './weight-unit.ts'

/** Bodyweight over the same period (#42), read beside the review it is weighed against. */
export { BodyweightCard } from './bodyweight.tsx'

/**
 * The Progress tab's parts (#28): how consistently, what needs attention, which days, and the work
 * each muscle got — the review `GET /review` answers, laid out. Every number and word is the
 * contract's (`review.ts`); these only place them. See docs/08-frontend.md, "Progress".
 */

const PERIODS: readonly ChipOption<string>[] = [4, 8, 12].map((weeks) => ({
  value: String(weeks),
  label: `${String(weeks)} weeks`,
}))

/** The period a review starts on, in weeks: the review's own default, as the contract says it. */
export const FIRST_PERIOD = ReviewQuery.parse({}).weeks

/** How far back the review looks, in weeks. */
export function Period({
  weeks,
  onChange,
}: {
  readonly weeks: number
  readonly onChange: (weeks: number) => void
}): React.JSX.Element {
  return (
    <Chips
      options={PERIODS}
      value={String(weeks)}
      onChange={(chosen) => {
        onChange(Number(chosen))
      }}
      testID="progress-weeks"
    />
  )
}

/**
 * A review laid out — your own (#28), or an athlete's read by their coach (#30): how consistently
 * and what needs attention, beside which days and the work per muscle.
 */
export function Review({
  query,
  testID,
}: {
  readonly query: QueryLike<TrainingReview>
  readonly testID: string
}): React.JSX.Element {
  return (
    <Loaded query={query} testID={testID}>
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
  )
}

/** One number of the period, and what it counts. */
const stat = (label: string, value: string, testID: string) => (
  <Stack gap="xs">
    <Text variant="caption" tone="muted">
      {label}
    </Text>
    <Text variant="number" testID={testID}>
      {value}
    </Text>
  </Stack>
)

/** Sessions a week, the streak, the longest gap, and when last. */
function Consistency({ review }: { readonly review: TrainingReview }): React.JSX.Element {
  const a = review.adherence
  return (
    <Card testID="progress-consistency">
      <Stack gap="md">
        <Stack direction="row" gap="xl" wrap>
          {stat('A week', String(a.perWeek), 'progress-per-week')}
          {stat('Streak', counted(a.currentStreakDays, 'day'), 'progress-streak')}
          {stat('Longest gap', counted(a.longestGapDays, 'day'), 'progress-gap')}
        </Stack>
        <Text tone="muted">
          {a.lastSessionAt === null
            ? 'Nothing logged in this period.'
            : `${counted(a.sessions, 'session')}, the last on ${formatDay(new Date(a.lastSessionAt))}`}
        </Text>
      </Stack>
    </Card>
  )
}

/** What has stalled, is falling, or is getting harder — or that nothing is. */
function Attention({ review }: { readonly review: TrainingReview }): React.JSX.Element {
  const unit = useWeightUnit()
  // With nothing logged, nothing is judged: "nothing has stalled" would be an all-clear for nothing.
  if (review.adherence.sessions === 0) {
    return (
      <Text tone="muted" testID="progress-attention">
        Log a few sessions, and what needs attention shows here.
      </Text>
    )
  }
  const groups = [
    {
      title: 'Stalled',
      hint: 'The same top set, session after session: change something.',
      rows: review.stalled.map((s) => ({ name: s.exercise.name, line: stallLine(s, unit) })),
    },
    {
      title: 'Falling',
      hint: 'Less each time: a lighter week may be due.',
      rows: review.falling.map((f) => ({ name: f.exercise.name, line: fallingLine(f, unit) })),
    },
    {
      title: 'Harder each time',
      hint: 'The same set, with less left in reserve.',
      rows: review.effortDrift.map((d) => ({ name: d.exercise.name, line: driftLine(d, unit) })),
    },
  ].filter((g) => g.rows.length > 0)
  if (groups.length === 0) {
    return (
      <Text tone="muted" testID="progress-attention">
        Nothing has stalled or slipped.
      </Text>
    )
  }
  return (
    <Stack gap="xl" testID="progress-attention">
      {groups.map((g) => (
        <Stack key={g.title} gap="xs">
          <Text variant="heading">{g.title}</Text>
          <Text variant="caption" tone="muted">
            {g.hint}
          </Text>
          {g.rows.map((r) => (
            <ListRow key={`${g.title}-${r.name}`} title={r.name} subtitle={r.line} />
          ))}
        </Stack>
      ))}
    </Stack>
  )
}

/** Each planned day of the workouts trained, and how often — a day never trained said so. */
function Days({ review }: { readonly review: TrainingReview }): React.JSX.Element | null {
  if (review.dayBalance.length === 0) return null
  return (
    <Stack gap="xs" testID="progress-days">
      <Text variant="label" tone="muted">
        Days trained
      </Text>
      {review.dayBalance.map((d) => (
        <ListRow
          key={`${d.workout}-${d.day}`}
          title={d.day}
          subtitle={d.workout}
          accessory={
            <Text variant="label" tone={d.sessions === 0 ? 'danger' : 'muted'}>
              {d.sessions === 0 ? 'Not trained' : counted(d.sessions, 'time')}
            </Text>
          }
        />
      ))}
    </Stack>
  )
}

/** The work each muscle got, against the period before; the ones that fell away apart. */
function Muscles({ review }: { readonly review: TrainingReview }): React.JSX.Element {
  const { top, declined } = muscleRows(review.muscleWork)
  const omitted = review.muscleWork.omitted
  if (top.length === 0) {
    return (
      <Text tone="muted" testID="progress-muscles">
        No working sets in this period, or the one before.
      </Text>
    )
  }
  return (
    <Stack gap="xl" testID="progress-muscles">
      <Stack gap="sm">
        <Text variant="label" tone="muted">
          {`Work per muscle, against the ${counted(review.weeks, 'week')} before`}
        </Text>
        {top.map((m) => (
          <MuscleLine key={m.muscle} row={m} />
        ))}
        {omitted === 0 ? null : (
          <Text variant="caption" tone="faint">
            {`and ${counted(omitted, 'more muscle', 'more muscles')} with less`}
          </Text>
        )}
      </Stack>
      {declined.length === 0 ? null : (
        <Stack gap="sm" testID="progress-declined">
          <Text variant="label" tone="muted">
            Down sharply — half or less of the period before
          </Text>
          {declined.map((m) => (
            <MuscleLine key={m.muscle} row={m} />
          ))}
        </Stack>
      )}
    </Stack>
  )
}

/** A muscle's name, sets and change, and its bar — in red wherever it declined, top list or not. */
function MuscleLine({ row }: { readonly row: MuscleRow }): React.JSX.Element {
  return (
    <Stack gap="xs" testID={`progress-muscle-${row.muscle}`}>
      <Stack direction="row" align="baseline" gap="sm">
        <Stack grow>
          <Text variant="label">{row.name}</Text>
        </Stack>
        <Text variant="caption" tone="muted">
          {row.sets}
        </Text>
        <Text variant="caption" tone={row.declined ? 'danger' : 'faint'}>
          {row.change}
        </Text>
      </Stack>
      <Meter share={row.share} declined={row.declined} />
    </Stack>
  )
}
