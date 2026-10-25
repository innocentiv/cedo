import { useState } from 'react'
import { useRouter } from 'expo-router'
import { type SessionStart, startOfWeek } from '@cedo/contract'
import { Columns, FormError, Loaded, Screen } from '../../../src/ui/index.ts'
import { useSessions, useStartSession, useToday } from '../../../src/api/queries.ts'
import { History, Now } from '../../../src/lib/today-parts.tsx'
import { useSubmit } from '../../../src/lib/use-submit.ts'

/**
 * Today (#25): what to do next — the session in progress, or the next day of the current workout
 * and Start — the week, and history by week. Two reads, each answered on its own, so a history that
 * fails does not hide the session to resume. See docs/08-frontend.md, "Today".
 */
export default function Today(): React.JSX.Element {
  const router = useRouter()
  // The reader's own week: the server cannot know where it starts.
  const [weekStart] = useState(() => startOfWeek(new Date()).toISOString())
  const today = useToday(weekStart)
  const sessions = useSessions({ inProgress: false, limit: 20 })
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
          <Loaded query={sessions} testID="today">
            {(data) => <History sessions={data.items} />}
          </Loaded>
        }
      />
    </Screen>
  )
}
