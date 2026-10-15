# cedo

A self-hosted workout tracker shared within groups. This glossary names the domain's concepts. The
tables and invariants behind them are in `docs/03-domain-model.md`, and the two never disagree.

## Ownership and access

**Owning group**:
The group an exercise or workout belongs to. It alone decides who may read or change the thing.
_Avoid_: owner (as a user), author

**Ownable**:
Something that can be shared, transferred, duplicated and favourited: today, an exercise or a
workout.
_Avoid_: resource, entity

**Child** (of an ownable):
A part that exists only inside one ownable and belongs to its owning group: a workout's days,
entries and sets, or an exercise's muscles and media.
_Avoid_: sub-resource

**Visible**:
Readable by a caller, because they belong to the owning group in any role.

**Editable**:
Changeable by a caller, because they are an editor of the owning group.

**Visible relation**:
The rows of an ownable, or of its children, that one caller may read. It is the only form in which
a read sees them.
_Avoid_: scope, filtered table, view

## What can be done with an ownable

**Scope**:
Which slice of the visible ownables a list shows: all of them, the caller's own (mine), the
caller's favourites, or one group's.
_Avoid_: filter, view

**Favourite**:
A per-user pin on an ownable. Pinning needs only that the ownable is visible.
_Avoid_: bookmark, star

**Transfer**:
Moving an ownable, children and all, to another owning group. It needs editor rights on both groups.
_Avoid_: move, share

**Duplicate**:
Copying a visible ownable into a group the caller can edit, so a read-only one can be changed as
their own.
_Avoid_: clone, fork
