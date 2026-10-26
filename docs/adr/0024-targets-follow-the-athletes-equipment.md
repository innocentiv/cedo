# 0024 — A plan keeps its weights; each athlete's target is the one their equipment can load

**Status:** Accepted (2026-10-26)

## Context

Plans are shared: a coach writes one and several athletes follow it, each in their own gym. A plan
that says 22.5 kg cannot be lifted on dumbbells that go 20, 22, 24. Worse, a set clears its target
only at or above its weight (`clears.ts`), so the athlete who logs 22 misses every time, and the
exercise stalls for good (#32).

Each athlete describes their equipment's weight step, least and most (#34, #36).

## Decision

**The plan keeps what it says. Each athlete is shown the heaviest weight their equipment can load
that is not above it, and a set is judged against the weight they were shown.**

- 22.5 kg on 2 kg dumbbells is 22. It never rounds up: an athlete is never asked for more than the
  plan.
- Above their heaviest, the target stops at it, and says so.
- An increase smaller than one step changes nothing until increases add up to one.
- A new plan entry's increase defaults to the athlete's step for its equipment.

## Rejected

- **Rewriting the plan's weights to the athlete's equipment.** A shared plan has no one athlete;
  rewriting it for one is wrong for the others, and for a coach who meant 22.5.
- **Rounding to the nearest, or up.** Up asks for more than the plan; nearest sometimes does.
- **Judging against the plan's weight.** The bug being fixed: a target that cannot be loaded can
  never be cleared.

## Consequences

- A target is per athlete, computed on read from the plan and their equipment, as targets already
  are from their own logs. Nothing is stored, so a changed setup takes effect at once.
- What progression judges is the snapped weight, so two athletes on one plan can advance at
  different moments — each against what they could load.
