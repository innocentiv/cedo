import { StyleSheet } from 'react-native'
import { Redirect, usePathname } from 'expo-router'
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
import { SessionReturn, onWorkout } from '../../src/lib/session-return.tsx'
import { SidebarFoot, SidebarHead } from '../../src/lib/sidebar.tsx'
import { useAthletes } from '../../src/api/athlete-queries.ts'

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
 * anything, so the same triggers render as a bottom bar on a phone and a left sidebar on a
 * tablet. Swapping navigators on a width change would remount every screen and throw away scroll
 * position and half-typed input mid-resize. See docs/08-frontend.md.
 */
const TABS = [
  { name: 'today', href: '/today', label: 'Today' },
  { name: 'workouts', href: '/workouts', label: 'Workouts' },
  { name: 'exercises', href: '/exercises', label: 'Exercises' },
  { name: 'progress', href: '/progress', label: 'Progress' },
  { name: 'athletes', href: '/athletes', label: 'Athletes', coaching: true },
  { name: 'settings', href: '/settings', label: 'Settings' },
] as const

export default function AppLayout(): React.JSX.Element {
  const { status, retry, signOut } = useAuth()
  const layout = useLayout()
  const insets = useSafeAreaInsets()
  const pathname = usePathname()
  const tablet = layout === 'tablet'
  // Athletes is offered only to a coach (#30): someone with an athlete sharing training with them.
  const coaching = (useAthletes(status === 'signed-in').data?.length ?? 0) > 0

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
        style={[
          tablet
            ? [
                styles.sidebar,
                { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.sm },
              ]
            : [
                styles.bottomBar,
                // Over the home indicator, as a native tab bar sits (#61): the inset's top part is
                // room the swipe never reaches. Clear of the indicator still, and a full touch
                // target above it.
                { paddingBottom: insets.bottom > 0 ? insets.bottom - space.md : space.xs },
              ],
          // A session has the app to itself: its header stands where the tabs were (#24).
          onWorkout(pathname) ? styles.hidden : null,
        ]}
      >
        {tablet ? <SidebarHead /> : null}
        {TABS.map((tab) =>
          // Still a trigger, unshown: the navigator knows its routes only by their triggers.
          'coaching' in tab && !coaching ? (
            <TabTrigger key={tab.name} name={tab.name} href={tab.href} style={styles.hidden} />
          ) : (
            <TabTrigger key={tab.name} name={tab.name} href={tab.href} asChild>
              <NavItem label={tab.label} horizontal={!tablet} />
            </TabTrigger>
          ),
        )}
        {/* The navigator reads only the triggers in here; anything else is just drawn. */}
        {tablet ? <SidebarFoot /> : null}
      </TabList>
      {tablet ? null : <SessionReturn />}
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
  hidden: { display: 'none' },
  bottomBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: color.border,
    paddingTop: space.xs,
    paddingHorizontal: space.sm,
    gap: space.xs,
  },
})
