import type { UseInfiniteQueryResult } from '@tanstack/react-query'
import { Button } from '../ui/index.ts'

/**
 * The end of a list read a page at a time (#52): a button asking for the next page while there is
 * one, and nothing once the last is shown — so no list stops at its first page.
 */
export function ShowMore({
  query,
  title,
  testID,
}: {
  readonly query: Pick<
    UseInfiniteQueryResult,
    'hasNextPage' | 'isFetchingNextPage' | 'fetchNextPage'
  >
  readonly title: string
  readonly testID: string
}): React.JSX.Element | null {
  if (!query.hasNextPage) return null
  return (
    <Button
      title={title}
      variant="ghost"
      busy={query.isFetchingNextPage}
      onPress={() => {
        void query.fetchNextPage()
      }}
      testID={testID}
    />
  )
}
