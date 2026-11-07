# Architecture decision records

One file per decision. Each records what was chosen, what was rejected, and **why** — so a future
session can tell the difference between a deliberate constraint and an accident, and knows what
would have to change for the decision to be revisited.

Do not silently reverse a decision recorded here. If you believe one is wrong, add a superseding ADR
that says so and links back.

| ADR | Decision | Status |
| --- | --- | --- |
| [0003](0003-ownable-columns.md) | Ownable columns per table, not a `resources` supertable | Accepted |
| [0006](0006-oxc-lint-and-format.md) | oxlint + oxlint-tsgolint + oxfmt for linting and formatting | Accepted |
| [0007](0007-typescript-version-split.md) | TypeScript 7 on the server, TypeScript 6 in the Expo app | Accepted |
| [0009](0009-media-model.md) | Media as `kind` + JSONB payload; uploads content-addressed and served unauthenticated | Accepted |
| [0012](0012-progression-rules.md) | Linear, double and duration progression; advance-or-hold only | Accepted, superseded in part by 0026 (a rule moves a person's stored target, not the plan; sets diverge on Manual; each set judged against its own reserve) and 0027 (the half-point allowance) |
| [0015](0015-no-eden-treaty.md) | No Eden Treaty; a contract-typed fetch client instead | Accepted |
| [0017](0017-webview-for-ui-verification.md) | `Bun.WebView` for UI verification; no component tests | Accepted |
| [0018](0018-n1-detection.md) | N+1 detected by query-count invariant, not a threshold | Accepted |
| [0019](0019-visible-relations.md) | Visibility is a relation modules join; children carry their owner | Accepted |
| [0020](0020-rpe-is-numeric.md) | RPE is stored as `numeric(3,1)`, not as an integer | Accepted, superseded in part by 0027: whole steps only |
| [0021](0021-coaching-through-groups.md) | Coaching through groups: editors read the training members share | Accepted, amended: a coach writes athlete notes and weigh-ins |
| [0022](0022-plans-edited-in-place.md) | A workout's plan is edited in place, saved as each change is made | Accepted |
| [0023](0023-equipment-is-a-fixed-list.md) | Equipment is a fixed list of capabilities, and an exercise needs all of its items | Accepted |
| [0024](0024-targets-follow-the-athletes-equipment.md) | A plan keeps its weights; each athlete's target is the one their equipment can load | Accepted, superseded in part by 0026 (targets are stored, and increases accumulate; snapping and the one-step minimum stand) |
| [0025](0025-rest-kept-by-the-server.md) | The rest is kept by the server, and its end is pushed | Accepted, amended: not pushed |
| [0026](0026-targets-and-steps.md) | A person's target is stored as steps; a plan only says where it starts | Accepted |
| [0027](0027-reps-in-reserve-whole-everywhere.md) | How hard a set was is reps in reserve, whole, for people and AI alike | Accepted |
| [0028](0028-prose-parsed-in-the-contract.md) | Long text is Markdown, read in the contract and drawn by the app | Accepted |
| [0029](0029-sign-up-and-the-first-curator.md) | Sign-up is the instance's setting, and a fresh instance's first account curates it | Accepted |
| [0030](0030-agpl-and-a-contribution-licence.md) | Licensed AGPL-3.0-or-later; outside code waits for a contribution licence | Accepted |
| [0031](0031-login-limit.md) | Failed logins are limited per address and per address and username, in Postgres | Accepted |

The numbering has gaps: decisions that were planned an ADR (such as 0005, the three-container
deployment shape) are recorded in the relevant doc instead — `docs/01-architecture.md` for that
one. Do not reference an ADR number that is not in this table.

This table is **checked mechanically** by `bun run docs:links`: an ADR file that is not listed here
fails the build. It drifted once already — three ADRs existed and none of them appeared above —
because keeping an index current by discipline does not work.
