import { useState } from 'react'
import { type Media, parseMediaUrl } from '@cedo/contract'
import { Button, FormError, Input, ListRow, Stack, Text } from '../ui/index.ts'
import { apiUrl } from '../api/http.ts'
import { useCreateMediaLink } from '../api/queries.ts'
import { useSubmit } from './use-submit.ts'

export interface MediaLinksProps {
  readonly value: readonly Media[]
  readonly onChange: (value: Media[]) => void
}

/**
 * Attaching a demonstration video, which is what most exercise media is.
 *
 * `parseMediaUrl` is the contract's own pure function, so this recognises exactly the URLs the API
 * accepts and can say so before the request rather than after a 422. It is the only check the form
 * does; the server decides. See docs/adr/0009-media-model.md.
 */
export function MediaLinks({ value, onChange }: MediaLinksProps): React.JSX.Element {
  const [url, setUrl] = useState('')
  const create = useCreateMediaLink()
  const { submit, busy, error } = useSubmit()

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
          trailing="Remove"
          onPress={() => {
            onChange(value.filter((m) => m.id !== media.id))
          }}
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
        <Text variant="caption" tone="warning">
          Not a link this recognises. It will be stored as a plain URL.
        </Text>
      ) : null}
    </Stack>
  )
}
