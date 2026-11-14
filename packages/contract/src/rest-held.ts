import type { RestChange } from './rest.ts'

/**
 * What this phone holds of the rests after a session's sets (#63), and how what happens here changes
 * it (`restHeldAfter`). The screen holds it; `justLogged` reads it. Every device counts the rest the
 * server keeps (#38): this is only what this one did to a rest, and saw of it.
 *
 * A rest is named by how many sets it follows (`RestAfter`), never by its set's id or time: a set
 * logged without a signal changes both when the server has it, and is the same rest.
 */
export interface RestHeld {
  /** The +30 s taps made here last, and the rest they were made on. */
  readonly extended: { readonly after: number; readonly times: number } | null
  /** The rest skipped here last. */
  readonly skipped: number | null
  /** The rest seen running here: the one whose end chimes (`chimesAtEnd`). */
  readonly seen: number | null
}

export const NO_REST_HELD: RestHeld = { extended: null, skipped: null, seen: null }

/** What happens to a rest on this phone. */
export type RestEvent =
  /** +30 s — a tap on the countdown — or Skip, on the rest after `after` sets. */
  | { readonly kind: 'tapped'; readonly change: RestChange['change']; readonly after: number }
  /** The screen showed the rest after `after` sets — or, null, none — running or not. */
  | { readonly kind: 'seen'; readonly after: number | null; readonly running: boolean }

/** How many times the rest after `after` sets was extended here. */
export const extensionsOf = (held: RestHeld, after: number): number =>
  held.extended?.after === after ? held.extended.times : 0

/**
 * What the phone holds, after what happened here — the one rule of it:
 *
 * - **Tapped**: +30 s counts on with the taps already made on that rest, and Skip marks it. Each is
 *   remembered with the rest it was tapped on, and read by that rest alone: the next set's starts
 *   with neither, and a rest the session goes back to — the set after it removed — is as it was
 *   left. So is the rest of a set undone and logged again, which follows as many sets as it did.
 * - **Seen** running: remembered, so its end chimes; seen not running — over, skipped, undone, none
 *   after the set — forgotten: a rest opened already over, or one an undo went back to, is silent.
 *
 * Nothing changed gives back what was held, itself: the screen draws again only when it must.
 */
export function restHeldAfter(held: RestHeld, event: RestEvent): RestHeld {
  if (event.kind === 'seen') {
    const seen = event.running ? event.after : null
    return seen === held.seen ? held : { ...held, seen }
  }
  const { after } = event
  return event.change === 'skip'
    ? { ...held, skipped: after }
    : { ...held, extended: { after, times: extensionsOf(held, after) + 1 } }
}
