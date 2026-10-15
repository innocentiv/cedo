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
