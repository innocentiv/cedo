import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db/client.ts'
import {
  type FavouriteTable,
  type OwnableTable,
  assertEditorOf,
  editable,
} from '../../db/ownable.ts'
import { conflict, isForeignKeyRefusal, notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'

/**
 * The statements every ownable shares. A write file: it reaches the raw table it is handed, and
 * every statement on it carries `editable()`. See docs/adr/0019-visible-relations.md.
 */

/** What a transfer or a delete needs to know about the kind it is acting on. */
export interface OwnableWrites {
  readonly noun: string
  readonly table: OwnableTable
  /**
   * Runs after the caller is known to edit the row and before it moves — a kind's own rule about
   * what may travel. Its refusal is only ever heard by someone allowed to edit the row.
   */
  readonly beforeTransfer?: (caller: Caller, id: string, toGroupId: string) => Promise<void>
  /** Said when the database refuses a delete because something still references the row. */
  readonly inUse?: string
}

/**
 * Editor rights on BOTH sides: you can push something neither into a group, nor out of one, you
 * cannot edit. The order is load-bearing — the target, then the row, then the kind's own rule —
 * so a stranger gets 404 for the row before any rule can describe what it holds.
 */
export async function transferOwnable(
  kind: OwnableWrites,
  caller: Caller,
  id: string,
  toGroupId: string,
): Promise<void> {
  assertEditorOf(caller, toGroupId)

  const [own] = await db
    .select({ id: kind.table.id })
    .from(kind.table)
    .where(and(editable(kind.table, caller), eq(kind.table.id, id)))
    .limit(1)
  if (own === undefined) throw notFound(kind.noun)

  await kind.beforeTransfer?.(caller, id, toGroupId)

  // Children follow by the cascading owner key. See docs/03-domain-model.md.
  const moved = await db
    .update(kind.table)
    .set({ ownerGroupId: toGroupId, updatedAt: sql`now()` })
    .where(and(editable(kind.table, caller), eq(kind.table.id, id)))
    .returning({ id: kind.table.id })
  if (moved.length === 0) throw notFound(kind.noun)
}

/**
 * A reference that must block deletion is ON DELETE RESTRICT, so the database is the check — a count
 * beforehand would race a concurrent write — and its refusal is a 409, not a 500. The message names
 * nothing: what references the row may belong to people the caller cannot see.
 */
export async function deleteOwnable(
  kind: OwnableWrites,
  caller: Caller,
  id: string,
): Promise<void> {
  const deleted = await db
    .delete(kind.table)
    .where(and(editable(kind.table, caller), eq(kind.table.id, id)))
    .returning({ id: kind.table.id })
    .catch((error: unknown) => {
      if (isForeignKeyRefusal(error)) {
        throw conflict(kind.inUse ?? `That ${kind.noun} is still in use, so it cannot be deleted.`)
      }
      throw error
    })
  if (deleted.length === 0) throw notFound(kind.noun)
}

/** Pins or unpins. Whether the caller may see the row is checked first, by the caller of this. */
export async function writeFavourite(
  favourites: FavouriteTable,
  caller: Caller,
  id: string,
  favourite: boolean,
): Promise<void> {
  if (favourite) {
    await db
      .insert(favourites)
      .values({ userId: caller.userId, targetId: id })
      .onConflictDoNothing()
    return
  }
  await db
    .delete(favourites)
    .where(and(eq(favourites.userId, caller.userId), eq(favourites.targetId, id)))
}
