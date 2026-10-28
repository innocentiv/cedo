import { useState } from 'react'
import { Screen } from '../../../src/ui/index.ts'
import { useReview } from '../../../src/api/queries.ts'
import { Notes } from '../../../src/lib/athlete-notes.tsx'
import { FIRST_PERIOD, Period, Review } from '../../../src/lib/progress-parts.tsx'

/**
 * Progress (#28): your training reviewed — how consistently, what needs attention, which days, and
 * the work each muscle got against the period before. The same review an AI reads through
 * `training_review`, over HTTP — and what is known about you, kept for planning it (#41). See
 * docs/08-frontend.md, "Progress, and the tabs".
 */
export default function Progress(): React.JSX.Element {
  const [weeks, setWeeks] = useState(FIRST_PERIOD)
  return (
    <Screen title="Progress" wide testID="progress-screen">
      <Period weeks={weeks} onChange={setWeeks} />
      <Review query={useReview(weeks)} testID="progress" />
      <Notes testID="progress-notes" />
    </Screen>
  )
}
