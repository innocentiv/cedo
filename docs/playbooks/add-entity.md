# Playbook: add a shareable entity end to end

Follow this in order. It is derived from how `exercises` was actually built, including the mistakes
the code review caught — each step exists because skipping it produced a real defect.

Use it for anything users own and share: recipes, ingredients, meal plans, programme templates.
Substitute `widget` / `widgets` throughout.

## 0. Decide whether it is ownable

**Ownable** — users create it, share it, favourite it, duplicate it: recipes, meal plans, workouts.
Follow every step below.

**Not ownable** — reference data (`muscles`), immutable content (`media`), or personal records
(`workout_sessions`, which belong to a `user_id` directly and are never shared). Skip steps 2, 5
and 6.

If you are unsure, ask. Retrofitting ownership is a migration plus an ACL audit.

## 1. The contract comes first

`packages/contract/src/widget.ts`. Nothing else is written until this is.

```ts
const widgetFields = {
  name: NonEmptyString.max(120),
  servings: z.int().positive().max(100).default(1),
}
const WidgetFields = z.strictObject(widgetFields)

export const WidgetCreate = WidgetFields.superRefine((value, ctx) => checkInvariants(value, ctx))
export const WidgetUpdate = WidgetFields.partial().superRefine((value, ctx) => {
  // Only validate what is actually being set.
  if (value.servings !== undefined) checkInvariants(value, ctx)
})

export const Widget = z.object({
  id: Id,
  ...widgetFields,
  ownerGroupId: Id,
  createdBy: Id,
  canEdit: z.boolean(),
  isFavourite: z.boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
```

Then export it from `index.ts`.

Rules that are not negotiable:

- **Inputs are `z.strictObject`, outputs are `z.object`.** A strict input turns an AI's typo into a
  loud 422 instead of a nameless row.
- **Measurements come from `measurement.ts`.** Never re-declare a bound — they drifted once already,
  and an unbounded value overflows its `int4` column into a 500.
- **Closed sets are `z.enum`, never `z.string().refine()`.** MCP publishes input schemas as JSON
  Schema; that is how an AI discovers legal values.
- **Any set-like array needs a uniqueness refinement** if it maps to a composite primary key.
  `mediaIds` did not have one, and a repeated id was a duplicate-key 500.

Write `widget.test.ts` for the invariants now. It needs no database.

## 2. The table

`apps/api/src/db/tables/widget.ts`.

```ts
export const widgets = pgTable(
  'widgets',
  { ...ownable(), servings: smallint('servings').notNull().default(1) },
  (t) => [
    // Serves the list query in ONE index walk: visible() filters on owner_group_id, and the
    // keyset cursor both ranges and orders on (name, id).
    index('widgets_owner_name_idx').on(t.ownerGroupId, t.name, t.id),
  ],
)

export const widgetFavourites = favouriteTable('widget_favourites', widgets)
```

- **`...ownable()`** brings `id`, `owner_group_id`, `created_by`, `name`, and both timestamps —
  including the `$onUpdate` that makes `updated_at` actually move.
- **The composite index is not optional.** Ordering by `(name, id)` without it makes Postgres
  seq-scan and sort every visible row on every page. An index on `owner_group_id` alone is
  redundant — it is this one's left prefix.
- **Enums come from the contract**: `pgEnum('widget_kind', WIDGET_KINDS)`. Never retype values.
- Export from `db/schema.ts`, then:

```bash
cd apps/api && bunx drizzle-kit generate --name=add_widgets
bun run apps/api/src/db/migrate.ts
```

Commit the generated SQL. Never edit an applied migration.

## 3. The service

`apps/api/src/modules/widget/service.ts`. **All logic lives here** — it is the only thing MCP tools
may call.

```ts
// READ — always visible()
.where(and(visible(widgets, caller), eq(widgets.id, id)))

// WRITE — always editable(), on the STATEMENT ITSELF
const written = await tx.update(widgets)
  .set(patch)
  .where(and(editable(widgets, caller), eq(widgets.id, id)))
  .returning({ id: widgets.id })
if (written.length === 0) throw notFound('widget')
```

