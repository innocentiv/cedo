import { useCallback, useState } from 'react'
import { ApiError } from '../api/http.ts'

/**
 * Form submission, once, for every form in the app: a busy flag, a message, and per-field errors
 * taken from the contract's own `details` array.
 *
 * This is the one piece of shared screen mechanics. Without it every form re-implements the same
 * try/catch and they drift — one showing a raw stack, another swallowing the message entirely.
 * See docs/08-frontend.md.
 */
export interface Submission {
  readonly busy: boolean
  readonly error: string | null
  /** The message for one field, or undefined. Feeds straight into `<Field error={…}>`. */
  readonly fieldError: (path: string) => string | undefined
  readonly submit: (action: () => Promise<void>) => Promise<void>
  readonly reset: () => void
}

export function useSubmit(): Submission {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<ReadonlyMap<string, string>>(new Map())

  const reset = useCallback(() => {
    setError(null)
    setFields(new Map())
  }, [])

  const submit = useCallback(async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    setFields(new Map())
    try {
      await action()
    } catch (thrown) {
      if (thrown instanceof ApiError) {
        setError(thrown.message)
        setFields(new Map((thrown.details ?? []).map((d) => [d.path, d.message])))
      } else {
        /**
         * Not an ApiError: a ContractDriftError, or the network being down. Re-thrown into the
         * console so the WebView harness fails the run — a form that quietly says "Something
         * went wrong" would hide exactly the drift the client exists to catch.
         */
        console.error(thrown)
        setError(thrown instanceof Error ? thrown.message : 'The request failed.')
      }
    } finally {
      setBusy(false)
    }
  }, [])

  return {
    busy,
    error,
    fieldError: (path) => fields.get(path),
    submit,
    reset,
  }
}
