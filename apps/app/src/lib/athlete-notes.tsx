import { useState } from 'react'
import { type AthleteNote, noteByline } from '@cedo/contract'
import {
  Button,
  Card,
  ConfirmButton,
  FormError,
  Input,
  Loaded,
  Prose,
  Stack,
  Text,
} from '../ui/index.ts'
import { useNotes, useRemoveNote, useRewordNote, useWriteNote } from '../api/note-queries.ts'
import { useAuth } from '../auth/auth-provider.tsx'
import { useSubmit } from './use-submit.ts'

/**
 * What is known about someone, kept for planning their training (#41): your own on Progress, or an
 * athlete's on their page, read by their coach — written by either. Only a note's author changes
 * its words; the author or the athlete removes it. See GLOSSARY.md, "Athlete note".
 */
export function Notes({
  athleteId,
  testID,
}: {
  /** Whose: an athlete you coach — or, left out, you. */
  readonly athleteId?: string
  readonly testID: string
}): React.JSX.Element {
  const readerId = useAuth().me?.user.id ?? ''
  return (
    <Card testID={testID}>
      <Stack gap="md">
        <Text variant="label" tone="muted">
          Notes
        </Text>
        <NewNote athleteId={athleteId} testID={`${testID}-new`} />
        <Loaded query={useNotes(athleteId)} testID={`${testID}-list`}>
          {(notes) => (
            <Stack gap="lg" testID={`${testID}-list`}>
              {notes.length === 0 ? <Text tone="muted">Nothing noted yet.</Text> : null}
              {notes.map((note, at) => (
                <Note
                  key={note.id}
                  note={note}
                  athleteId={athleteId}
                  readerId={readerId}
                  testID={`${testID}-note-${String(at)}`}
                />
              ))}
            </Stack>
          )}
        </Loaded>
      </Stack>
    </Card>
  )
}

/** A note written down: its words, then Add. Cleared once it is kept. */
function NewNote({
  athleteId,
  testID,
}: {
  readonly athleteId: string | undefined
  readonly testID: string
}): React.JSX.Element {
  const [text, setText] = useState('')
  const write = useWriteNote(athleteId)
  const { submit, busy, error } = useSubmit()
  return (
    <Stack gap="sm">
      <Input
        value={text}
        onChangeText={setText}
        placeholder="An injury, a preference, what was said of a plan, a week away"
        multiline
        testID={`${testID}-text`}
      />
      <FormError message={error} testID={`${testID}-error`} />
      <Button
        title="Add note"
        variant="secondary"
        disabled={text.trim() === ''}
        busy={busy}
        onPress={() => {
          void submit(async () => {
            await write.mutateAsync({ text })
            setText('')
          })
        }}
        testID={`${testID}-add`}
      />
    </Stack>
  )
}

/** One note: who wrote it and when, its words — and changing or removing it, for whoever may. */
function Note({
  note,
  athleteId,
  readerId,
  testID,
}: {
  readonly note: AthleteNote
  readonly athleteId: string | undefined
  readonly readerId: string
  readonly testID: string
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const remove = useRemoveNote(athleteId)
  const { submit, busy, error } = useSubmit()
  return (
    <Stack gap="xs" testID={testID}>
      <Text variant="caption" tone="muted">
        {noteByline(note, readerId)}
      </Text>
      {editing ? (
        <Reword
          note={note}
          athleteId={athleteId}
          onDone={() => {
            setEditing(false)
          }}
          testID={`${testID}-reword`}
        />
      ) : (
        <>
          <Prose text={note.text} testID={`${testID}-text`} />
          <Stack direction="row" gap="sm">
            {note.canEdit ? (
              <Button
                title="Edit"
                variant="ghost"
                size="small"
                onPress={() => {
                  setEditing(true)
                }}
                testID={`${testID}-edit`}
              />
            ) : null}
            {note.canDelete ? (
              <ConfirmButton
                title="Remove"
                size="small"
                busy={busy}
                error={error}
                onConfirm={async () => {
                  await submit(async () => {
                    await remove.mutateAsync(note.id)
                  })
                }}
                testID={`${testID}-remove`}
              />
            ) : null}
          </Stack>
        </>
      )}
    </Stack>
  )
}

/** A note's words, changed in place: Save keeps them, Cancel leaves them as they were. */
function Reword({
  note,
  athleteId,
  onDone,
  testID,
}: {
  readonly note: AthleteNote
  readonly athleteId: string | undefined
  readonly onDone: () => void
  readonly testID: string
}): React.JSX.Element {
  const [text, setText] = useState(note.text)
  const reword = useRewordNote(athleteId)
  const { submit, busy, error } = useSubmit()
  return (
    <Stack gap="sm">
      <Input value={text} onChangeText={setText} multiline autoFocus testID={`${testID}-text`} />
      <FormError message={error} testID={`${testID}-error`} />
      <Stack direction="row" gap="sm">
        <Button
          title="Cancel"
          variant="secondary"
          grow
          onPress={onDone}
          testID={`${testID}-cancel`}
        />
        <Button
          title="Save"
          grow
          disabled={text.trim() === ''}
          busy={busy}
          onPress={() => {
            void submit(async () => {
              await reword.mutateAsync({ id: note.id, text })
              onDone()
            })
          }}
          testID={`${testID}-save`}
        />
      </Stack>
    </Stack>
  )
}
