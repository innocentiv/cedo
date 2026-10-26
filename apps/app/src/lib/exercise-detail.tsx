import {
  useDeleteExercise,
  useDuplicateExercise,
  useExercise,
  useExerciseHistory,
  useFavouriteExercise,
  useTransferExercise,
} from '../api/queries.ts'
import {
  ConfirmButton,
  ErrorNotice,
  NavButton,
  PinButton,
  Screen,
  Spinner,
  Stack,
  Text,
} from '../ui/index.ts'
import { DuplicateIntoMyGroup } from './duplicate-into-my-group.tsx'
import { About, RecentHistory } from './exercise-about.tsx'
import { GroupPlacement } from './group-placement.tsx'
import { useSubmit } from './use-submit.ts'

/**
 * One exercise: what it is, its history, and what can be done with it (#29). A screen of its own on
 * a phone; on a desktop, a pane beside the list it was chosen from (`pane`), its title and Edit at
 * its head rather than a footer. `onGone`: where to go once it is deleted.
 */
export function ExerciseDetailView({
  id,
  pane = false,
  onGone,
}: {
  readonly id: string
  readonly pane?: boolean
  readonly onGone: () => void
}): React.JSX.Element {
  const { data, isPending, error, refetch } = useExercise(id)
  const history = useExerciseHistory(id)
  const favourite = useFavouriteExercise()
  const transfer = useTransferExercise()
  const duplicate = useDuplicateExercise()
  const remove = useDeleteExercise()
  // One submission each, so a refusal shows beside what was refused, and only that is busy.
  const pinning = useSubmit()
  const deleting = useSubmit()

  if (error !== null) {
    const notice = (
      <ErrorNotice
        message={error.message}
        onRetry={() => {
          void refetch()
        }}
      />
    )
    return pane ? notice : <Screen testID="exercise-detail-screen">{notice}</Screen>
  }
  if (isPending) return <Spinner testID="exercise-loading" />

  const action = data.canEdit ? (
    <NavButton
      title="Edit"
      href={`/exercises/${data.id}/edit`}
      variant="primary"
      testID="edit-exercise"
    />
  ) : (
    <DuplicateIntoMyGroup
      duplicate={async () => await duplicate.mutateAsync(data.id)}
      editorOf={(copyId) => `/exercises/${copyId}/edit`}
      testID="duplicate-exercise"
    />
  )
  const contents = (
    <Stack gap="md">
      <PinButton
        pinned={data.isFavourite}
        busy={pinning.busy}
        error={pinning.error}
        onToggle={() => {
          void pinning.submit(async () => {
            await favourite.mutateAsync({ id: data.id, on: !data.isFavourite })
          })
        }}
        testID="toggle-favourite"
      />
      <GroupPlacement
        ownerGroupId={data.ownerGroupId}
        canEdit={data.canEdit}
        transfer={async (toGroupId) => await transfer.mutateAsync({ id: data.id, toGroupId })}
        testID="exercise-transfer"
      />

      {data.description === '' ? null : <Text tone="muted">{data.description}</Text>}

      <About exercise={data} />

      <RecentHistory query={history} tracking={data.tracking} />

      {data.canEdit ? (
        // Refused while a plan or a logged set still uses it, and says so beside the button.
        <ConfirmButton
          title="Delete exercise"
          busy={deleting.busy}
          error={deleting.error}
          onConfirm={async () => {
            await deleting.submit(async () => {
              await remove.mutateAsync(data.id)
              onGone()
            })
          }}
          testID="exercise-delete"
        />
      ) : null}
    </Stack>
  )
  if (pane) {
    return (
      <Stack gap="lg" testID="exercise-detail-pane">
        <Stack direction="row" align="center" gap="md">
          <Stack grow>
            <Text variant="title">{data.name}</Text>
          </Stack>
          {action}
        </Stack>
        {contents}
      </Stack>
    )
  }
  return (
    <Screen title={data.name} testID="exercise-detail-screen" footer={action}>
      {contents}
    </Screen>
  )
}
