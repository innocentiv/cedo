-- An entry under a progression rule is held to it now (ADR-0026), and a stored entry the contract
-- would refuse is turned Manual — every number it holds kept, the rule dropped for its author to
-- pick again — rather than left to fail the plan's read, or advance in a way nothing can mean.
UPDATE "workout_entries" AS e
SET "progression" = '{"kind":"none"}'::jsonb
FROM "exercises" AS x
WHERE x."id" = e."exercise_id"
  AND e."progression"->>'kind' <> 'none'
  AND (
    -- A rule that does not fit how the exercise is measured (#22).
    NOT (
      (x."tracking" IN ('weight_reps', 'bodyweight_reps') AND e."progression"->>'kind' IN ('linear', 'double'))
      OR (x."tracking" = 'duration' AND e."progression"->>'kind' = 'linear_duration')
      OR (x."tracking" = 'distance_duration' AND e."progression"->>'kind' = 'linear_distance')
    )
    -- A double range that does not run upward.
    OR (
      e."progression"->>'kind' = 'double'
      AND (e."progression"->'repRange'->>0)::int >= (e."progression"->'repRange'->>1)::int
    )
    -- A double whose working reps lie outside its range.
    OR (
      e."progression"->>'kind' = 'double'
      AND EXISTS (
        SELECT 1 FROM "workout_sets" AS s
        WHERE s."entry_id" = e."id" AND NOT s."is_warmup" AND s."target_reps" IS NOT NULL
          AND (
            s."target_reps" < (e."progression"->'repRange'->>0)::int
            OR s."target_reps" > (e."progression"->'repRange'->>1)::int
          )
      )
    )
    -- Working sets that differ in what the rule moves or judges.
    OR EXISTS (
      SELECT 1 FROM "workout_sets" AS s
      WHERE s."entry_id" = e."id" AND NOT s."is_warmup"
      -- A sentinel stands for "not prescribed", so a null differs from a value: -1 for what is
      -- never negative, the least integer for a weight, which assistance makes negative (#19).
      HAVING
        CASE e."progression"->>'kind'
          WHEN 'linear_duration' THEN count(DISTINCT coalesce(s."target_duration_s", -1))
          WHEN 'linear_distance' THEN count(DISTINCT (coalesce(s."target_distance_mm", -1), coalesce(s."target_duration_s", -1)))
          ELSE count(DISTINCT (coalesce(s."target_reps", -1), coalesce(s."target_weight_g", -2147483648)))
        END > 1
    )
  );
