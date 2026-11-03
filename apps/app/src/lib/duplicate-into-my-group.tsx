import { useRouter } from 'expo-router'
import { Button, FormError, Stack, Text } from '../ui/index.ts'
import { useSubmit } from './use-submit.ts'

/**
 * What a READER is offered on something shared with them, in place of Edit: a copy in their own
 * group, opened straight in its editor — the way to adapt what they may not change. The same on an
 * exercise and a plan, so it lives once. A refusal is the server's, shown beside the button: a plan
 * is copied only if its new owner can read every exercise it uses, and says why.
 */
export function DuplicateIntoMyGroup({
  duplicate,
  editorOf,
  over = false,
  testID,
}: {
  /** Makes the copy, and says where it is. */
  readonly duplicate: () => Promise<{ readonly id: string }>
  /** The route of the copy's editor. */
  readonly editorOf: (copyId: string) => string
  /**
   * Opened OVER the screen it was asked from, rather than in its place — from a pane beside a list,
   * or a sheet over it (#29), whose list is the root of its tab: replaced, there was nothing to come
   * back to.
   */
  readonly over?: boolean
  readonly testID: string
}): React.JSX.Element {
  const router = useRouter()
  const { submit, busy, error } = useSubmit()
  return (
    <Stack gap="xs">
      <Text variant="caption" tone="faint" align="center">
        Shared with you as a reader.
      </Text>
      <Button
        title="Duplicate into my group"
        onPress={() => {
          void submit(async () => {
            const copy = await duplicate()
            if (over) router.push(editorOf(copy.id))
            else router.replace(editorOf(copy.id))
          })
        }}
        busy={busy}
        testID={testID}
      />
      <FormError message={error} testID={`${testID}-error`} />
    </Stack>
  )
}
