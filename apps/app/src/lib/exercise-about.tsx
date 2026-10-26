import { useRouter } from 'expo-router'
import {
  type Exercise,
  type ExerciseHistory,
  MEDIA_KIND_LABELS,
  type TrackingMode,
  equipmentLine,
  formatEffort,
  musclesByLoad,
} from '@cedo/contract'
import {
  Card,
  ListRow,
  Loaded,
  ProgressTrend,
  type QueryLike,
  Stack,
  Text,
  Thumbnail,
} from '../ui/index.ts'
import { ExerciseVideo, loadable } from './exercise-media.tsx'
import { useWeightUnit } from './weight-unit.ts'

/**
 * The last few sessions for this exercise. Rendered through `Loaded` so a failed history request
 * says so, rather than reading as "nothing logged yet" — which is a different fact entirely.
 */
export function RecentHistory({
  query,
  tracking,
  sessionHref,
}: {
  readonly query: QueryLike<ExerciseHistory>
  readonly tracking: TrackingMode
  /** Where one of its sessions opens: your own, or — read by their coach — an athlete's (#30). */
  readonly sessionHref: (sessionId: string) => string
}): React.JSX.Element {
  const router = useRouter()
  const unit = useWeightUnit()
  return (
    <Stack gap="sm" testID="exercise-history">
      <Text variant="label" tone="muted">
        Recent history
      </Text>
      <Loaded query={query} testID="exercise-history">
        {(history) =>
          history.sessions.length === 0 ? (
            <Text tone="faint" variant="caption">
              Nothing logged yet.
            </Text>
          ) : (
            <Stack gap="xs">
              <ProgressTrend history={history} testID="exercise-trend" />
              {history.sessions.map((entry) => (
                <ListRow
                  key={entry.sessionId}
                  title={new Date(entry.performedAt).toLocaleDateString()}
                  subtitle={entry.sets.map((set) => formatEffort(set, tracking, unit)).join(', ')}
                  onPress={() => {
                    router.push(sessionHref(entry.sessionId))
                  }}
                />
              ))}
            </Stack>
          )
        }
      </Loaded>
    </Stack>
  )
}

/** What the exercise is: the muscles it loads, how to do it, and media showing it. */
export function About({ exercise }: { readonly exercise: Exercise }): React.JSX.Element {
  return (
    <>
      <Card testID="exercise-muscles">
        <Stack gap="xs">
          <Text variant="label" tone="muted">
            Muscles
          </Text>
          {musclesByLoad(exercise.muscles).map((m) => (
            <Text key={m.name}>{`${m.name} · ${m.loadPct}%`}</Text>
          ))}
        </Stack>
      </Card>

      <Card testID="exercise-equipment">
        <Stack gap="xs">
          <Text variant="label" tone="muted">
            Equipment
          </Text>
          <Text>{equipmentLine(exercise.equipment)}</Text>
          {exercise.doable ? null : (
            <Text variant="caption" tone="muted" testID="exercise-missing-equipment">
              More than your equipment has.
            </Text>
          )}
        </Stack>
      </Card>

      {exercise.instructions === '' ? null : (
        <Card testID="exercise-instructions">
          <Stack gap="xs">
            <Text variant="label" tone="muted">
              How to
            </Text>
            <Text>{exercise.instructions}</Text>
          </Stack>
        </Card>
      )}

      {exercise.media.length === 0 ? null : (
        <Stack gap="sm" testID="exercise-media">
          <Text variant="label" tone="muted">
            Media
          </Text>
          {exercise.media.map((m) =>
            m.kind === 'video_link' ? (
              // Played where it is shown (#27): the provider is asked only once it is tapped.
              <ExerciseVideo
                key={m.id}
                video={m}
                label={`${exercise.name}, video`}
                testID={`exercise-video-${m.id}`}
              />
            ) : (
              <Thumbnail
                key={m.id}
                uri={loadable(m.url) ?? m.url}
                label={m.title === '' ? `${exercise.name}, ${MEDIA_KIND_LABELS[m.kind]}` : m.title}
              />
            ),
          )}
        </Stack>
      )}
    </>
  )
}
