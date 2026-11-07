# 0029 — Sign-up is the instance's setting, and a fresh instance's first account curates it

**Status:** Accepted (2026-11-07), #71, part of preparing the repository to be public (#70).
`CEDO_CURATOR_USERNAME` is kept for instances set up before it, and deprecated.

## Context

Anyone who reached an instance could create an account on it, and nothing could stop that. The
curator — an editor of the shared library, the one privileged role — came from
`CEDO_CURATOR_USERNAME`, promoted at every boot, and the docs said to set the variable and register
the account afterwards. So whoever registered that username first became curator, on any instance
following the docs: with the repository public, the probable username of a live instance's curator
was in it.

The owner also wants to open an instance for testers and close it again, without a deploy.

## Decision

- **Sign-up is one row in the database**, `instance_settings`, not an environment variable. The
  curator switches it, `PATCH /instance` or the MCP tool `instance_sign_up_set`, one service
  function behind both (invariant 4); anyone else gets a 404, as for every curator-only thing.
- **It has three states.** `first` is a fresh instance: its next account becomes the curator, an
  editor of the library, and sign-up closes behind them. `open` and `closed` are the curator's
  switch. A client is shown only `open` or `closed` — `first` takes an account, so it reads open —
  and `first` is never a value the switch takes.
- **Registration asks the instance first**, inside its transaction, and holds the row locked until
  it commits. Of any number registering on a fresh instance at once, exactly one is first; the rest
  find sign-up closed. Closed, registration is refused with `sign_up_closed` (403) before anything
  is written. It is the one 403 in the contract: whether an instance takes accounts is public, so
  saying so leaks nothing.
- **Upgraded instances start from what they are** (migration 0021): `first` with no account yet,
  `closed` where a curator exists, who can reopen it, and `open` where none does, as before, since
  nobody could reopen it there.
- **A missing row reads as closed.** An instance that cannot say it takes accounts does not.
- **`GET /instance` is public**: `{ product, version, signUp }`. The app asks it before anyone signs
  in, to offer sign-up or not, and a native app's server-address screen (#10) will ask it to
  recognise a cedo server. `Me.curator` tells the app whether to show the switch, so the app knows
  no rule.

## Consequences

- A fresh instance needs no variable and no restart to have a curator, and its sign-up closes on its
  own. The username-takeover gap remains only on an upgraded instance that has no curator yet and
  sets `CEDO_CURATOR_USERNAME` before the account exists.
- Registrations take turns at one row. They are rare, so the lock costs nothing that matters.
- The test harness truncates every table, which would leave every test on a `first` instance whose
  first `as()` became curator. The harness, and the e2e database, start `open`; tests set another
  state with `h.signUp()`, and e2e makes a curator with `curate-for-test.ts`.
- There is still no limit on login attempts (#72), nor a way to change or recover a password (#69).

## Rejected

- **An environment variable for sign-up.** Opening it for testers would mean a deploy, twice.
- **"No curator yet" as the test for the first account**, rather than a state. On an upgraded
  instance with accounts but no curator, the next stranger to register would have become curator.
- **Invite codes.** More than the owner needs now: open, testers register, close.
