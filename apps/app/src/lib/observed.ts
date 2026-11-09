/**
 * A value React reads with `useSyncExternalStore`: the same object until it is set again, and every
 * listener told when it is. What the app's own state — the server it talks to, how a rest's end is
 * told — is held in, outside React, so its rules are unit-tested.
 */
export function observed<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next: T): void => {
      value = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
