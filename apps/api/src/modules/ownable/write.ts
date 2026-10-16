import { and, eq, getTableName, sql } from 'drizzle-orm'
import { db } from '../../db/client.ts'
import {
  type FavouriteTable,
  type OwnableTable,
  assertEditorOf,
  editable,
} from '../../db/ownable.ts'
import { exerciseFavourites, exercises, workoutFavourites, workouts } from '../../db/schema.ts'
import { conflict, isForeignKeyRefusal, notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'

/**
 * The statements every ownable shares. A write file: it holds the raw tables of every kind, and
 * every statement on them carries `editable()`. See docs/adr/0019-visible-relations.md.
 */

export const OWNABLE_KINDS = ['exercise', 'workout'] as const
export type OwnableKindName = (typeof OWNABLE_KINDS)[number]

/**
 * Each kind's raw tables, held HERE rather than handed in by the kind. A kind's `lifecycle.ts`
 * names itself and never imports a raw table, so the only module files that can reach one are
 * write files — which gate every statement. Adding a kind adds a line here; the shared suite's
 * completeness test fails until it does.
 */
const OWNABLE_TABLES: Readonly<
  Record<OwnableKindName, { readonly table: OwnableTable; readonly favourites: FavouriteTable }>
> = {
  exercise: { table: exercises, favourites: exerciseFavourites },
  workout: { table: workouts, favourites: workoutFavourites },
}

/** A kind's favourites table. Favourites are personal rows, not owned ones, so reads may join it. */
export const favouritesOf = (noun: OwnableKindName): FavouriteTable =>
  OWNABLE_TABLES[noun].favourites

/** The SQL names of the registered ownable tables, for the completeness test. */
export const ownableTableNames = (): string[] =>
  OWNABLE_KINDS.map((noun) => getTableName(OWNABLE_TABLES[noun].table))

/** What a transfer or a delete needs to know about the kind it is acting on. */
export interface OwnableWrites {
  readonly noun: OwnableKindName
  /**
   * Runs after the caller is known to edit the row and before it moves — a kind's own rule about
   * what may travel. Its refusal is only ever heard by someone allowed to edit the row.
   */
  readonly beforeTransfer?: (caller: Caller, id: string, toGroupId: string) => Promise<void>
  /**
   * For a kind something else may reference ON DELETE RESTRICT: what to say when the database
   * refuses its delete. A kind with no such reference declares none, and a refusal stays a 500.
   */
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
  const { table } = OWNABLE_TABLES[kind.noun]
  assertEditorOf(caller, toGroupId)

  const [own] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(editable(table, caller), eq(table.id, id)))
    .limit(1)
  if (own === undefined) throw notFound(kind.noun)

  await kind.beforeTransfer?.(caller, id, toGroupId)

  // Children follow by the cascading owner key. See docs/03-domain-model.md.
  const moved = await db
    .update(table)
    .set({ ownerGroupId: toGroupId, updatedAt: sql`now()` })
    .where(and(editable(table, caller), eq(table.id, id)))
    .returning({ id: table.id })
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
  const { table } = OWNABLE_TABLES[kind.noun]
  const deleted = await db
    .delete(table)
    .where(and(editable(table, caller), eq(table.id, id)))
    .returning({ id: table.id })
    .catch((error: unknown) => {
      if (kind.inUse !== undefined && isForeignKeyRefusal(error)) throw conflict(kind.inUse)
      throw error
    })
  if (deleted.length === 0) throw notFound(kind.noun)
}

/** Pins or unpins. Whether the caller may see the row is checked first, by the caller of this. */
export async function writeFavourite(
  noun: OwnableKindName,
  caller: Caller,
  id: string,
  favourite: boolean,
): Promise<void> {
  const favourites = favouritesOf(noun)
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
