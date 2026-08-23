import { StyleSheet } from 'react-native'
import { Redirect } from 'expo-router'
import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Spinner, color, space, useLayout } from '../../src/ui/index.ts'
import { NavItem } from '../../src/ui/nav-item.tsx'
import { useAuth } from '../../src/auth/auth-provider.tsx'

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
  const { status } = useAuth()
  const layout = useLayout()
  const insets = useSafeAreaInsets()
  const tablet = layout === 'tablet'

  if (status === 'loading') return <Spinner testID="boot-spinner" />
  if (status === 'signed-out') return <Redirect href="/login" />

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
