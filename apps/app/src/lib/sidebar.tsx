import { useRouter } from 'expo-router'
import { useAuth } from '../auth/auth-provider.tsx'
import { SidebarAccount, SidebarName, Stack } from '../ui/index.ts'
import { SessionReturn } from './session-return.tsx'

/**
 * A desktop's sidebar, around its tabs (#29): the product's name at its head; at its foot, who is
 * signed in — a tap to Settings — and the session left open, if one is. A phone has no room for
 * either: its tabs are the bar, and the account is in Settings.
 */
export function SidebarHead(): React.JSX.Element {
  return <SidebarName name="cedo" />
}

/** Pushed to the bottom of the sidebar, below the tabs, as one: the account, then the band. */
export function SidebarFoot(): React.JSX.Element {
  const { me } = useAuth()
  const router = useRouter()
  return (
    <Stack gap="md" justify="flex-end" grow>
      {me === null ? null : (
        <SidebarAccount
          name={me.user.displayName}
          handle={`@${me.user.username}`}
          onPress={() => {
            router.push('/settings')
          }}
        />
      )}
      <SessionReturn inSidebar />
    </Stack>
  )
}
