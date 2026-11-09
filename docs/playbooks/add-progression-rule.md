# Adding a progression rule

A rule is a variant of a Zod discriminated union stored in JSONB. **There is no migration**, and
that is the whole reason for the design. See `docs/adr/0012-progression-rules.md` for the rules'
maths (its effort table as amended: each set judged against its own reps in reserve, ADR-0026,
whole, ADR-0027) and `docs/adr/0026-targets-and-steps.md` for what they are applied to: a person's **target**,
moved one **step** each time a session is finished — never the plan's prescription.

## 1. Extend the union

In `packages/contract/src/progression.ts`:

```ts
z.object({
  kind: z.literal('percentage'),
  incrementPct: z.number().positive(),
  afterSuccesses: z.int().min(1).max(10).default(1),
})
```

Add the kind to the contract's one answer to **which rules fit which tracking mode** — the
function the plan save, the editor and MCP all ask. A kind no tracking mode allows can be saved by
nobody and offered by no screen.

Give every field a description (`.describe`): an AI learns the rule from it, and a test fails on a
plan field without one.

## 2. Teach `step` about it — and say what it moves

`step`, in `packages/contract/src/step.ts`, is a pure function, and its switch is exhaustive —
`switch-exhaustiveness-check` will fail the build until the new case is handled. That is
deliberate: it is impossible to add a rule and forget the maths.

It is reached in one place, `takeSteps` (`take-steps.ts`), which takes each session's step from
the person's target — when a session is finished, and when a correction takes steps again. The
contract does not export `step`. The logger, the plan editor and `workout_progression` read the
stored target, so an AI's advice and the athlete's next session cannot differ.

Declare two things, beside the rule:

- **What it moves** — the dimensions a target may differ from its prescription in, and so all a
  target set by hand may change (linear: weight).
- **What it judges** — the dimensions a session must reach (linear: reps and weight).

Together they decide what every working set must share under the rule, and what a step is compared
against: what it moves or judges, each working set's reps in reserve, and the rule's settings. A rule
that moves and judges nothing new reuses existing declarations.

What a session must do to clear a target is a judge in `packages/contract/src/clears.ts`, one per
dimension a rule advances (`judgeReps`, `judgeDuration`, `judgeDistance`), each built on
`firstShort` and answering a `Verdict`; reps are judged against each working set's own reps in
reserve. A rule that advances a dimension already there reuses its judge; a new dimension adds one
beside them. A target pushed past its ceiling is held by `step` itself, so a rule's maths need
not check `MAX_*`.

## 3. Write the truth table first

In `packages/contract/src/progression.test.ts`. No database, no DOM — this is where progression
correctness is actually proven. Each table's sessions are taken through `takeSteps`, as production
takes them, never through `step` directly. What only a run of steps does belongs in
`take-steps.test.ts`: where a run starts, what anchors it, what each session is judged against, and
the loadable weights it lands on.

Cover: a success advancing, a failure not advancing, `afterSuccesses` counted over consecutive
sessions only (the streak a step carries: one more when cleared, none when held or advanced),
warmup sets excluded, a session with no working set holding the target, and a target
that differs from its prescription only in what the rule moves.

## 4. Give the editor its defaults

`NEW_RULE` in `packages/contract/src/plan-editing.ts` is the starting rule for each kind, in the
person's unit — what `progressionOf` gives when the editor switches to that kind (switching back
keeps the earlier rule's settings). It is typed over every kind, so a missing one does not compile.
`apps/app/src/ui/rule-field.tsx` renders the rule's settings, so a kind with a new parameter gets
its input there; `describeProgression` names it, `ruleLabel` is its segment in the editor,
`ruleSentence` says what it does there,
`rulesFor` offers it to the exercises it fits, and `judgedBy` says what its working sets share.

## 5. Check nothing else needed changing

```bash
bun run check
```

If anything outside those files (and `clears.ts`, for a new dimension) had to change, the union is
not carrying its weight and the design deserves a second look.
