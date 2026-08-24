import { ErrorNotice, Spinner } from './feedback.tsx'

/**
 * The three states every remote read has: failed, not yet, here.
 *
 * Written once because the alternative — a nested ternary in each screen — was repeated in seven of
 * them, and each one was free to forget a state or render a different message for the same failure.
 * See docs/08-frontend.md.
 */
export interface QueryLike<T> {
  readonly data: T | undefined
  readonly isPending: boolean
  readonly error: Error | null
  readonly refetch: () => unknown
}

export interface LoadedProps<T> {
  readonly query: QueryLike<T>
  readonly children: (data: T) => React.ReactNode
  readonly testID?: string | undefined
}

export function Loaded<T>({ query, children, testID }: LoadedProps<T>): React.JSX.Element {
  if (query.error !== null) {
    return (
      <ErrorNotice
        message={query.error.message}
        onRetry={() => {
          query.refetch()
        }}
        testID={testID === undefined ? undefined : `${testID}-error`}
      />
    )
  }
  // `isPending` alone is not enough: a disabled query is neither pending nor resolved.
  if (query.isPending || query.data === undefined) {
    return <Spinner testID={testID === undefined ? undefined : `${testID}-loading`} />
  }
  return <>{children(query.data)}</>
}
