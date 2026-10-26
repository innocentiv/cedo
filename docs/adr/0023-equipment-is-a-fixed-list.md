# 0023 — Equipment is a fixed list of capabilities, and an exercise needs all of its items

**Status:** Accepted (2026-10-26)

## Context

Every exercise was offered to everyone, whatever they train with, and the AI planned from the whole
library: a barbell lift for someone with dumbbells at home. An exercise's equipment was free text
that nothing read ('Dumbbells' seven times, 'Dumbbell' twice, 'Plate or neck harness' once). And
the weight stepper moved 2.5 kg for everyone, where one athlete's dumbbells go 20, 22, 24 (#32).

Suggesting only what an athlete can do needs two answers that can be compared: what an exercise
needs, and what the athlete has. The hard part is the vocabulary: cables with a pulley at the top
and one at the bottom, but none in between; a barbell without a rack.

## Decision

**A fixed, flat list of capabilities, shipped with cedo (`EQUIPMENT` in the contract), and an
exercise needs all of the items it names.**

- **An item is what equipment lets you do, not a product.** *High pulley*, *Low pulley* and
  *Adjustable pulley* are three items: cables fixed at the top and bottom are the first two, a fully
  adjustable column all three. A flat and an incline bench are two; a rack is apart from a barbell.
  Each is a yes or a no, with no attributes, so an item either matches a need or does not. Shortcuts
  that tick several (an adjustable bench) belong to the screen, not the list.
- **An exercise needs every item it names.** No either/or: a different setup is a different
  exercise (a dumbbell and a cable lateral raise), and what several products share is one item
  (*Rack* is squat stands and a power cage alike; a pulley fixed high serves a pulldown).
- **Each machine is its own item**: a gym has a leg press and no hack squat, and each stack steps
  differently.
- **At most one item holds the load** (`weighted`): it carries the athlete's weight step. A *Weight
  belt* holds load but no exercise needs it — it loads one done without it.
- **Undescribed is not "needs nothing".** `null` means nobody has said, `[]` a push-up. An
  undescribed exercise is offered to everyone, and the library audit lists it.
- Stored as a nullable array of a Postgres enum on the exercise; the contract's list is the source
  of truth, as it is for muscles and tracking modes.

## Rejected

- **Free text, or items people add.** An item one person invents matches no exercise's needs, so it
  filters nothing, silently — the failure the free-text field already had.
- **Items with attributes** (a cable station with `heights: [top, bottom]`). Each attribute is its
  own matching rule, and the question it answers — can this exercise be done here — is the yes or
  no a capability already is.
- **Either/or needs** (a squat needs a rack *or* a Smith machine). A different setup changes the
  movement, its loads and its progression; it is a different exercise. Where it does not, one item
  should name the shared capability.
- **One "Machine" item.** Too coarse to answer anything: owning one machine would make every machine
  exercise doable.

## Consequences

- Adding an item is a release: a contract change and a migration that extends the enum. Removing or
  renaming one migrates every exercise naming it.
- The free-text equipment was dropped; the library is described from the seed at boot, onto entries
  still undescribed, so a curator's own description stands. An athlete's own exercises start
  undescribed, and are offered to everyone until they say.
- Whether an exercise is **doable** for an athlete is a comparison of two sets (#35), and its weight
  step is the athlete's for its one weighted item (#36).
