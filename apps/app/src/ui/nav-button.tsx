import { useRouter } from 'expo-router'
import { Button, type ButtonVariant } from './button.tsx'

export interface NavButtonProps {
  readonly title: string
  readonly href: string
  readonly variant?: ButtonVariant | undefined
  readonly testID?: string | undefined
}

/**
 * A button that navigates.
 *
 * `<Link asChild><Button onPress={() => {}} /></Link>` works, but it forces every call site to pass
 * an empty handler that is never called — which reads like a bug and invites someone to "fix" it by
 * putting real logic there. Routing through `useRouter` keeps the intent visible.
 */
export function NavButton({ title, href, variant, testID }: NavButtonProps): React.JSX.Element {
  const router = useRouter()
  return (
    <Button
      title={title}
      variant={variant ?? 'ghost'}
      testID={testID}
      onPress={() => {
        router.push(href)
      }}
    />
  )
}
