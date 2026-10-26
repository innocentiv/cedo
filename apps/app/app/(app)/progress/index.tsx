import { useState } from 'react'
import { ReviewQuery } from '@cedo/contract'
import { Chips, Columns, Loaded, Screen, Stack } from '../../../src/ui/index.ts'
import { useReview } from '../../../src/api/queries.ts'
import { Attention, Consistency, Days, Muscles } from '../../../src/lib/progress-parts.tsx'

const PERIODS = [
  { value: '4', label: '4 weeks' },
  { value: '8', label: '8 weeks' },
  { value: '12', label: '12 weeks' },
] as const

/**
 * Progress (#28): your training reviewed — how consistently, what needs attention, which days, and
 * the work each muscle got against the period before. The same review an AI reads through
 * `training_review`, over HTTP. See docs/08-frontend.md, "Progress, and the tabs".
 */
export default function Progress(): React.JSX.Element {
  // The review's own default period, as the contract says it.
  const [weeks, setWeeks] = useState(String(ReviewQuery.parse({}).weeks))
  const review = useReview(Number(weeks))
  return (
    <Screen title="Progress" wide testID="progress-screen">
      <Chips options={PERIODS} value={weeks} onChange={setWeeks} testID="progress-weeks" />
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
