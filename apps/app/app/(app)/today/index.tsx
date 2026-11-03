import { useRouter } from 'expo-router'
import { type SessionStart, formatLongDay, startOfWeek } from '@cedo/contract'
import { BrandHeading, FormError, Loaded, Screen, useLayout } from '../../../src/ui/index.ts'
import { useHistory, useStartSession, useToday } from '../../../src/api/queries.ts'
import { Now, PagedHistory } from '../../../src/lib/today-parts.tsx'
import { ownSession } from '../../../src/lib/addresses.ts'
import { useSubmit } from '../../../src/lib/use-submit.ts'

/**
 * Today (#25): what to do next — the session in progress, or the next day of the current workout
 * and Start — the week, and history by week. Two reads, each answered on its own, so a history that
 * fails does not hide the session to resume. See docs/08-frontend.md, "Today".
 */
export default function Today(): React.JSX.Element {
  const router = useRouter()
  const phone = useLayout() === 'phone'
  // The reader's own week — the server cannot know where it starts — asked each render, so an app
  // left open past Sunday midnight moves on to the new one.
  const day = new Date()
  const weekStart = startOfWeek(day).toISOString()
  const today = useToday(weekStart)
  const history = useHistory()
  const start = useStartSession()
  const { submit, busy, error } = useSubmit()

  const begin = (body: SessionStart) => {
    void submit(async () => {
      const session = await start.mutateAsync(body)
      router.push(`/today/session/${session.id}`)
    })
  }

  return (
    <Screen
      // The day itself (#61): the tab already says Today. The mark beside it on a phone; a
      // desktop's is atop the sidebar, beside it already.
      ownHeading={<BrandHeading text={formatLongDay(day)} mark={phone} testID="today-heading" />}
      testID="today-screen"
      columns={{
        main: (
          <>
            <FormError message={error} testID="today-error" />
            <Loaded query={today} testID="today-now">
              {(now) => <Now today={now} weekStart={weekStart} onStart={begin} busy={busy} />}
            </Loaded>
          </>
        ),
        side: <PagedHistory history={history} sessionHref={ownSession} testID="today" />,
      }}
    />
  )
}
