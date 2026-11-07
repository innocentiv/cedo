# Contributing

cedo is one person's project, published so that anyone can run their own instance, read how it is
built, and learn from it.

## Where things stand

- **Issues, pull requests and comments are limited to collaborators, for now.** If you find a bug,
  or want something, and cannot open an issue, it is not you.
- **Security problems** go through private vulnerability reporting: see [SECURITY.md](SECURITY.md).
- **When contributions open, a pull request comes after an agreed issue.** This codebase holds
  strict invariants, and it is cheaper to agree the shape of a change before the code than after.
- **Before then, a contribution licence will be chosen.** The code is AGPL-3.0-or-later, and the
  maintainer means to ship it to app stores, whose terms do not mix with the AGPL's; so a
  contribution has to come with rights that allow that. Until it is decided, outside code cannot be
  merged. See [ADR-0030](docs/adr/0030-agpl-and-a-contribution-licence.md).

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

Treat everything here — code, history, issues and comments — as public: every commit follows
[docs/02-conventions.md](docs/02-conventions.md), "Public repository". In short, examples use
invented people, and deployments are described as anyone's.
