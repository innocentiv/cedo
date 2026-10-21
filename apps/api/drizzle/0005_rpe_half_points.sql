ALTER TABLE "workout_sets" DROP CONSTRAINT "workout_sets_rpe_ck";--> statement-breakpoint
ALTER TABLE "set_logs" DROP CONSTRAINT "set_logs_rpe_ck";--> statement-breakpoint
ALTER TABLE "workout_sets" ALTER COLUMN "target_rpe" SET DATA TYPE numeric(3, 1);--> statement-breakpoint
ALTER TABLE "set_logs" ALTER COLUMN "rpe" SET DATA TYPE numeric(3, 1);--> statement-breakpoint
-- RPE 1 to 4 was allowed and has no place on the new scale — 5 to 10, the reserve a person can
-- estimate (see GLOSSARY.md): it is read as not rated, rather than refused by the check below.
UPDATE "workout_sets" SET "target_rpe" = NULL WHERE "target_rpe" < 5;--> statement-breakpoint
UPDATE "set_logs" SET "rpe" = NULL WHERE "rpe" < 5;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_rpe_ck" CHECK ("workout_sets"."target_rpe" is null or ("workout_sets"."target_rpe" between 5 and 10 and "workout_sets"."target_rpe" * 2 = trunc("workout_sets"."target_rpe" * 2)));--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_rpe_ck" CHECK ("set_logs"."rpe" is null or ("set_logs"."rpe" between 5 and 10 and "set_logs"."rpe" * 2 = trunc("set_logs"."rpe" * 2)));