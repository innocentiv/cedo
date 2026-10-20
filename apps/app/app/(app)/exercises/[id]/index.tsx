import { useLocalSearchParams, useRouter } from 'expo-router'
import { MUSCLES, formatEffort } from '@cedo/contract'
import type { Exercise, ExerciseHistory, TrackingMode } from '@cedo/contract'
import { useWeightUnit } from '../../../../src/lib/weight-unit.ts'
import {
  Button,
  Card,
  ConfirmButton,
  ErrorNotice,
  FormError,
  ListRow,
  Loaded,
  type QueryLike,
  NavButton,
  Screen,
  Spinner,
  Stack,
  Text,
} from '../../../../src/ui/index.ts'
import {
  useDeleteExercise,
  useDuplicateExercise,
  useExercise,
  useExerciseHistory,
  useFavouriteExercise,
} from '../../../../src/api/queries.ts'
import { useGoBack } from '../../../../src/lib/use-go-back.ts'
import { useSubmit } from '../../../../src/lib/use-submit.ts'

const muscleName = (slug: string): string => MUSCLES.find((m) => m.slug === slug)?.name ?? slug

/**
 * The last few sessions for this exercise. Rendered through `Loaded` so a failed history request
 * says so, rather than reading as "nothing logged yet" — which is a different fact entirely.
 */
function RecentHistory({
  query,
  tracking,
}: {
  readonly query: QueryLike<ExerciseHistory>
  readonly tracking: TrackingMode
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
              {history.sessions.map((entry) => (
                <ListRow
                  key={entry.sessionId}
                  title={new Date(entry.performedAt).toLocaleDateString()}
                  subtitle={entry.sets.map((set) => formatEffort(set, tracking, unit)).join(', ')}
                  onPress={() => {
                    router.push(`/today/session/${entry.sessionId}`)
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

export default function ExerciseDetail(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { data, isPending, error, refetch } = useExercise(id ?? '')
  const history = useExerciseHistory(id ?? '')
  const favourite = useFavouriteExercise()
  const duplicate = useDuplicateExercise()
  const remove = useDeleteExercise()
  const goBack = useGoBack('/exercises')
  const { submit, busy, error: copyError } = useSubmit()

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
          <Stack gap="xs">
            <Text variant="caption" tone="faint" align="center">
              Shared with you as a reader.
            </Text>
            <Button
              title="Duplicate into my group"
              onPress={() => {
                void submit(async () => {
                  const copy = await duplicate.mutateAsync(data.id)
                  router.replace(`/exercises/${copy.id}/edit`)
                })
              }}
              busy={busy}
              testID="duplicate-exercise"
            />
          </Stack>
        )
      }
    >
      <Stack gap="md">
        <FormError message={copyError} testID="exercise-detail-error" />
        <Button
          title={data.isFavourite ? 'Pinned ★' : 'Pin'}
          variant="secondary"
          onPress={() => {
            void submit(async () => {
              await favourite.mutateAsync({ id: data.id, on: !data.isFavourite })
            })
          }}
          testID="toggle-favourite"
        />

        {data.description === '' ? null : <Text tone="muted">{data.description}</Text>}

        <About exercise={data} />

        <RecentHistory query={history} tracking={data.tracking} />

        {data.canEdit ? (
          // Refused while a plan or a logged set still uses it: the screen says so, above.
          <ConfirmButton
            title="Delete exercise"
            busy={busy}
            onConfirm={() => {
              void submit(async () => {
                await remove.mutateAsync(data.id)
                goBack()
              })
            }}
            testID="exercise-delete"
          />
        ) : null}
      </Stack>
    </Screen>
  )
}

/** What the exercise is: the muscles it loads, how to do it, and media showing it. */
function About({ exercise }: { readonly exercise: Exercise }): React.JSX.Element {
  return (
    <>
      <Card testID="exercise-muscles">
        <Stack gap="xs">
          <Text variant="label" tone="muted">
            Muscles
          </Text>
          {exercise.muscles.map((m) => (
            <Text key={m.muscle}>{`${muscleName(m.muscle)} · ${m.loadPct}%`}</Text>
          ))}
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
          {exercise.media.map((m) => (
            <ListRow key={m.id} title={m.title === '' ? m.url : m.title} subtitle={m.kind} />
          ))}
        </Stack>
      )}
    </>
  )
}
