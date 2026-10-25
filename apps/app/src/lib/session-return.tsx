import { usePathname, useRouter } from 'expo-router'
import { useSessions } from '../api/queries.ts'
import { ReturnBar } from '../ui/index.ts'

/** Where a session is trained: the tab bar gives way to its own header there (#24). */
export const onWorkout = (pathname: string): boolean => pathname.startsWith('/today/session/')

/**
 * The session in progress, followed everywhere but its own screen: one tap back to it (#24). Asked
 * only inside the signed-in shell — it is a read that needs the session's token.
 */
export function SessionReturn({
  inSidebar = false,
}: {
  /** At the foot of a desktop's sidebar, rather than over a phone's tabs. */
  readonly inSidebar?: boolean
}): React.JSX.Element | null {
  const pathname = usePathname()
  const router = useRouter()
  const open = useSessions({ inProgress: true, limit: 1 }).data?.items[0]
  // Today says it itself, larger: the session in progress is its first thing (#25).
  if (open === undefined || onWorkout(pathname) || pathname === '/today') return null
  return (
    <ReturnBar
      title={open.dayName ?? 'Session in progress'}
      startedAt={open.startedAt}
      inSidebar={inSidebar}
      onPress={() => {
        router.push(`/today/session/${open.id}`)
      }}
      testID="session-return"
    />
  )
}
