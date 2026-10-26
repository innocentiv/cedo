import { useState } from 'react'
import type { SessionDetail, SetLog } from '@cedo/contract'
import { useDeleteSession } from '../api/session-queries.ts'
import { Columns, ConfirmButton, Stack, Text } from '../ui/index.ts'
import { FixSet } from './fix-set.tsx'
import { SetsByExercise } from './session-parts.tsx'
import { useGoBack } from './use-go-back.ts'
import { useSubmit } from './use-submit.ts'
import { FinishedSummary, SessionNotes } from './workout-summary.tsx'

/**
 * A finished session of your own, as it is read back (#25) — and fixed (#31): a set tapped opens to
 * be corrected or removed, and the whole session can be deleted, asked twice, which goes back to
 * where it was opened from. Finishing still ends the logging: nothing here adds a set.
 */
export function FinishedSession({
  session,
  logs,
  onSaveNotes,
}: {
  readonly session: SessionDetail
  /** Its sets as the server has them. */
  readonly logs: readonly SetLog[]
  readonly onSaveNotes: (notes: string | null) => Promise<void>
}): React.JSX.Element {
  // By id, so the sheet shows the set as read again after a fix, and closes once it is removed.
  const [open, setOpen] = useState<string | null>(null)
  const deleting = useSubmit()
  const remove = useDeleteSession(session.id)
  const goBack = useGoBack('/today')
  return (
    <>
      <Columns
        main={
          <>
            <FinishedSummary session={session} />
            <SessionNotes notes={session.notes} onSave={onSaveNotes} />
          </>
        }
        side={
          // Delete last, under the sets: on a phone, the bottom of the page, past what is fixed.
          <Stack gap="xl">
            <Stack gap="md">
              {logs.length === 0 ? null : (
                <Text variant="caption" tone="muted">
                  Tap a set to correct or remove it.
                </Text>
              )}
              <SetsByExercise
                logs={logs}
                onOpen={(log) => {
                  setOpen(log.id)
                }}
              />
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
        }
      />
      <FixSet
        sessionId={session.id}
        log={logs.find((log) => log.id === open) ?? null}
        logs={logs}
        onClose={() => {
          setOpen(null)
        }}
      />
    </>
  )
}
