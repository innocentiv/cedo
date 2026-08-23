# 0003 — Ownable columns per table, not a shared `resources` supertable

**Status:** Accepted (2026-08-23)

## Context

Every shareable entity needs the same behaviour: who owns it, who may read it, who may write it,
favouriting, duplication, and ownership transfer. Meal planning is expected later and must inherit
all of it without a rewrite.

The user's brief said entities link to "users or groups". That was collapsed first: every user gets
a **personal group** at registration, so there is exactly one owner type and therefore one ACL code
path. Everything below assumes that.

The remaining question was where the ownership columns physically live.

## Decision

Spread a shared `ownable()` column helper into each entity table, and write the access-control
helpers once as generics over the resulting structural type.

```ts
export const exercises = pgTable('exercises', { ...ownable(), tracking, description, ... })
export const workouts  = pgTable('workouts',  { ...ownable(), notes })

export const visible  = (t: OwnableTable, ctx: AccessContext) => inArray(t.ownerGroupId, ctx.groupIds)
export const editable = (t: OwnableTable, ctx: AccessContext) => inArray(t.ownerGroupId, ctx.editorGroupIds)
```

Favourites use a `favouriteTable(name, target)` factory, giving each entity kind its own table with
a **real foreign key**, so favourites cascade away with their target instead of becoming orphans.

## Why

Columns are duplicated, but **no logic is**. The alternative was a `resources` supertable holding
the ownable facts, with each entity table joined to it 1:1. That was rejected because of what it
costs on every single operation:

- **Create becomes two INSERTs in a transaction** instead of one.
- **Every read needs a join** and then a flatten, because the wire contract is one flat object while
  the storage is two rows.
- **An update touching both `name` and `description` is two UPDATEs**, and a rename writes to a
  different table than the one the developer thinks they are editing.

What the supertable would have bought — one favourites table, ownership transfer as a single UPDATE,
one ACL join — is already obtained by the generic helpers, at the cost of physically repeating six
columns. Repeated columns are cheap; repeated logic is not.

## Consequences

- A cross-kind "everything I have favourited" feed is a `UNION` over the per-kind favourite tables
  rather than one query. The UI shows favourites per section anyway.
- Adding an entity means remembering to spread `ownable()`. `docs/playbooks/add-entity.md` makes
  that step one of the recipe, and the ACL tests catch its absence.
- `created_by` is provenance only. Permissions come from `owner_group_id`, never from who created
  the row — otherwise a resource transferred into a group would still answer to its old author.
