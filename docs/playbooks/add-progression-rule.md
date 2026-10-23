# Adding a progression rule

A rule is a variant of a Zod discriminated union stored in JSONB. **There is no migration**, and
that is the whole reason for the design. See `docs/adr/0012-progression-rules.md`.

## 1. Extend the union

In `packages/contract/src/progression.ts`:

```ts
z.object({
  kind: z.literal('percentage'),
  incrementPct: z.number().positive(),
  afterSuccesses: z.int().min(1).max(10).default(1),
})
```

Add the kind to `PROGRESSION_KINDS` in the same file. That constant is what the editor renders from,
so the new rule appears in the UI without touching a screen.

## 2. Teach `nextTarget` about it

`nextTarget` is a pure function, and its switch is exhaustive — `switch-exhaustiveness-check` will
fail the build until the new case is handled. That is deliberate: it is impossible to add a rule and
forget the maths.

This one function is called by the API's progression service, whose answers the
`workout_progression` MCP tool and the logger's pre-fill both render, so an AI's advice and the
athlete's next target never compute differently (they read different sessions — see ADR-0012).

What a session must do to count as clean is a predicate in `packages/contract/src/clears.ts`, one
per dimension a rule advances (`clearsReps`, `clearsDuration`, `clearsDistance`), each built on
`everyWorkingSet`. A rule that advances a dimension already there reuses its predicate; a new
dimension adds one beside them. A target pushed past its ceiling is held by `nextTarget` itself, so
a rule's maths need not check `MAX_*`.

## 3. Write the truth table first

In `packages/contract/src/progression.test.ts`. No database, no DOM — this is where progression
correctness is actually proven.

Cover: a success advancing, a failure not advancing, `afterSuccesses` counted over consecutive
sessions only, warmup sets excluded, and an empty history returning the current target unchanged.

## 4. Give the editor its defaults

`NEW_RULE` in `packages/contract/src/plan-editing.ts` is the starting rule for each kind, in the
person's unit — what `progressionOf` gives when the editor switches to that kind (switching back
keeps the earlier rule's settings). It is typed over every kind, so a missing one does not compile. `apps/app/src/ui/progression-field.tsx` renders the rule's fields, so a kind with a new
parameter gets its input there.

## 5. Check nothing else needed changing

```bash
bun run check
```

If anything outside those files (and `clears.ts`, for a new dimension) had to change, the union is
not carrying its weight and the design deserves a second look.
