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
- **The client address comes from `X-Forwarded-For`**, read from the right past every proxy on a
  private network (`lib/client-address.ts`). Only Caddy reaches the API, and Caddy trusts a private
  proxy in front of it to name the client (`trusted_proxies static private_ranges`), overwriting the
  header from anyone else. Anything left of the first public address could have been written by the
  client, so it is ignored.
- **`platform_status` shows where the last login attempt came from**, so a curator can see the
  proxy's own address arriving instead of a client's.
- **A password reset code (#69) is counted the same way**, in the same table, per address and
  username: a wrong code is a failed login.

## Consequences

- An outer proxy must **set** `X-Forwarded-For` (nginx: `$proxy_add_x_forwarded_for`). One that only
  passes the request's headers on lets a client write its own and be counted as any address it
  likes; one that sends none makes every client its own address, sharing one count, so fifty
  failures from anyone lock everyone out for the window. `docs/09-deployment.md` says what to send.
- A CDN or proxy on a public address in front (Cloudflare's, say) is not trusted, so every client
  arrives as the CDN's edge: shared counts, as above. Such a setup must trust its ranges in Caddy.
- On a private network, a client can write its own `X-Forwarded-For` and be counted as someone else.
  The limit is for the internet; a LAN is trusted as far as this goes.
- Clients behind one address — a carrier's NAT, an office — share its counts: fifty failures
  among them lock them all out for the window.

## Rejected

- **In memory.** Simpler, but every deploy would hand an attacker a fresh budget.
- **A limit at the proxy alone.** Caddy has none built in, and instances run behind other proxies.
- **Per username.** See above.
