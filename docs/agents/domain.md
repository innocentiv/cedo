# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase. This is a single-context repo: `apps/api`, `apps/app` and `packages/contract` share one domain.

## Before exploring, read these

- **[`GLOSSARY.md`](../../GLOSSARY.md)** at the repo root: the domain's terms (owning group, ownable, child, visible relation).
- **[`docs/03-domain-model.md`](../03-domain-model.md)**: the tables, relations and invariants behind those terms — the `ownable()` columns, visible relations, base units.
- **[`docs/adr/`](../adr/README.md)**: read ADRs that touch the area you're about to work in.

`GLOSSARY.md` and `docs/03-domain-model.md` must never define the same term differently. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) adds a term when one is resolved; if a resolved term changes the model, update `docs/03-domain-model.md` in the same change.

## File structure

```
/
├── GLOSSARY.md                 ← the domain's terms
├── docs/
│   ├── 03-domain-model.md      ← tables, relations, invariants
│   └── adr/
│       ├── README.md           ← the ADR index
│       ├── 0003-ownable-columns.md
│       └── …
├── apps/
└── packages/
```

## Recording an ADR

- Number it after the highest existing ADR; gaps in the sequence are deliberate and are not to be filled.
- **Add a row for it to the table in `docs/adr/README.md`.** `bun run docs:links` fails the build on any ADR file missing from that index.
- Never edit or silently reverse an accepted ADR. A changed decision is a new ADR that says what it supersedes and links back.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `docs/03-domain-model.md` or `GLOSSARY.md`. Don't drift to synonyms the docs explicitly avoid.

If the concept you need isn't defined yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0003 (ownable columns per table), but worth reopening because…_
