import { useLocalSearchParams, useRouter } from 'expo-router'
import { MUSCLES, formatWeight } from '@cedo/contract'
import {
  Button,
  Card,
  ErrorNotice,
  ListRow,
  NavButton,
  Screen,
  Spinner,
  Stack,
  Text,
} from '../../../../src/ui/index.ts'
import {
  useExercise,
  useExerciseHistory,
  useFavouriteExercise,
} from '../../../../src/api/queries.ts'

const muscleName = (slug: string): string => MUSCLES.find((m) => m.slug === slug)?.name ?? slug

export default function ExerciseDetail(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { data, isPending, error, refetch } = useExercise(id ?? '')
  const history = useExerciseHistory(id ?? '')
  const favourite = useFavouriteExercise()

  if (error !== null) {
    return (
      <Screen testID="exercise-detail-screen">
        <ErrorNotice
          message={error.message}
          onRetry={() => {
            void refetch()
          }}
        />
      </Screen>
    )
  }
  if (isPending) return <Spinner testID="exercise-loading" />

  return (
    <Screen
      title={data.name}
      testID="exercise-detail-screen"
      footer={
        data.canEdit ? (
          <NavButton
            title="Edit"
            href={`/exercises/${data.id}/edit`}
            variant="primary"
            testID="edit-exercise"
          />
        ) : (
          <Text variant="caption" tone="faint" align="center">
            Shared with you as a reader. Duplicate it to make changes.
          </Text>
        )
      }
    >
      <Stack gap="md">
        <Button
          title={data.isFavourite ? 'Pinned ★' : 'Pin'}
          variant="secondary"
          onPress={() => {
            favourite.mutate({ id: data.id, on: !data.isFavourite })
          }}
          testID="toggle-favourite"
        />

        {data.description === '' ? null : <Text tone="muted">{data.description}</Text>}

        <Card testID="exercise-muscles">
          <Stack gap="xs">
            <Text variant="label" tone="muted">
              Muscles
            </Text>
            {data.muscles.map((m) => (
              <Text key={m.muscle}>{`${muscleName(m.muscle)} · ${m.loadPct}%`}</Text>
            ))}
          </Stack>
        </Card>

        {data.instructions === '' ? null : (
          <Card testID="exercise-instructions">
            <Stack gap="xs">
              <Text variant="label" tone="muted">
                How to
              </Text>
              <Text>{data.instructions}</Text>
            </Stack>
          </Card>
        )}

        {data.media.length === 0 ? null : (
          <Stack gap="sm" testID="exercise-media">
            <Text variant="label" tone="muted">
              Media
            </Text>
            {data.media.map((m) => (
              <ListRow key={m.id} title={m.title === '' ? m.url : m.title} subtitle={m.kind} />
            ))}
          </Stack>
        )}

        <Stack gap="sm" testID="exercise-history">
          <Text variant="label" tone="muted">
            Recent history
          </Text>
          {history.data === undefined || history.data.sessions.length === 0 ? (
            <Text tone="faint" variant="caption">
              Nothing logged yet.
            </Text>
          ) : (
            history.data.sessions.map((entry) => (
              <ListRow
                key={entry.sessionId}
                title={new Date(entry.performedAt).toLocaleDateString()}
                subtitle={entry.sets
                  .map(
                    (s) =>
                      `${s.reps ?? '—'}×${s.weightG === null ? 'bw' : formatWeight(s.weightG)}`,
                  )
                  .join('  ')}
                onPress={() => {
                  router.push(`/today/session/${entry.sessionId}`)
                }}
              />
            ))
          )}
        </Stack>
      </Stack>
    </Screen>
  )
}
