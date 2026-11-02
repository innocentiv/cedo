/**
 * A progression rule as it reads back from JSONB, where the type system never saw it written: a
 * range stored the wrong way round is tolerated, and an unknown kind is refused loudly. Shared by
 * progression.ts and progression-words.ts; like clears.ts, not part of the contract's surface.
 */

/** A double rule's rep range, tolerated stored the wrong way round rather than read as nonsense. */
export function normaliseRange(range: readonly [number, number]): [number, number] {
  const [a, b] = range
  return a <= b ? [a, b] : [b, a]
}

/**
 * Guards a union that arrives from outside the type system — `progression` is stored as JSONB, so
 * an unknown kind really is reachable if a row is edited by hand or written by an older version.
 * Every switch over a rule's kind ends in it.
 */
export function unhandledKind(value: never): never {
  throw new Error(`Unhandled progression kind: ${JSON.stringify(value)}`)
}
