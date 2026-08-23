import { inArray } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { groups, users } from './tables/identity.ts'

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
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Structural type satisfied by any table built with `ownable()`. */
export type OwnableTable = PgTable & {
  readonly id: PgColumn
  readonly ownerGroupId: PgColumn
  readonly createdBy: PgColumn
  readonly name: PgColumn
  readonly updatedAt: PgColumn
}

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
 * READ predicate. **Every** select against an ownable table must include this.
 * Omitting it is a data leak between users, not a style issue. See docs/02-conventions.md.
 */
export const visible = (table: OwnableTable, ctx: AccessContext) =>
  inArray(table.ownerGroupId, [...ctx.groupIds])

/** WRITE predicate. Every update and delete against an ownable table must include this. */
export const editable = (table: OwnableTable, ctx: AccessContext) =>
  inArray(table.ownerGroupId, [...ctx.editorGroupIds])

/**
 * Favourites are per entity kind so each keeps a real foreign key, and the rows disappear with
 * their target rather than becoming orphans. Defined once; called per ownable table.
 */
export const favouriteTable = (name: string, target: OwnableTable) =>
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
