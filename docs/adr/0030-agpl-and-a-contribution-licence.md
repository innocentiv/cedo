# 0030 — Licensed AGPL-3.0-or-later; outside code waits for a contribution licence

**Status:** Accepted (2026-11-07), as the repository is prepared to be public (#70, #74).

## Context

The repository had no licence, which makes it "all rights reserved": readable once public, but not
lawfully run, changed or shared. cedo is a self-hosted server meant to be run by many people, each
on their own instance, and its maintainer means to ship native builds to app stores (#10).

## Decision

- **AGPL-3.0-or-later**, for the whole repository: `LICENSE` holds the text as gnu.org publishes it,
  and every `package.json` says so. Anyone may run, change and share cedo; whoever runs a changed
  version for others over a network offers them its source. It is the usual licence for a
  self-hosted server, Immich's and Mastodon's among them. "Or later" is the FSF's recommendation.
- **The maintainer holds the copyright** of everything in the repository, so shipping their own
  builds to app stores, whose terms add restrictions the AGPL does not allow others to add, stays
  theirs to do.
- **Outside code waits for a contribution licence.** Code contributed under the AGPL alone would end
  that freedom for every build that included it. Before outside contributions open, a contribution
  agreement — or a sign-off granting the maintainer wider rights — is chosen and written into
  `CONTRIBUTING.md`. Until then only collaborators open issues and pull requests (the repository's
  issue and pull request permissions); anyone may comment.

## Rejected

- **MIT or Apache-2.0.** Simpler, but a closed, hosted fork would owe its users nothing.
- **AGPL-3.0-only.** Fixes the licence at version 3; there was no reason to refuse later versions.
- **No licence, the source only readable.** Self-hosting needs the right to run it.
