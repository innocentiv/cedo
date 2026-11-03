import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

/**
 * The entry editor's three levels of text (docs/08-frontend.md, "An entry's settings"): a section's
 * heading, a field's label, then help — never two at one look. The first editor laid every field
 * out at one weight, and a label such as "rest" read like the cue under it.
 */

/** A titled section, with the widest space between it and the next. */
export function Section({
  title,
  children,
  testID,
}: {
  readonly title: string
  readonly children: React.ReactNode
  readonly testID?: string | undefined
}): React.JSX.Element {
  return (
    <Stack gap="md" testID={testID}>
      <Text variant="heading">{title}</Text>
      {children}
    </Stack>
  )
}

/** A field's label: what the control under it holds. */
export function Label({ children }: { readonly children: string }): React.JSX.Element {
  return (
    <Text variant="label" tone="muted">
      {children}
    </Text>
  )
}

/** Help: a rule's sentence, what an edit will do — quieter than any label. */
export function Help({
  children,
  testID,
}: {
  readonly children: string
  readonly testID?: string | undefined
}): React.JSX.Element {
  return (
    <Text variant="caption" tone="faint" testID={testID}>
      {children}
    </Text>
  )
}
