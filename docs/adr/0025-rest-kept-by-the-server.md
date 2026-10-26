# 0025 — The rest is kept by the server, and its end is pushed

**Status:** Accepted (2026-10-26)

## Context

The rest after a set was the phone's alone: counted from the set's `logged_at` by the contract's
`restOf`, with +30 s and skip held in the screen's memory. That works while the app is open. The
athlete wants to be told when a rest is over with the phone locked or the app in the background
(#38) — and later, in an iOS app, to watch it count down in the Dynamic Island.

A web app on a home screen cannot run a timer in the background: iOS suspends it. The only thing
that reaches a locked phone is a push notification — sent by a server, since iOS 16.4 to an
installed web app, through Apple's push service.

## Decision

**The server keeps when a rest ends, and sends a push when it does.**

- `workout_sessions` keeps `rest_since`, `rest_ends_at` and `rest_alerted_at`. Logging a set works
  them out with `restOf` — the app's own rule, so the phone and the alert agree; +30 s and skip are
  writes (`POST /sessions/:id/rest`), naming the rest they mean by its `since`, so one sent late,
  after the next set, changes nothing. Undo, finishing and deleting end it.
- The phone still counts its own rest — offline, from sets waiting for a signal too — and takes the
  server's end when it is the same rest and later (`restCounted`): a tap made elsewhere, or before
  a reload. Never the two added.
- Web Push, with a key pair the server makes on first start and keeps in the database
  (`instance_secrets`), or one an environment variable supplies: nothing for someone self-hosting
  to set up. Every device the athlete allowed it on is told.

## Rejected

- **A timer in the service worker.** iOS stops it in the background; it would sound only when it
  did not need to.
- **The phone scheduling a local notification.** The web has no such API that iOS honours.
- **The server as a second, separate count.** Two clocks disagree; one rule (`restOf`) on both sides,
  and the server's kept end read back, makes them one.

## Consequences

- Logging a set does a little more: the rest is worked out and written. Alerts need the API to run
  a sender, once a second, over an index of the rests still to tell.
- A future iOS app counts down to the same `rest_ends_at`, in a Live Activity updated by APNs: the
  model stays, only the delivery changes.
