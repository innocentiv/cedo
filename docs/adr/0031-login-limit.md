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
- **Each login is written down as a failure before its password is checked**, and counts itself; one
  over the limit takes its row back and is refused. A burst of logins at once then counts each
  other, so no more than the limit get a guess. Checking first and writing after the password let
  thirty at once through, all thirty guesses.
- **Never per username alone.** That would let anyone lock its owner out by failing on purpose.
- **An IPv6 client is counted by its /64**, the block one is usually handed: per address, it would
  have unlimited guesses.
- **In Postgres**, `login_failures`, a row per failure, pruned as it ages out: the counts survive a
  deploy or a restart, and need nothing new to run. The window's arithmetic is Postgres's, which
  dated the rows.
- **Caddy decides who the client is**, and sends it to the API as `X-Client-Ip` (its
  `{client_ip}`), overwriting any a client wrote; only Caddy reaches the API. It believes
  `X-Forwarded-For` only from the proxies `CEDO_TRUSTED_PROXIES` names — **none by default** —
  reading it from the right past them (`trusted_proxies_strict`), so an address a client wrote ahead
  of its own is never believed. Behind a host's proxy that sets the header, the variable is set to
  `private_ranges`.
- **`platform_status` shows where the last login attempt came from**, so a curator can see the
  proxy's own address arriving instead of a client's.
- **A password reset code (#69) is counted the same way**, in the same table, per address and
  username: a wrong code is a failed login.

## Consequences

- **Untrusted by default, behind a proxy every client is the proxy**, sharing one count: fifty
  failures from anyone lock everyone out for the window. The safer failure — a limit that holds
  rather than one a client can dodge — and `platform_status` shows it. Setting
  `CEDO_TRUSTED_PROXIES` ends it, but only behind a proxy that **sets** `X-Forwarded-For` (nginx:
  `$proxy_add_x_forwarded_for`): trusting one that passes the client's header on would let a client
  name any address. Trust by default was rejected for that: Docker Desktop, rootless Docker, some
  load balancers and IPv6 through Docker's port forwarding make any client look private.
- A CDN in front (Cloudflare's, say) is trusted by listing its ranges in the same variable.
- Behind a trusted proxy on a private network, a client on that network can write its own
  `X-Forwarded-For` and be counted as someone else. The limit is for the internet.
- Clients behind one address — a carrier's NAT, an office — share its counts: fifty failures
  among them lock them all out for the window.

## Rejected

- **In memory.** Simpler, but every deploy would hand an attacker a fresh budget.
- **A limit at the proxy alone.** Caddy has none built in, and instances run behind other proxies.
- **Per username.** See above.
