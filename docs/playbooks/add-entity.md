# Playbook: add a shareable entity end to end

Follow this in order. It is derived from how `exercises` was actually built, including the mistakes
the code review caught — each step exists because skipping it produced a real defect.

Use it for anything users own and share: recipes, ingredients, meal plans, programme templates.
Substitute `widget` / `widgets` throughout.

## 0. Decide whether it is ownable

**Ownable** — users create it, share it, favourite it, duplicate it: recipes, meal plans, workouts.
Follow every step below.

**Not ownable** — reference data (`muscles`), immutable content (`media`), or personal records
(`workout_sessions`, which belong to a `user_id` directly and are never shared). Still do every step,
except: build the table in step 2 **without** `...ownable()`, skip step 5 entirely, and in step 6
replace the cross-group test with the isolation that fits — per user for a personal record, as
`workout_sessions` does with `ownedBy(caller)`.

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
// patchOf, NEVER .partial(): Zod applies .default() inside .partial(), so an omitted `servings`
// would arrive as 1 and the service would reset it. See patchOf in primitives.ts.
export const WidgetUpdate = z.strictObject(patchOf(widgetFields)).superRefine((value, ctx) => {
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
- **A child table carries its owner.** Give the parent `ownerTarget('widgets_id_owner_uq', t)`, then
  spread `...childOwner()` into each child and bind it with
  `ownerKey('widget_parts_widget_fk', [t.widgetId, t.ownerGroupId], widgets)` instead of a plain
  `.references()`. A transfer then cascades the owner down, and the child has a visibility of its
  own. See `docs/03-domain-model.md`.
- **Add a visible relation per table** to `apps/api/src/db/visible.ts` — `visibleWidgets`,
  `visibleWidgetParts` — and add the tables to the `importNames` of `no-restricted-imports` in
  `.oxlintrc.typeaware.json` and to `OWNED` in `apps/api/src/db/raw-sql.test.ts`. Until then nothing
  stops a read from going around them.
- Export from `db/schema.ts`, then:

```bash
cd apps/api && bunx drizzle-kit generate --name=add_widgets
bun run apps/api/src/db/migrate.ts
```

Commit the generated SQL. Never edit an applied migration.

## 3. The service

`apps/api/src/modules/widget/service.ts`. **All logic lives here** — it is the only thing MCP tools
may call. It builds on the shared ownable lifecycle (step 5) for list, get, favourite, transfer and
delete, and adds what is the widget's own. Its own reads go through the visible relations; its own
writes — create, update, children — go in `modules/widget/write.ts`.

```ts
// READ — service.ts, through the relation. LEFT JOIN one to null a name; INNER JOIN to drop the row.
const widgets = visibleWidgets(caller)
const [row] = await db.select().from(widgets).where(eq(widgets.id, id)).limit(1)

// WRITE — write.ts, editable() on the STATEMENT ITSELF
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

See `modules/exercise/mapper.ts`. Split the module into `service` / `mapper` once it grows past ~250
lines — the linter will tell you, and it is a real signal.

### Cursor pagination

An ownable's list gets it from the shared lifecycle: keyset on `(name, id)`, scope, and search
escaped with `escapeLikePattern`, so `%`, `_` and `\` in user input never act as wildcards. Its own
filters go in `listConditions`, as the exercise muscle filter does. Never `OFFSET` — it drifts under
concurrent inserts.

A keyset on a timestamp must keep the column's full microsecond precision in the cursor — see
`modules/session/cursor.ts` for why a JS `Date` cannot carry it.

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

## 5. The lifecycle: list, get, favourites, transfer, delete

First register its tables in `OWNABLE_TABLES` in `apps/api/src/modules/ownable/write.ts` — add
`'widget'` to `OWNABLE_KINDS` and `widget: { table: widgets, favourites: widgetFavourites }`. That
write file holds every kind's raw tables, so nothing else in the module needs one. Then declare the
widget in `apps/api/src/modules/widget/lifecycle.ts`:

```ts
export const widgetLifecycle = ownableLifecycle({
  noun: 'widget',
  relation: (caller) => relationOf(visibleWidgets(caller)),
  // Optional: listConditions (its own filters), beforeTransfer (its own rule), inUse (409 text).
})
```

The service then calls `widgetLifecycle.list/get/setFavourite/transfer/remove` and maps
`{ row, isFavourite }` to the contract, taking the six shared fields from `ownableFieldsOf`. Scope,
search escaping, keyset paging, the favourite visibility check, editor rights on **both** sides of
a transfer and the 404 for hidden rows all come with it — see `modules/ownable/service.ts`. The
contract side is the same: build the list query with `withGroupRule(OwnableQueryFields.extend(…))`
and spread `ownableFields` into the response.

`duplicate` is the widget's own — it copies children — and copies into a group the caller can
**edit**, defaulting to their personal group (`assertEditorOf`). Immutable children (media) are
*shared*, not copied.

## 6. Tests

`apps/api/src/modules/widget/widget.test.ts`. Mandatory coverage:

1. **Cross-user isolation.** One user cannot see, patch or delete another's, and hidden and
   nonexistent return an **identical status and body**. For an ownable, add the widget to `KINDS` in
   `modules/ownable/ownable.test.ts` — the suite proves this, and fails until you do; test here only
   what is the widget's own.
2. **`expectContract` on every response**, using `wire`, not `api`. Eden Treaty revives ISO dates
   into `Date`; the real client uses `fetch` + Zod and sees strings.
3. **Every route rejects an anonymous request with 401** — including one with a malformed body, to
   prove auth still runs before validation.
4. **An N+1 invariant test** (`n1.test.ts`): the same call must issue the *same* number of queries
   at 1 row and at 30.

Prove a regression test fails against the unfixed code before trusting it. For a race, measure how
often it reproduces and loop enough rounds that a false pass is unlikely.

## 7. The MCP tool

Add it to the existing tool file whose task it serves — `apps/api/src/mcp/tools/library.ts`,
`equipment.ts`, `training.ts`, `session.ts`, `coaching.ts` or `diagnostics.ts` — wrapping the same service function, ≤5 lines. A genuinely new
area gets a new file, and its `register…Tools(server, caller)` must be called from
`apps/api/src/mcp/tools/index.ts`, or the tools never load. See `docs/playbooks/add-mcp-tool.md`.

## 8. The client, the hooks, and the screen

Three small steps, in order. Skipping the middle one is how a stale list happens.

1. `apps/app/src/api/client.ts` — one 2-line method naming its response schema.
2. `apps/app/src/api/query-client.ts` — its keys in `keys`, and a row per read in the contract's
   `READS` saying what each is built from — a new `Source`, `'widget'`, and any read that embeds a
   widget. Writes name only that source (`useWriteTo('widget', …)`); what they make stale is
   derived. See `docs/08-frontend.md`.
3. `apps/app/src/api/queries.ts` — a `useWidgets` / `useWidget` / `useCreateWidget` hook.

Only then the screen, which calls **those hooks** — not `api.*`, not `fetch` — renders UI
primitives, holds form state, and calls pure helpers from the contract. Nothing else.
See `docs/08-frontend.md` and `docs/playbooks/add-screen.md`.

## 9. The perf guard

An entity nobody measured is an entity that is fast until someone has a thousand of them.

- Extend `apps/api/src/db/seed-perf/` so the new tables carry production volume. An empty table
  makes every assertion about it vacuous, and uniform data hides the selective case an index exists
  for.
- Add the list and detail reads to `HOT_PATHS` in `apps/api/src/test/perf/hot-paths.ts`, naming the
  one dimension an N+1 would grow along.
- Run `bun run perf:report`, read `.artifacts/perf.md`, and fill in `noSeqScan` and `indexes` from
  the plans you actually see — never from what you assume the planner will do.
- **Watch the guard fail.** Drop the index against `cedo_test_perf` and confirm the message names
  the problem. See `docs/10-testing.md`.

## 10. Documentation, in the same commit

- `docs/03-domain-model.md`: the tables, the invariants, **and the index plan table**.
- An ADR if you made a decision someone might otherwise reverse.
- `bun run check` — which includes the documentation link checker.

## The whole checklist

```
[ ] contract schemas + invariant tests
[ ] table with ...ownable() and the (owner_group_id, name, id) index
[ ] children: ownerTarget() on the parent, childOwner() + ownerKey() on each child
[ ] favouriteTable()
[ ] a visible relation per table; added to the lint importNames and to raw-sql.test.ts OWNED
[ ] migration generated and committed
[ ] its tables in OWNABLE_TABLES (ownable/write.ts); lifecycle.ts declaring it; the service builds on it
[ ] service reads through the relations; write.ts carries editable() on every statement
[ ] a case per new GET route / read-only MCP tool in test/membership-lost.test.ts
[ ] an entry in KINDS in modules/ownable/ownable.test.ts
[ ] children loaded in a fixed number of queries
[ ] routes <=5 lines, mounted in app.ts
[ ] duplicate
[ ] tests: isolation, expectContract via wire, 401
[ ] MCP tool
[ ] client method + query keys + hooks, THEN the screen
[ ] e2e: the route in the sweep, a journey if it needs real data
[ ] perf: seeded at volume, in HOT_PATHS, and the guard watched failing
[ ] docs/03 updated, ADR if needed
[ ] bun run check green
```