**A guard `SELECT` is not enough.** The write needs its own predicate: between the two statements a
concurrent transfer can move the row into a group the caller cannot edit. This was a real finding.

Not-found and not-permitted are **both** `notFound`. A 403 confirms the resource exists.

### If the entity has children, load them in a fixed number of queries

Nested data is where N+1 appears. Never query per row:

```ts
// ONE query for all children of all parents, then group in memory.
const childRows = await db.select().from(widgetParts).where(inArray(widgetParts.widgetId, ids))
```

See `modules/exercise/mapper.ts`. Split the module into `service` / `mapper` / `query` once it grows
past ~250 lines — the linter will tell you, and it is a real signal.

### Cursor pagination

Copy `modules/exercise/query.ts`: keyset on `(name, id)`, JSON-encoded, parsed with Zod because a
cursor is client input. Never `OFFSET` — it drifts under concurrent inserts.

Escape `%`, `_` and `\` in any search term before it reaches `ilike`, or user input acts as
wildcards and defeats the index.

## 4. The routes

`apps/api/src/modules/widget/index.ts`. Each handler is **at most five lines** and calls exactly one
service function.

```ts
export const widgetRoutes = new Elysia({ prefix: '/widgets', tags: ['widgets'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get('/', ({ caller, query }) => WidgetService.list(caller, query), {
    query: WidgetQuery,
    response: page(Widget),
  })
```

Mount it in `app.ts`. Never throw a value that is not a `DomainError` — everything leaves through the
single `onError`.

## 5. Favourites, duplicate, transfer

These come free from the trait; just expose them.

- `duplicate` copies the row and its children into a group the caller can **edit**, defaulting to
  their personal group. Immutable children (media) are *shared*, not copied.
- `transfer` requires editor rights on **both** sides.
- `setFavourite` checks **visibility**, not editability — you may pin what you can see.

## 6. Tests

`apps/api/src/modules/widget/widget.test.ts`. Mandatory coverage:

1. **Cross-user isolation.** One user cannot see, patch or delete another's. Assert that hidden and
   nonexistent return an **identical status and body**.
2. **`expectContract` on every response**, using `wire`, not `api`. Eden Treaty revives ISO dates
   into `Date`; the real client uses `fetch` + Zod and sees strings.
3. **Every route rejects an anonymous request with 401** — including one with a malformed body, to
   prove auth still runs before validation.
4. **An N+1 invariant test** (`n1.test.ts`): the same call must issue the *same* number of queries
   at 1 row and at 30.

Prove a regression test fails against the unfixed code before trusting it. For a race, measure how
often it reproduces and loop enough rounds that a false pass is unlikely.

## 7. The MCP tool

`apps/api/src/mcp/tools/widget.ts` — wraps the same service function, ≤5 lines. See
`docs/07-mcp.md`.

## 8. The client method and the screen

`apps/app/src/api/client.ts` gets one 2-line method naming its response schema. Then the screen —
which may call `api.*`, render UI primitives, hold form state, and call pure helpers from the
contract, and **nothing else**. See `docs/08-frontend.md`.

## 9. Documentation, in the same commit

- `docs/03-domain-model.md`: the tables, the invariants, **and the index plan table**.
- An ADR if you made a decision someone might otherwise reverse.
- `bun run check` — which includes the documentation link checker.

## The whole checklist

```
[ ] contract schemas + invariant tests
[ ] table with ...ownable() and the (owner_group_id, name, id) index
[ ] favouriteTable()
[ ] migration generated and committed
[ ] service: visible() on reads, editable() on the write statement itself
[ ] children loaded in a fixed number of queries
[ ] routes <=5 lines, mounted in app.ts
[ ] duplicate / transfer / favourite
[ ] tests: isolation, expectContract via wire, 401, N+1
[ ] MCP tool
[ ] client method + screen
[ ] docs/03 updated, ADR if needed
[ ] bun run check green
```
