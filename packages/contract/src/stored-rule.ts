/**
 * A progression rule as it reads back from JSONB, where the type system never saw it written: an
 * unknown kind is refused loudly. A range stored the wrong way round is no longer tolerated — the
 * plan save refuses one, and migration 0018 turned any stored one Manual (ADR-0026). Shared by
 * progression.ts and progression-words.ts; like clears.ts, not part of the contract's surface.
 */

/**
 * Guards a union that arrives from outside the type system — `progression` is stored as JSONB, so
 * an unknown kind really is reachable if a row is edited by hand or written by an older version.
 * Every switch over a rule's kind ends in it.
 */
export function unhandledKind(value: never): never {
  throw new Error(`Unhandled progression kind: ${JSON.stringify(value)}`)
}
