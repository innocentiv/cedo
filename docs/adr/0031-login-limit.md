# 0031 — Failed logins are limited per address and per address and username, in Postgres

**Status:** Accepted (2026-11-07), #72.

## Context

Nothing limited login attempts. Passwords are argon2id, which slows guessing a stolen hash, not
guessing through the login route. With the repository public and instances on the internet, a
script could try passwords against any account for as long as it liked. `rate_limited` was reserved
in the contract for this.

## Decision

- **Two counts of failed logins**, over a 15-minute window: per client address and username (10),
  and per client address alone (50). Over either, a login is refused with `rate_limited` (429) and a
  `Retry-After` header, the right password included, until enough failures age out. A login for an
  account that does not exist counts the same, so the limit says nothing about who exists. A
  successful login clears its own address and username's failures, nobody else's.
- **Never per username alone.** That would let anyone lock its owner out by failing on purpose.
- **In Postgres**, `login_failures`, a row per failure, pruned as it ages out: the counts survive a
  deploy or a restart, and need nothing new to run. The window's arithmetic is Postgres's, which
  dated the rows.
- **The client address comes from `X-Forwarded-For`**, read from the right past every proxy on a
  private network (`lib/client-address.ts`). Only Caddy reaches the API, and Caddy trusts a private
  proxy in front of it to name the client (`trusted_proxies static private_ranges`), overwriting the
  header from anyone else. Anything left of the first public address could have been written by the
  client, so it is ignored.
- **`platform_status` shows where the last login came from**, so a curator can see the proxy's own
  address arriving instead of a client's.

## Consequences

- Behind an outer proxy that sends no `X-Forwarded-For`, every client arrives as that proxy and
  shares one count: fifty failures from anyone lock everyone out for the window.
  `docs/09-deployment.md` says what the proxy must send, and `platform_status` shows it.
- On a private network, a client can write its own `X-Forwarded-For` and be counted as someone else.
  The limit is for the internet; a LAN is trusted as far as this goes.
- Two logins racing at the limit may both be let through, since each counts before it fails. That is
  a guess or two more, on top of argon2's cost, against a lock on every login.
- Resetting a password (#69) will need its own limit, or this one.

## Rejected

- **In memory.** Simpler, but every deploy would hand an attacker a fresh budget.
- **A limit at the proxy alone.** Caddy has none built in, and instances run behind other proxies.
- **Per username.** See above.
