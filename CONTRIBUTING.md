# Contributing

cedo is one person's project, published so that anyone can run their own instance, read how it is
built, and learn from it.

## Where things stand

- **Issues are open to collaborators only, for now.** If you find a bug, or want something, and
  cannot open an issue, it is not you.
- **Security problems** go through private vulnerability reporting: see [SECURITY.md](SECURITY.md).
- **Pull requests come after an agreed issue.** A PR with no issue agreed first is closed with a
  link here: this codebase holds strict invariants, and it is cheaper to agree the shape before the
  code than after.
- **Before outside contributions open, a contribution licence will be chosen.** The code is
  AGPL-3.0-or-later; the maintainer also ships it to app stores, whose terms the AGPL's do not mix
  with, so a contribution has to come with rights that allow that. Until it is decided, outside code
  cannot be merged.

## Working on it

```bash
git clone <this repository> && cd cedo
bun run setup    # dependencies, .env, both databases, agent skills, then the gate
bun run check    # format, lint, typecheck, doc links, every test: before every commit
```

Read [CLAUDE.md](CLAUDE.md) before writing code. It applies to people and to any coding agent, and
its invariants are load-bearing: a change that breaks one is not accepted however well it works.
Then [docs/01-architecture.md](docs/01-architecture.md), and the playbook for what you are adding
(`docs/playbooks/`).

## What a public repository asks of every change

Everything here — code, history, issues and comments — is public. So
[docs/02-conventions.md](docs/02-conventions.md), "Public repository", applies to every commit:

- No personal, contact or health details, and no real figures from anyone's training, even as
  examples: use invented people.
- No live domain, host, provider or secret.
