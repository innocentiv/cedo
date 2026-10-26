import { useState } from 'react'
import { Columns, Loaded, Screen, Stack } from '../../../src/ui/index.ts'
import { useReview } from '../../../src/api/queries.ts'
import {
  Attention,
  Consistency,
  Days,
  FIRST_PERIOD,
  Muscles,
  Period,
} from '../../../src/lib/progress-parts.tsx'

/**
 * Progress (#28): your training reviewed — how consistently, what needs attention, which days, and
 * the work each muscle got against the period before. The same review an AI reads through
 * `training_review`, over HTTP. See docs/08-frontend.md, "Progress, and the tabs".
 */
export default function Progress(): React.JSX.Element {
  const [weeks, setWeeks] = useState(FIRST_PERIOD)
  const review = useReview(Number(weeks))
  return (
    <Screen title="Progress" wide testID="progress-screen">
      <Period value={weeks} onChange={setWeeks} />
      <Loaded query={review} testID="progress">
        {(data) => (
          <Columns
            main={
              <>
                <Consistency review={data} />
                <Attention review={data} />
              </>
            }
            side={
              <Stack gap="xxl">
                <Days review={data} />
                <Muscles review={data} />
              </Stack>
            }
          />
        )}
      </Loaded>
    </Screen>
  )
}
