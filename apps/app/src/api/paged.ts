import type { Page } from '@cedo/contract'

/**
 * A list read a page at a time (#25, #52): the next asked for only when shown more, so no list is
 * cut off at its first page. `list` is given the cursor of the page to read. The options for
 * `useInfiniteQuery`, written once for every paged list.
 */
export const paged = <T>(
  queryKey: readonly unknown[],
  list: (cursor: string | undefined) => Promise<Page<T>>,
) => ({
  queryKey,
  queryFn: async ({ pageParam }: { pageParam: string | undefined }) => await list(pageParam),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (last: Page<T>) => last.nextCursor ?? undefined,
})
