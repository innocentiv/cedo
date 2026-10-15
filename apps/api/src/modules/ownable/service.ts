import { type SQL, type Subquery, and, asc, eq, gt, ilike, isNotNull, or } from 'drizzle-orm'
import { type AnyPgColumn, type SelectedFieldsFlat, alias } from 'drizzle-orm/pg-core'
import type { OwnableQuery } from '@cedo/contract'
import { db } from '../../db/client.ts'
import type { FavouriteTable } from '../../db/ownable.ts'
import { invalid, notFound, unreachable } from '../../lib/error.ts'
import { decodeCursor, encodeCursor, escapeLikePattern } from '../../lib/keyset.ts'
import type { Caller } from '../../plugins/auth.ts'
import { type OwnableWrites, deleteOwnable, transferOwnable, writeFavourite } from './write.ts'

/**
 * The lifecycle every ownable shares — list, get, favourite, transfer, delete — written once and
 * configured per kind in that kind's `lifecycle.ts`. A kind's own behaviour (its children, its
 * create and update, its rules about what may travel) stays in its module; what is here is what
 * every kind must do identically, and `ownable.test.ts` runs against each of them.
 * See docs/adr/0003-ownable-columns.md and docs/adr/0019-visible-relations.md.
 */

type TextColumn = AnyPgColumn<{ data: string; notNull: true }>

/**
 * A kind's visible relation, with the columns this module reads by name handed over explicitly.
 * Everything else about the row is `row`, which comes back typed as the kind's own row.
 */
export interface OwnableView<TFields extends SelectedFieldsFlat> {
  readonly from: Subquery
  readonly row: TFields
  readonly id: TextColumn
  readonly name: TextColumn
  readonly ownerGroupId: TextColumn
}

export interface OwnableKind<
  TFields extends SelectedFieldsFlat,
  TQuery extends OwnableQuery,
> extends OwnableWrites {
  readonly view: (caller: Caller) => OwnableView<TFields>
  readonly favourites: FavouriteTable
  /** A kind's own list filters, on top of scope, search and the cursor. */
  readonly listConditions?: (
    caller: Caller,
    query: TQuery,
    view: OwnableView<TFields>,
  ) => (SQL | undefined)[]
}

/** Narrows the visible relation; visibility itself is the relation, never a condition here. */
function scopeOf(
  query: OwnableQuery,
  caller: Caller,
  view: OwnableView<SelectedFieldsFlat>,
): SQL[] {
  switch (query.scope) {
    case 'mine':
      return [eq(view.ownerGroupId, caller.personalGroupId)]
    case 'group':
      /**
       * Thrown, not defaulted. `?? ''` fed an empty string to a uuid column, which Postgres rejects
       * at cast time — a 500 for a programmer error. The HTTP route is protected by the query's
       * refine, but MCP tools call the service directly, and `{ scope: 'group' }` typechecks.
       *
       * A group the caller cannot reach yields an empty page rather than an error that would
       * confirm it exists — the relation holds none of its rows.
       */
      if (query.groupId === undefined) throw invalid("groupId is required when scope is 'group'")
      return [eq(view.ownerGroupId, query.groupId)]
    case 'all':
    case 'favourites':
      return []
    default:
      return unreachable(query.scope)
  }
}

/**
 * The kind's rows with the caller's own favourite flag. The join is ALIASED: a favourites table
 * typed with a plain `string` name makes Drizzle's nullability map for the join collapse every
 * selected field to `never`. A literal alias keeps `row` typed; `ownable.test.ts` pins that.
 */
function withFavourite<TFields extends SelectedFieldsFlat, TQuery extends OwnableQuery>(
  kind: OwnableKind<TFields, TQuery>,
  caller: Caller,
) {
  const view = kind.view(caller)
  const favourite = alias(kind.favourites, 'favourite')
  const rows = db
    .select({
      row: view.row,
      favourite: favourite.targetId,
      // Re-selected by name: inside this module `row` is opaque, and the cursor needs both.
      keyName: view.name,
      keyId: view.id,
    })
    .from(view.from)
    .leftJoin(favourite, and(eq(favourite.targetId, view.id), eq(favourite.userId, caller.userId)))
  return { view, favourite, rows }
}

