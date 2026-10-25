import { useState } from 'react'
import { type Exercise, musclesByLoad } from '@cedo/contract'
import { apiUrl } from '../api/http.ts'
import {
  Button,
  ConfirmButton,
  Field,
  FormError,
  Input,
  NavButton,
  Sheet,
  Stack,
  Text,
  Thumbnail,
} from '../ui/index.ts'

/**
 * How to do an exercise, mid-set, without leaving the session (#24): its cue for this entry, what
 * it is, how it is done, the muscles it works — most first — and its video, as a picture and a
 * link to watch it.
 */
export function HowTo({
  exercise,
  cue,
  onClose,
}: {
  readonly exercise: Exercise | null
  readonly cue: string | null
  readonly onClose: () => void
}): React.JSX.Element {
  const video = exercise?.media.find((m) => m.kind === 'video_link')
  // Said only when there is something to say: an empty field is as good as none.
  const description = exercise?.description?.trim() ?? ''
  const instructions = exercise?.instructions?.trim() ?? ''
  return (
    <Sheet open={exercise !== null} onClose={onClose} title={exercise?.name ?? ''} testID="how-to">
      {cue === null ? null : <Text variant="label">{cue}</Text>}
      {description === '' ? null : <Text tone="muted">{description}</Text>}
      {instructions === '' ? null : (
        <Stack gap="xs">
          <Text variant="label" tone="muted">
            How to
          </Text>
          <Text>{instructions}</Text>
        </Stack>
      )}
      <Text variant="caption" tone="muted" testID="how-to-muscles">
        {musclesByLoad(exercise?.muscles ?? [])
          .map((m) => `${m.name} ${m.loadPct}%`)
          .join(', ')}
      </Text>
      {video === undefined ? null : (
        <Stack gap="sm">
          {video.thumbnailUrl === null ? null : (
            <Thumbnail uri={apiUrl(video.thumbnailUrl)} label={`${exercise?.name ?? ''}, video`} />
          )}
          <NavButton title="Watch the video" href={video.url} testID="how-to-video" />
        </Stack>
      )}
    </Sheet>
  )
}

/**
 * The session's menu (#24): its notes; Finish, asked twice — finishing is final; and leaving it
 * open for later, the session kept in progress. Finish is also offered in the Log button's place
 * once every set of the day is logged.
 */
export function WorkoutMenu({
  open,
  onClose,
  ended,
  notes,
  onSaveNotes,
  onFinish,
  onLeave,
  busy,
  error,
}: {
  readonly open: boolean
  readonly onClose: () => void
  readonly ended: boolean
  readonly notes: string | null
  readonly onSaveNotes: (notes: string | null) => Promise<void>
  readonly onFinish: () => Promise<void>
  readonly onLeave: () => void
  readonly busy: boolean
  readonly error: string | null
}): React.JSX.Element {
  const [draft, setDraft] = useState(notes ?? '')
  return (
    <Sheet open={open} onClose={onClose} title="Session" testID="session-menu">
      <Field label="Notes">
        <Input
          value={draft}
          onChangeText={setDraft}
          placeholder="How it went, what to change"
          multiline
          testID="session-notes"
        />
      </Field>
      <Button
        title="Save notes"
        variant="secondary"
        busy={busy}
        onPress={() => {
          void onSaveNotes(draft.trim() === '' ? null : draft.trim())
        }}
        testID="session-notes-save"
      />
      <FormError message={error} testID="session-menu-error" />
      {ended ? null : (
        <Stack gap="sm">
          <ConfirmButton
            title="Finish session"
            busy={busy}
            onConfirm={onFinish}
            testID="finish-session"
          />
          <Button
            title="Leave it open for later"
            variant="ghost"
            onPress={onLeave}
            testID="leave-session-open"
          />
        </Stack>
      )}
    </Sheet>
  )
}
