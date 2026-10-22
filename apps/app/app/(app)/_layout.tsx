import { StyleSheet } from 'react-native'
import { Redirect } from 'expo-router'
import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  Button,
  NavItem,
  Screen,
  Spinner,
  Text,
  color,
  space,
  useLayout,
} from '../../src/ui/index.ts'
import { useAuth } from '../../src/auth/auth-provider.tsx'
import { useSubmit } from '../../src/lib/use-submit.ts'

/**
 * Signed in, but the server could not be asked who by: no signal, or the server down. The session
 * is kept (src/auth/session.ts), so getting back in is a tap, never a password.
 */
function Unreachable({
  retry,
  signOut,
}: {
  readonly retry: () => Promise<void>
  readonly signOut: () => Promise<void>
}): React.JSX.Element {
  const { submit, busy } = useSubmit()
  return (
    <Screen title="Can’t reach your server" testID="unreachable-screen">
      <Text tone="muted">
        You are still signed in. Try again once you have a signal, or once the server is back.
      </Text>
      <Button
        title="Try again"
        busy={busy}
        onPress={() => {
          void submit(retry)
        }}
        testID="unreachable-retry"
      />
      {/* The way out when the server is gone for good, or moved: ends the session here only. */}
      <Button
        title="Sign out"
        variant="ghost"
        onPress={() => {
          void signOut()
        }}
        testID="unreachable-sign-out"
      />
    </Screen>
  )
}

/**
 * The signed-in shell.
 *
 * ONE navigator for both form factors. The headless `Tabs` from `expo-router/ui` lets the chrome be
 * anything, so the same four triggers render as a bottom bar on a phone and a left sidebar on a
 * tablet. Swapping navigators on a width change would remount every screen and throw away scroll
 * position and half-typed input mid-resize. See docs/08-frontend.md.
 */
const TABS = [
  { name: 'today', href: '/today', label: 'Today' },
  { name: 'workouts', href: '/workouts', label: 'Workouts' },
  { name: 'exercises', href: '/exercises', label: 'Exercises' },
  { name: 'settings', href: '/settings', label: 'Settings' },
] as const

export default function AppLayout(): React.JSX.Element {
  const { status, retry, signOut } = useAuth()
  const layout = useLayout()
  const insets = useSafeAreaInsets()
  const tablet = layout === 'tablet'

  if (status === 'loading') return <Spinner testID="boot-spinner" />
  if (status === 'signed-out') return <Redirect href="/login" />
  if (status === 'unreachable') return <Unreachable retry={retry} signOut={signOut} />

  return (
    /**
     * `TabList` must be a DIRECT child of `Tabs` — the navigator discovers its routes by walking
     * its own children for one, and a wrapper `View` in between makes it report "couldn't find any
     * screens for the navigator". So `Tabs` is itself the flex container.
     */
    <Tabs testID={`shell-${layout}`} style={[styles.fill, tablet ? styles.row : styles.column]}>
      <TabList
        style={
          tablet
            ? [styles.sidebar, { paddingTop: insets.top + space.md }]
            : [styles.bottomBar, { paddingBottom: insets.bottom + space.xs }]
        }
      >
        {TABS.map((tab) => (
          <TabTrigger key={tab.name} name={tab.name} href={tab.href} asChild>
            <NavItem label={tab.label} horizontal={!tablet} />
          </TabTrigger>
        ))}
      </TabList>
      <TabSlot />
    </Tabs>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  // Reversed so the bar is declared before the content but painted below it.
  column: { flexDirection: 'column-reverse' },
  row: { flexDirection: 'row' },
  sidebar: {
    // `TabList` renders a View that defaults to a row, so the column is stated explicitly. Without
    // it the sidebar laid the items out side by side and clipped them at 220px.
    flexDirection: 'column',
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    width: 220,
    borderRightWidth: 1,
    borderRightColor: color.border,
    paddingHorizontal: space.sm,
    gap: space.xs,
  },
  bottomBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: color.border,
    paddingTop: space.xs,
    paddingHorizontal: space.sm,
    gap: space.xs,
  },
})