/** One page, by keyset on (name, id): one row beyond the limit answers "is there more?". */
async function listPage<TFields extends SelectedFieldsFlat, TQuery extends OwnableQuery>(
  kind: OwnableKind<TFields, TQuery>,
  caller: Caller,
  query: TQuery,
) {
  const { view, favourite, rows: select } = withFavourite(kind, caller)
  const after = decodeCursor(query.cursor)

  const conditions: (SQL | undefined)[] = [
    ...scopeOf(query, caller, view),
    query.scope === 'favourites' ? isNotNull(favourite.targetId) : undefined,
    query.q === undefined || query.q === ''
      ? undefined
      : ilike(view.name, `%${escapeLikePattern(query.q)}%`),
    after === null
      ? undefined
      : or(gt(view.name, after.name), and(eq(view.name, after.name), gt(view.id, after.id))),
    ...(kind.listConditions?.(caller, query, view) ?? []),
  ]

  const rows = await select
    .where(and(...conditions))
    .orderBy(asc(view.name), asc(view.id))
    .limit(query.limit + 1)

  const items = rows.slice(0, query.limit)
  const last = items.at(-1)
  return {
    items: items.map((r) => ({ row: r.row, isFavourite: r.favourite !== null })),
    nextCursor:
      rows.length > query.limit && last !== undefined
        ? encodeCursor(last.keyName, last.keyId)
        : null,
  }
}

/** Not-found and not-permitted are the same 404: a 403 would confirm the row exists. */
async function getOne<TFields extends SelectedFieldsFlat, TQuery extends OwnableQuery>(
  kind: OwnableKind<TFields, TQuery>,
  caller: Caller,
  id: string,
) {
  const { view, rows } = withFavourite(kind, caller)
  const [found] = await rows.where(eq(view.id, id)).limit(1)
  if (found === undefined) throw notFound(kind.noun)
  return { row: found.row, isFavourite: found.favourite !== null }
}

/** Visibility, not editability — you may pin anything you can see. */
async function pin<TFields extends SelectedFieldsFlat, TQuery extends OwnableQuery>(
  kind: OwnableKind<TFields, TQuery>,
  caller: Caller,
  id: string,
  favourite: boolean,
): Promise<void> {
  const view = kind.view(caller)
  const [found] = await db.select({ id: view.id }).from(view.from).where(eq(view.id, id)).limit(1)
  if (found === undefined) throw notFound(kind.noun)
  await writeFavourite(kind.favourites, caller, id, favourite)
}

/** One kind's lifecycle. `list` and `get` return `{ row, isFavourite }`, `row` typed as the kind's. */
export function ownableLifecycle<TFields extends SelectedFieldsFlat, TQuery extends OwnableQuery>(
  kind: OwnableKind<TFields, TQuery>,
) {
  return {
    list: async (caller: Caller, query: TQuery) => await listPage(kind, caller, query),
    get: async (caller: Caller, id: string) => await getOne(kind, caller, id),
    setFavourite: async (caller: Caller, id: string, favourite: boolean) => {
      await pin(kind, caller, id, favourite)
    },
    transfer: async (caller: Caller, id: string, toGroupId: string) => {
      await transferOwnable(kind, caller, id, toGroupId)
    },
    remove: async (caller: Caller, id: string) => {
      await deleteOwnable(kind, caller, id)
    },
  }
}

/** The six fields on every ownable response. `canEdit` is the access rule, written once. */
export function ownableFieldsOf(
  row: {
    readonly ownerGroupId: string
    readonly createdBy: string
    readonly createdAt: Date
    readonly updatedAt: Date
  },
  isFavourite: boolean,
  caller: Caller,
) {
  return {
    ownerGroupId: row.ownerGroupId,
    createdBy: row.createdBy,
    canEdit: caller.editorGroupIds.includes(row.ownerGroupId),
    isFavourite,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
