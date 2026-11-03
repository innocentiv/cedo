# 0027 — How hard a set was is reps in reserve, whole, for people and AI alike

**Status:** Accepted (2026-11-03). Supersedes, in part, [0020](0020-rpe-is-numeric.md) (half-points:
its check narrows to whole steps) and [0012](0012-progression-rules.md)'s half-point allowance — in
"A prescribed RPE is a ceiling" (its "within half a point" rows and "Half a point" paragraph) and in
its Consequences ("none rated more than half a point past a prescribed RPE").

## Context

Effort was stored as RPE, 5 to 10 in half-points (#3, ADR-0020), and asked of people as reps in
reserve, none to five, whole. The store was finer than anything a person was ever asked, and the
two sides of the product spoke different languages:

- An AI wrote the plan in RPE, including halves (7.5 on four entries of one plan). The app showed
  2.5 in reserve as nothing selected — the entry looked as if it asked no effort at all.
- The AI wrote cues mixing both ("stop 2 reps short of failure (RPE 7–8)"), and read back "RPE 8"
  where the athlete read "2 in reserve". One number, two names, and a conversion each side had to get
  right.
- Half a reserve has no meaning to a person. On the RIR-based RPE scale (Zourdos et al., 2016) a half
  point is uncertainty — RPE 8.5 is "certainly one left, maybe two" — which reads in RPE and not as
  "1.5 reps". The user had rejected half reserves for exactly that reason.

## Decision

**How hard a set was is rated in reps in reserve, none to five, whole — prescribed, logged, read and
written in that one name by the app, the API, MCP and the docs.** RPE survives only as the stored column (`10 − reserve`);
nothing anyone reads or writes says RPE.

- The contract refuses a half, prescribed or logged, saying why.
- Prescribed, reps in reserve is a **floor**: the fewest a set must leave. A range (1–2) is
  prescribed as its bottom. A set that left fewer than asked was ground out past it and holds
  progression (#45).
- With whole numbers on both sides, 0012's half-point allowance (a set may go half a point past its
  RPE) has nothing to allow, and is removed.
- Each working set may prescribe its own (ADR-0026).
- Cues and notes an AI writes say reps in reserve; the tool descriptions say so.

## Rejected

- **Keep halves, shown as ranges** ("2–3 in reserve"). Truer to the RIR-based scale, at the price of a
  selector of eleven and a notion every beginner must learn, for a nuance (Helms' 9.5) that changes
  no progression decision.
- **Ask people in RPE.** "How many more could you have done?" is answerable between sets; "rate it
  one to ten" is not, and the RIR-based scale anchors on reserve for that reason.
- **Keep RPE on the AI side.** It is the convention the literature writes in — and the reason the AI
  and the athlete were reading different numbers about the same set.

## Consequences

- Stored halves are rounded by the migration. A prescription goes to the whole RPE above it (7.5 →
  8, two in reserve: a range is prescribed as its top RPE, its bottom reserve). A logged rating goes
  to the whole RPE above it as well — the harder reading — so no past set is remembered easier than
  it was rated.
- `numeric(3,1)` and its check stay (ADR-0020's reasoning for an exact rating column holds); the
  check narrows to whole steps.
- Effort drift and the review keep averaging ratings, so an average may still be a fraction ("3 → 1.5
  in reserve"): an average is not a rating.
