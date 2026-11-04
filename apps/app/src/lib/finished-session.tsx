import type { SessionDetail, SetLog } from '@cedo/contract'
import { useDeleteSession } from '../api/session-queries.ts'
import { ConfirmButton, Stack, Text } from '../ui/index.ts'
import { SetsByExercise } from './session-parts.tsx'
import { useGoBack } from './use-go-back.ts'
import { useSubmit } from './use-submit.ts'
import { FinishedSummary, SessionNotes } from './workout-summary.tsx'

/**
 * A finished session of your own, as it is read back (#25) — and fixed (#31): a set tapped opens
 * right below itself to be corrected or removed (#63), and the whole session can be deleted, asked twice, which goes back to
 * where it was opened from. Finishing still ends the logging: nothing here adds a set. The screen's
 * two columns: what it came to and its notes (`FinishedMain`), beside its sets (`FinishedSide`).
 */
export function FinishedMain({
  session,
  onSaveNotes,
}: {
  readonly session: SessionDetail
  readonly onSaveNotes: (notes: string | null) => Promise<void>
}): React.JSX.Element {
  return (
    <>
      <FinishedSummary session={session} />
      <SessionNotes notes={session.notes} onSave={onSaveNotes} />
    </>
  )
}

/** Its sets, each opened to be fixed, and deleting the whole session. */
export function FinishedSide({
  session,
  logs,
}: {
  readonly session: SessionDetail
  /** Its sets as the server has them. */
  readonly logs: readonly SetLog[]
}): React.JSX.Element {
  const deleting = useSubmit()
  const remove = useDeleteSession(session.id)
  const goBack = useGoBack('/today')
  return (
    // Delete last, under the sets: on a phone, the bottom of the page, past what is fixed.
    <Stack gap="xl">
      <Stack gap="md">
        {logs.length === 0 ? null : (
          <Text variant="caption" tone="muted">
            Tap a set to correct or remove it.
          </Text>
        )}
        <SetsByExercise logs={logs} sessionId={session.id} />
      </Stack>
      <ConfirmButton
        title="Delete session"
        busy={deleting.busy}
        error={deleting.error}
        onConfirm={async () => {
          await deleting.submit(async () => {
            await remove.mutateAsync()
            goBack()
          })
        }}
        testID="delete-session"
      />
    </Stack>
  )
}
