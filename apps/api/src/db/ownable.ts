import { inArray, sql } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { foreignKey, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { groups, users } from './tables/identity.ts'
import { notFound } from '../lib/error.ts'

/**
 * The ownable trait. Every shareable entity spreads these columns, and the ACL/transfer/duplicate
 * logic below is written against them ONCE — so adding recipes or meal plans later inherits
 * sharing, favourites, duplication and ownership transfer with no new access-control code.
 *
 * Columns are physically repeated per table (no supertable), so a create is one INSERT and a read
 * needs no join. See docs/03-domain-model.md.
 */
export const ownable = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  /**
   * Everything belongs to a group. A user's own things live in their personal group, so there is
   * exactly one owner type and therefore exactly one ACL code path.
   */
  ownerGroupId: uuid('owner_group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'restrict' }),
  /** Provenance only. Never consulted for permissions — the owning group decides those. */
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /**
   * Two decisions, both load-bearing.
   *
   * `$onUpdate` belongs HERE, not in each service's `.set(patch)`. Without it `updated_at` freezes
   * at creation for every ownable entity — including the recipes and meal plans this trait is meant
   * to carry — and any future "changed since" or sync query silently misses every edit.
   *
   * And `sql\`now()\``, NOT `new Date()`. `created_at` comes from the DATABASE clock, so taking
   * `updated_at` from the application clock compares two different clocks. With the API and
   * Postgres in separate containers, a few milliseconds of skew is enough to write
   * `updated_at < created_at` — nonsense, and it quietly breaks any "changed since" query. The skew
   * measured here was 3ms, backwards.
   */
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`),
})

/** Structural type satisfied by any table built with `ownable()`. */
export type OwnableTable = PgTable & {
  readonly id: PgColumn
  readonly ownerGroupId: PgColumn
  readonly createdBy: PgColumn
  readonly name: PgColumn
  readonly updatedAt: PgColumn
}

/** Anything whose rows belong to a group: an ownable table, or a child carrying its owner. */
export type OwnedTable = PgTable & { readonly ownerGroupId: PgColumn }

/**
 * The owner a CHILD of an ownable table carries — a workout's days, entries and sets, an exercise's
 * muscles and media — so that `visible()` and `editable()` apply to it directly.
 *
 * Without it a child had no visibility of its own and inherited its parent's by being joined
 * through it, which every reader had to remember: five reads trusted a child because some earlier
 * statement had checked the parent. The column is never written independently. `ownerKey` binds
 * it to the parent's with a cascading foreign key, so a transfer is still one UPDATE on the parent
 * and Postgres carries the new owner down. See docs/adr/0019-visible-relations.md.
 */
export const childOwner = () => ({ ownerGroupId: uuid('owner_group_id').notNull() })

/** What a child's `ownerKey` points at: the parent's `(id, owner_group_id)`, which must be unique. */
export const ownerTarget = (name: string, table: { id: PgColumn; ownerGroupId: PgColumn }) =>
  unique(name).on(table.id, table.ownerGroupId)

/**
 * The child's parent reference AND its owner, as one composite foreign key. Replaces the plain
 * `parent_id` reference: delete still cascades, and an owner change on the parent cascades too.
 */
export const ownerKey = (
  name: string,
  child: readonly [PgColumn, PgColumn],
  parent: { id: PgColumn; ownerGroupId: PgColumn },
) =>
  foreignKey({
    name,
    columns: [child[0], child[1]],
    foreignColumns: [parent.id, parent.ownerGroupId],
  })
    .onDelete('cascade')
    .onUpdate('cascade')

/**
 * Who is asking. Resolved once per request by the auth macro, in a single query.
 * See docs/06-api.md.
 */
export interface AccessContext {
  readonly userId: string
  /** Every group the user belongs to, in any role. */
  readonly groupIds: readonly string[]
  /** The subset they may write to. */
  readonly editorGroupIds: readonly string[]
}

/**
 * READ predicate, applied in ONE place: the visible relations in `visible.ts` are built from it,
 * and module code reads through them rather than calling this. See
 * docs/adr/0019-visible-relations.md.
 */
export const visible = (table: OwnedTable, ctx: AccessContext) =>
  inArray(table.ownerGroupId, [...ctx.groupIds])

/** An owned row as a write needs it: its id, and the owner its children must carry. */
export interface OwnedRow {
  readonly id: string
  readonly ownerGroupId: string
}

/** A write INTO a group needs editor rights there. Not-an-editor and no-such-group answer alike. */
export function assertEditorOf(ctx: AccessContext, groupId: string): void {
  if (!ctx.editorGroupIds.includes(groupId)) throw notFound('group')
}

/** WRITE predicate. Every update and delete against an ownable table must include this. */
export const editable = (table: OwnedTable, ctx: AccessContext) =>
  inArray(table.ownerGroupId, [...ctx.editorGroupIds])

/** Any kind's favourites table, as the shared ownable lifecycle takes it. */
export type FavouriteTable = ReturnType<typeof favouriteTable<string>>

/**
 * Favourites are per entity kind so each keeps a real foreign key, and the rows disappear with
 * their target rather than becoming orphans. Defined once; called per ownable table.
 */
export const favouriteTable = <TName extends string>(name: TName, target: OwnableTable) =>
  pgTable(
    name,
    {
      userId: uuid('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
      targetId: uuid('target_id')
        .notNull()
        .references((): PgColumn => target.id, { onDelete: 'cascade' }),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [primaryKey({ columns: [t.userId, t.targetId] })],
  )
