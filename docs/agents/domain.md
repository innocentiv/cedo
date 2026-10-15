# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase. This is a single-context repo: `apps/api`, `apps/app` and `packages/contract` share one domain.

## Before exploring, read these

- **[`docs/03-domain-model.md`](../03-domain-model.md)**: the domain vocabulary — tables, relations, the `ownable()` columns, `visible()` / `editable()`, base units. Until a `GLOSSARY.md` exists, this is the glossary.
- **`GLOSSARY.md`** at the repo root, if it exists.
- **[`docs/adr/`](../adr/README.md)**: read ADRs that touch the area you're about to work in.

If `GLOSSARY.md` doesn't exist, **proceed silently**. Don't flag its absence; don't suggest creating it upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates it lazily when terms actually get resolved. When it does, it must agree with `docs/03-domain-model.md` — the two must never define the same term differently. If a resolved term changes the model, update `docs/03-domain-model.md` too.

## File structure

```
/
├── GLOSSARY.md                 ← created lazily
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
