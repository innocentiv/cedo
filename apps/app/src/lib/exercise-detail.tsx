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
  Prose,
  Sheet,
  Spinner,
  Stack,
  Text,
} from '../ui/index.ts'
import { DuplicateIntoMyGroup } from './duplicate-into-my-group.tsx'
import { About, RecentHistory } from './exercise-about.tsx'
import { ownSession } from './addresses.ts'
import { OwnershipLine, usePinning } from './ownership-line.tsx'
import { useSubmit } from './use-submit.ts'

/**
 * One exercise over the library on a phone (#29): a sheet, put away with its × or a tap around it,
 * as an entry's settings are over a plan — not a screen of its own with no way back from it. Titled
 * with the exercise's name once it is read.
 */
export function ExerciseSheet({
  id,
  onClose,
}: {
  readonly id: string
  readonly onClose: () => void
}): React.JSX.Element {
  const name = useExercise(id).data?.name ?? ''
  return (
    <Sheet open onClose={onClose} title={name} testID="exercise-sheet">
      <ExerciseDetailView id={id} place="sheet" onGone={onClose} />
    </Sheet>
  )
}

/**
 * One exercise: what it is, its history, and what can be done with it (#29). Where the library
 * opens one: on a desktop a pane beside the list, its title and Edit at its head; on a phone in a
 * sheet over it (`ExerciseSheet`), titled by the sheet, Edit under the line saying which group it
 * is in. `onGone`: where to go once it is deleted.
 */
export function ExerciseDetailView({
  id,
  place,
  onGone,
}: {
  readonly id: string
  readonly place: 'pane' | 'sheet'
  readonly onGone: () => void
}): React.JSX.Element {
  const { data, isPending, error, refetch } = useExercise(id)
  const history = useExerciseHistory(id)
  const transfer = useTransferExercise()
  const duplicate = useDuplicateExercise()
  const remove = useDeleteExercise()
  // One submission each, so a refusal shows beside what was refused, and only that is busy.
  const pinning = usePinning(
    useFavouriteExercise(),
    { id, isFavourite: data?.isFavourite ?? false },
    'toggle-favourite',
  )
  const deleting = useSubmit()

  if (error !== null) {
    return (
      <ErrorNotice
        message={error.message}
        onRetry={() => {
          void refetch()
        }}
      />
    )
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
      over
      testID="duplicate-exercise"
    />
  )
  // Under its name, before anything else: which group it is in, pinning it, moving it.
  const ownership = (
    <OwnershipLine
      ownerGroupId={data.ownerGroupId}
      canEdit={data.canEdit}
      transfer={async (toGroupId) => await transfer.mutateAsync({ id: data.id, toGroupId })}
      pin={pinning}
      testID="exercise-transfer"
    />
  )
  const contents = (
    <Stack gap="md">
      {data.description === '' ? null : <Prose text={data.description} tone="muted" />}

      <About exercise={data} />

      <RecentHistory query={history} tracking={data.tracking} sessionHref={ownSession} />

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
  if (place === 'sheet') {
    return (
      <Stack gap="lg" testID="exercise-detail-sheet">
        {ownership}
        {action}
        {contents}
      </Stack>
    )
  }
  return (
    <Stack gap="lg" testID="exercise-detail-pane">
      <Stack direction="row" align="center" gap="md">
        <Stack grow>
          <Text variant="title">{data.name}</Text>
        </Stack>
        {action}
      </Stack>
      {ownership}
      {contents}
    </Stack>
  )
}
