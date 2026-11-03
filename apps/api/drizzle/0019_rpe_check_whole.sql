ALTER TABLE "workout_sets" DROP CONSTRAINT "workout_sets_rpe_ck";--> statement-breakpoint
ALTER TABLE "set_logs" DROP CONSTRAINT "set_logs_rpe_ck";--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_rpe_ck" CHECK ("workout_sets"."target_rpe" is null or ("workout_sets"."target_rpe" between 5 and 10 and "workout_sets"."target_rpe" = trunc("workout_sets"."target_rpe")));--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_rpe_ck" CHECK ("set_logs"."rpe" is null or ("set_logs"."rpe" between 5 and 10 and "set_logs"."rpe" = trunc("set_logs"."rpe")));