import { Pressable, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '../auth/auth-provider.tsx'
import { Stack, Text, space } from '../ui/index.ts'
import { SessionReturn } from './session-return.tsx'

/**
 * A desktop's sidebar, around its tabs (#29): the product's name at its head; at its foot, who is
 * signed in — a tap to Settings — and the session left open, if one is. A phone has no room for
 * either: its tabs are the bar, and the account is in Settings.
 */
export function SidebarHead(): React.JSX.Element {
  return (
    <Stack style={styles.head}>
      <Text variant="title" testID="sidebar-name">
        cedo
      </Text>
    </Stack>
  )
}

export function SidebarFoot(): React.JSX.Element {
  const { me } = useAuth()
  const router = useRouter()
  return (
    <Stack gap="md" style={styles.foot}>
      {me === null ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${me.user.displayName}, settings`}
          onPress={() => {
            router.push('/settings')
          }}
          testID="sidebar-account"
          style={({ pressed }) => [styles.account, pressed ? styles.pressed : null]}
        >
          <Text variant="label" numberOfLines={1}>
            {me.user.displayName}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {`@${me.user.username}`}
          </Text>
        </Pressable>
      )}
      <SessionReturn inSidebar />
    </Stack>
  )
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: space.md, paddingBottom: space.lg },
  foot: { marginTop: 'auto' },
  account: { paddingHorizontal: space.md, paddingVertical: space.sm },
  pressed: { opacity: 0.6 },
})
