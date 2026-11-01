# 0021 — Coaching through groups: editors read the training members share

**Status:** Accepted (2026-10-24), amended (2026-10-28: a coach writes athlete notes; 2026-11-01:
and weigh-ins — see the end)

## Context

cedo was built first for an athlete and their AI coach, acting as that athlete through their own
access token. A human coach — or an AI acting for one — could not read anyone else's training:
sessions are private to the person who logged them, and `training_review` reads only the caller's
logs. Sharing a plan through a group was the only coaching there was (#11).

What a coach needs to see is well agreed: adherence, the estimated-max trend, effort drift, stalls,
and the athlete's notes — consistency above all (ACSM position stand, Currier et al., MSSE 2026).
How much machinery reaching it should take was the open question, and the user's guidance for the
app is minimal complexity.

## Decision

**A coach is an editor of a group an athlete shares their training with.** No new role: the editor
role already means "runs this group".

- **Sharing is the athlete's own switch, per group, off by default** — `group_members.shares_training`.
  It is not offered in a personal group, which has nobody else in it, nor in the starter library,
  which has every account and its curators. Nobody switches it for anyone else.
- **It is all or nothing, the past included, and it is not permanent.** Switching it off, leaving
  the group, being removed, or the coach no longer being an editor hides everything at once. The
  flag lives on the membership row, so leaving takes it with the row. The coach keeps no copy —
  ADR-0019's "visibility is not permanent", applied to people.
- **A coach reads; a coach never writes.** Everything the athlete reads of their own training —
  sessions (in progress too), set logs and notes, exercise history and stalls, the training review —
  read-only — under `/athletes/:id/…` over HTTP, and with an `athlete` id over MCP — never by
  pointing an existing "mine" route at someone else.
  Anyone not shared with the caller is a 404, as an invisible workout is, so a probe learns nothing.
- **Names follow ADR-0019 unchanged.** An exercise, plan or day the coach cannot see is treated in
  the athlete's training as each read already treats one you have lost: a session keeps the set and
  says "unavailable exercise", the review leaves its work out, its history is refused. Sharing
  training does not share what it was logged against. An athlete who wants a custom exercise counted
  and named moves it into the shared group.
- **MCP adds nothing to tokens.** A coach's token acts as the coach, so it reads exactly the athletes
  the coach can. `athlete_list` names them; the review, history and session tools take an optional
  athlete and call the same functions the HTTP routes do — one read, whoever asks for it, told
  whose it is in one place (`ownOrCoached`, `coaching/training.ts`).

## Rejected

- **A `coach` role beside editor and reader.** A third role multiplies every rule that reads one —
  who manages, who leaves, who transfers in — for a distinction the editor role already draws.
- **Training visible to every member of the group.** In a coach's group the athletes are readers,
  and would read each other. Readers see the editors and themselves, never each other, already
  (`members` in `modules/group/service.ts`); sharing follows the same line.
- **A person-to-person grant** ("share my training with Bob"). A second sharing mechanism beside
  groups, with its own revocation, for what a two-person group already is.
- **Comments from coach to athlete.** A thread is a new thing to read, notify about and moderate. The
  plan's cue for the athlete speaks for the coach, and a coach and athlete have a channel of their
  own.
- **Assigning a plan to one athlete.** A group with one athlete in it is that assignment, with
  sharing and withdrawal already working through it.
- **An access log, and notifications.** The athlete sees who *can* read their training, on the
  group; who *did* is surveillance of the coach the design does not need.

## Consequences

- A coach with ten athletes has ten small groups, and a team group if they want one.
- The training review, sessions and exercise history are computed for a person, not for the caller:
  the caller decides only what is visible, by ADR-0019's relations, and whether they may read that
  person at all.
- Every `/athletes` route is a GET in `test/membership-lost.test.ts`: each way of losing access ends
  in a 404.
- The training review is one read, said by the contract (`TrainingReview`): `GET /review` for your
  own (#28), `GET /athletes/:id/review` for an athlete's (#30), and `training_review` over MCP, with
  or without `athlete`.
- In the app, the athlete's side came first — the switch on a group, and who reads your training.
  The coach's side is the Athletes tab (#30), shown only to someone with an athlete to read: each
  athlete's Progress and history, read-only, with nothing on it to press that would change them.

## Amended (2026-10-28): a coach writes athlete notes

What an athlete says of their training was lost by the next plan — "my left shoulder hurts on
overhead work", "the last block was too much volume" — and a coach planning for them, or the AI
acting for one, had nowhere to keep it (#41). So a coach now writes one thing of an athlete's: an
**athlete note** (GLOSSARY.md), a standing fact about the person kept for planning their training.
It is still true that **a coach changes none of their training**: no session, set, plan or
equipment of theirs.

- The notes are the athlete's, read by them and by everyone who reads their training now — coaches
  read each other's — and written by any of them, under `/notes` and `/athletes/:id/notes`, and
  through `note_*` MCP tools with the same optional `athlete`. One rule decides who may
  (`ownOrCoached`), as for every read here.
- Only the author changes a note's words; the author or the athlete removes it — so an athlete
  can take back what is written about them without putting words in a coach's mouth.
- A coach's notes stay with the athlete when the coach stops coaching: what was learnt about the
  person is theirs. The coach reads none of it once they cannot read the training.

This is not the comment thread rejected above. A note answers nothing and nobody is told of one: it
is read when a plan is made, not as a conversation. Replies, notifications and a resolved state were
each asked and left out.

## Amended (2026-11-01): a coach takes weigh-ins too

A plan is weighed against the person as well as against what they lifted: their bodyweight and
its trend, and their age (#42). So a coach writes a second thing of an athlete's, a **weigh-in**
(GLOSSARY.md) — that day's bodyweight — on the same terms as a note: the athlete's, read and taken
by them and by whoever coaches them now, removed by whoever took it or by the athlete, and kept
when the coach stops coaching. A second weigh-in the same day replaces the first, whoever took it.

The year they were born is not one of them: only the athlete says it, and a coach reads it only as
the review's age. Their training is still never a coach's to change.
