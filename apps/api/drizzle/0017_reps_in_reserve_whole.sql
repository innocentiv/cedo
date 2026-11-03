ALTER TABLE "workout_sets" DROP CONSTRAINT "workout_sets_rpe_ck";--> statement-breakpoint
ALTER TABLE "set_logs" DROP CONSTRAINT "set_logs_rpe_ck";--> statement-breakpoint
-- Reps in reserve are whole (ADR-0027). A half is rounded to the harder whole value, the RPE above
-- it: a prescription written 7.5 — the range 7–8 — is asked as its top, two in reserve, and no past
-- set is remembered as easier than it was rated.
UPDATE "workout_sets" SET "target_rpe" = ceil("target_rpe") WHERE "target_rpe" <> trunc("target_rpe");--> statement-breakpoint
UPDATE "set_logs" SET "rpe" = ceil("rpe") WHERE "rpe" <> trunc("rpe");--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_rpe_ck" CHECK ("workout_sets"."target_rpe" is null or ("workout_sets"."target_rpe" between 5 and 10 and "workout_sets"."target_rpe" * 1 = trunc("workout_sets"."target_rpe" * 1)));--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_rpe_ck" CHECK ("set_logs"."rpe" is null or ("set_logs"."rpe" between 5 and 10 and "set_logs"."rpe" * 1 = trunc("set_logs"."rpe" * 1)));