import { useState } from 'react'
import { type Media, parseMediaUrl, uploadLimits, uploadRefusal } from '@cedo/contract'
import { Button, FormError, IconButton, Input, ListRow, Stack, Text } from '../ui/index.ts'
import { apiUrl } from '../api/http.ts'
import { useCreateMediaLink, useUploadMedia } from '../api/queries.ts'
import { pickImage } from './pick-image.ts'
import { useSubmit } from './use-submit.ts'

export interface MediaLinksProps {
  readonly value: readonly Media[]
  readonly onChange: (value: Media[]) => void
}

/**
 * Attaching a demonstration video, which is what most exercise media is, or uploading an image.
 *
 * `parseMediaUrl` and `uploadRefusal` are the contract's own pure functions, so this recognises
 * exactly the URLs the API accepts, and refuses a file too large to send, before the request rather
 * than after a 422 — in the API's own words. The server still decides. See
 * docs/adr/0009-media-model.md.
 */
export function MediaLinks({ value, onChange }: MediaLinksProps): React.JSX.Element {
  const [url, setUrl] = useState('')
  const create = useCreateMediaLink()
  const upload = useUploadMedia()
  const { submit, busy, error } = useSubmit()
  // Its own, so a refused upload is said beside the upload and not beside the link.
  const uploading = useSubmit()
  // Refused before sending: a file well over the limit is cut off by the server with a bare 413.
  const [tooLarge, setTooLarge] = useState<string | null>(null)

  const trimmed = url.trim()
  const unrecognised = error === null && trimmed !== '' && parseMediaUrl(trimmed) === null

  const add = () => {
    void submit(async () => {
      const media = await create.mutateAsync({ url: trimmed })
      onChange([...value, media])
      setUrl('')
    })
  }

  return (
    <Stack gap="sm" testID="media-links">
      {value.map((media) => (
        <ListRow
          key={media.id}
          title={media.title === '' ? apiUrl(media.url) : media.title}
          subtitle={media.kind === 'video_link' ? 'Video' : 'Image'}
          accessory={
            <IconButton
              name="remove"
              label="Remove it"
              edge="end"
              onPress={() => {
                onChange(value.filter((m) => m.id !== media.id))
              }}
              testID={`media-remove-${media.id}`}
            />
          }
          testID={`media-row-${media.id}`}
        />
      ))}

      <Stack direction="row" gap="sm" align="center">
        <Stack grow>
          <Input
            value={url}
            onChangeText={setUrl}
            placeholder="https://youtube.com/watch?v=…"
            testID="media-url"
          />
        </Stack>
        <Button
          title="Attach"
          variant="secondary"
          onPress={add}
          disabled={trimmed === ''}
          busy={busy}
          testID="attach-media"
        />
      </Stack>

      <FormError message={error} testID="media-error" />
      {unrecognised ? (
        <Text variant="caption" tone="muted">
          Not a link this recognises. It will be stored as a plain URL.
        </Text>
      ) : null}

      {/* An image of the movement, from the device (#13). The limits are the API's, said first. */}
      <Button
        title="Upload image"
        variant="secondary"
        onPress={() => {
          setTooLarge(null)
          void uploading.submit(async () => {
            const picked = await pickImage()
            if (picked === null) return
            const refusal = uploadRefusal(picked.bytes)
            if (refusal !== null) {
              setTooLarge(refusal)
              return
            }
            onChange([...value, await upload.mutateAsync(picked.form)])
          })
        }}
        busy={uploading.busy}
        testID="upload-image"
      />
      <Text variant="caption" tone="faint" testID="upload-limits">
        {uploadLimits()}
      </Text>
      <FormError message={tooLarge ?? uploading.error} testID="upload-error" />
    </Stack>
  )
}
