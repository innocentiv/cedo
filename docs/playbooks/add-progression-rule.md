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

This one function is used by the API, the `progression_suggest` MCP tool and the logging screen's
hint, so an AI's advice and the UI's suggestion can never disagree.

## 3. Write the truth table first

In `packages/contract/src/progression.test.ts`. No database, no DOM — this is where progression
correctness is actually proven.

Cover: a success advancing, a failure not advancing, `afterSuccesses` counted over consecutive
sessions only, warmup sets excluded, and an empty history returning the current target unchanged.

## 4. Give the editor its defaults

`progressionOf` in `apps/app/src/ui/entry-editor.tsx` maps a chosen kind to a starting rule. Add the
case; the exhaustive switch will tell you if you forget.

## 5. Check nothing else needed changing

```bash
bun run check
```

If anything outside those four files had to change, the union is not carrying its weight and the
design deserves a second look.
