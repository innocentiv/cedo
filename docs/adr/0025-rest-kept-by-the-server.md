# 0025 — The rest is kept by the server

**Status:** Accepted (2026-10-26), amended (2026-10-27: its end is no longer pushed — see below)

## Context

The rest after a set was the phone's alone: counted from the set's `logged_at` by the contract's
`restOf`, with +30 s and skip held in the screen's memory. That works while the app is open. The
athlete wants to be told when a rest is over with the phone locked or the app in the background
(#38) — and later, in an iOS app, to watch it count down in the Dynamic Island.

A web app on a home screen cannot run a timer in the background: iOS suspends it. The only thing
that reaches a locked phone is a push notification — sent by a server, since iOS 16.4 to an
installed web app, through Apple's push service.

## Decision

**The server keeps when a rest ends.**

- `workout_sessions` keeps `rest_since` and `rest_ends_at`. Logging a set works them out with
  `restOf` — the app's own rule, so the phone and the server agree; +30 s and skip are writes
  (`POST /sessions/:id/rest`), naming the rest they mean by how many sets the session had when
  tapped, so one sent late, after the next set, changes nothing. A skipped rest ends when it began.
  Undo works it out again; finishing and deleting end it.
- The phone still counts its own rest — offline, from sets waiting for a signal too — and takes the
  server's end when it is the same rest and later (`restCounted`): a tap made elsewhere, or before
  a reload. Never the two added.

## Rejected

- **A timer in the service worker.** iOS stops it in the background; it would sound only when it
  did not need to.
- **The server as a second, separate count.** Two clocks disagree; one rule (`restOf`) on both sides,
  and the server's kept end read back, makes them one.

## Consequences

- Logging a set does a little more: the rest is worked out and written.
- A native app (#10) schedules its notification, and a Live Activity's countdown, for the same
  `rest_ends_at` (#39).

## Amended (2026-10-27): the end is not pushed

As accepted, the server also pushed the rest's end, by Web Push, to every device the athlete
allowed: a key pair it made for itself (`instance_secrets`), a subscription per device
(`push_subscriptions`), and a sender claiming ended rests once a second (`rest_alerted_at`). On a
real iPhone, installed to the home screen with notifications allowed, nothing arrived — and Web Push
gives no way to see why. A native app makes the whole of it unnecessary: the phone schedules a local
notification for `rest_ends_at` itself, with no server, no keys and no signal needed.

So the push was removed (migration `0014_no_web_push`), and being told is #39, after the native app.
The rest the server keeps stayed: +30 s and skip still reach every device and survive a reload, and
it is what the native app schedules from. The removed code is 7c5a8f1..34511e3, the starting point
should the server ever need to tell other devices too (APNs).
