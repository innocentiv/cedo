/**
 * What this phone holds of the rest after a set (#63), and how what happens here changes it
 * (`restHeldAfter`). The screen holds it; `justLogged` reads it. Every device counts the rest the
 * server keeps (#38): this is only what this one did to it, and saw of it.
 */

/** A rest, by how many sets it follows (`RestAfter`), and what this phone did to it and saw of it. */
export interface RestHeld {
  readonly after: number
  /** The +30 s taps made here: each is told to the server too, and counted once (`restCounted`). */
  readonly extensions: number
  readonly skipped: boolean
  /** Seen running here: the rest whose end chimes (`chimesAtEnd`). */
  readonly seen: boolean
}

/** What happens to a rest on this phone. */
export type RestEvent =
  /** A tap on the countdown: +30 s on the rest after `after` sets. */
  | { readonly kind: 'extended'; readonly after: number }
  | { readonly kind: 'skipped'; readonly after: number }
  /** The screen showed the rest after `after` sets — or, null, none — running or not. */
  | { readonly kind: 'seen'; readonly after: number | null; readonly running: boolean }

/** What is held of the rest after `after` sets: what was held of it, or nothing yet. */
const of = (held: RestHeld | null, after: number): RestHeld =>
  held?.after === after ? held : { after, extensions: 0, skipped: false, seen: false }

/**
 * What the phone holds of a rest, after what happened here — the one rule of it:
 *
 * - **Extended**, **skipped**: held for the rest it was tapped on, until the next set starts
 *   another. By how many sets the rest follows, never by the set's id or time: a set logged without
 *   a signal changes both when the server has it, and is the same rest (#38).
 * - **Seen** running: remembered, so its end chimes; seen not running — over, skipped, undone, none
 *   after the set — forgotten: a rest opened already over, or one an undo went back to, is silent.
 *
 * Nothing changed gives back what was held, itself: the screen draws again only when it must.
 */
export function restHeldAfter(held: RestHeld | null, event: RestEvent): RestHeld | null {
  if (event.kind === 'seen') {
    if (!event.running || event.after === null) {
      return held === null || !held.seen ? held : { ...held, seen: false }
    }
    const rest = of(held, event.after)
    return rest.seen ? rest : { ...rest, seen: true }
  }
  const rest = of(held, event.after)
  return event.kind === 'skipped'
    ? { ...rest, skipped: true }
    : { ...rest, extensions: rest.extensions + 1 }
}
