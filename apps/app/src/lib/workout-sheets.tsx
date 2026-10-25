import { useState } from 'react'
import { type Exercise, musclesByLoad, notesToKeep } from '@cedo/contract'
import { apiUrl } from '../api/http.ts'
import {
  ConfirmButton,
  Field,
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
 * The session's menu (#24): its notes, kept as the menu closes — nothing to save, nothing to lose by
 * closing — and Finish, asked twice, finishing being final. Leaving the session open is the
 * header's back, not a choice in here: a menu of Close beside Leave it open asked the athlete to tell
 * two ways out apart. Finish is also offered in the Log button's place once every set of the day is
 * logged.
 */
export function WorkoutMenu({
  open,
  onClose,
  ended,
  notes,
  onSaveNotes,
  onFinish,
  busy,
  error,
}: {
  readonly open: boolean
  readonly onClose: () => void
  readonly ended: boolean
  readonly notes: string | null
  readonly onSaveNotes: (notes: string | null) => Promise<void>
  readonly onFinish: () => Promise<void>
  readonly busy: boolean
  readonly error: string | null
}): React.JSX.Element {
  const [draft, setDraft] = useState(notes ?? '')
  const close = () => {
    const kept = notesToKeep(draft, notes)
    // A refusal is said on the workout, where the athlete is once this closes (`session-error`).
    if (kept !== undefined) void onSaveNotes(kept)
    onClose()
  }
  return (
    <Sheet open={open} onClose={close} title="Session" testID="session-menu">
      <Field label="Notes">
        <Input
          value={draft}
          onChangeText={setDraft}
          placeholder="How it went, what to change"
          multiline
          testID="session-notes"
        />
      </Field>
      {ended ? null : (
        <ConfirmButton
          title="Finish session"
          busy={busy}
          error={error}
          onConfirm={onFinish}
          testID="finish-session"
        />
      )}
    </Sheet>
  )
}
