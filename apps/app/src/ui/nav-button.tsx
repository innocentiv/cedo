import { useRouter } from 'expo-router'
import { Linking } from 'react-native'
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
 *
 * An absolute `http(s)` href leaves the app: opened by the platform — a new tab on web, the browser
 * on native — rather than pushed onto a stack that has no such route.
 */
export function NavButton({ title, href, variant, testID }: NavButtonProps): React.JSX.Element {
  const router = useRouter()
  return (
    <Button
      title={title}
      variant={variant ?? 'ghost'}
      testID={testID}
      onPress={() => {
        if (/^https?:\/\//u.test(href)) void Linking.openURL(href)
        else router.push(href)
      }}
    />
  )
}
