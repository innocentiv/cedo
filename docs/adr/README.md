# Architecture decision records

One file per decision. Each records what was chosen, what was rejected, and **why** — so a future
session can tell the difference between a deliberate constraint and an accident, and knows what
would have to change for the decision to be revisited.

Do not silently reverse a decision recorded here. If you believe one is wrong, add a superseding ADR
that says so and links back.

| ADR                                         | Decision                                                    | Status   |
| ------------------------------------------- | ----------------------------------------------------------- | -------- |
| [0006](0006-oxc-lint-and-format.md)         | oxlint + oxlint-tsgolint + oxfmt for linting and formatting | Accepted |
| [0007](0007-typescript-version-split.md)    | TypeScript 7 on the server, TypeScript 6 in the Expo app    | Accepted |
| [0015](0015-no-eden-treaty.md)              | No Eden Treaty; a contract-typed fetch client instead       | Accepted |
| [0017](0017-webview-for-ui-verification.md) | `Bun.WebView` for UI verification; no component tests       | Accepted |
| [0018](0018-n1-detection.md)                | N+1 detected by query-count invariant, not a threshold      | Accepted |

ADRs for the remaining decisions land with the milestone that implements them.
