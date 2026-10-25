import { useRouter } from 'expo-router'
import { type SessionStart, startOfWeek } from '@cedo/contract'
import { Columns, FormError, Loaded, Screen } from '../../../src/ui/index.ts'
import { useHistory, useStartSession, useToday } from '../../../src/api/queries.ts'
import { History, Now } from '../../../src/lib/today-parts.tsx'
import { useSubmit } from '../../../src/lib/use-submit.ts'

/**
 * Today (#25): what to do next — the session in progress, or the next day of the current workout
 * and Start — the week, and history by week. Two reads, each answered on its own, so a history that
 * fails does not hide the session to resume. See docs/08-frontend.md, "Today".
 */
export default function Today(): React.JSX.Element {
  const router = useRouter()
  // The reader's own week — the server cannot know where it starts — asked each render, so an app
  // left open past Sunday midnight moves on to the new one.
  const weekStart = startOfWeek(new Date()).toISOString()
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
    <Screen title="Today" wide testID="today-screen">
      <FormError message={error} testID="today-error" />
      <Columns
        main={
          <Loaded query={today} testID="today-now">
            {(now) => <Now today={now} weekStart={weekStart} onStart={begin} busy={busy} />}
          </Loaded>
        }
        side={
          <Loaded query={history} testID="today">
            {(data) => (
              <History
                sessions={data.pages.flatMap((page) => page.items)}
                older={
                  history.hasNextPage
                    ? {
                        load: () => {
                          void history.fetchNextPage()
                        },
                        busy: history.isFetchingNextPage,
                      }
                    : null
                }
              />
            )}
          </Loaded>
        }
      />
    </Screen>
  )
}
