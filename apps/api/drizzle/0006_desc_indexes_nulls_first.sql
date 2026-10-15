DROP INDEX "set_logs_exercise_time_idx";--> statement-breakpoint
DROP INDEX "workout_sessions_user_time_idx";--> statement-breakpoint
CREATE INDEX "set_logs_exercise_time_idx" ON "set_logs" USING btree ("exercise_id","logged_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "workout_sessions_user_time_idx" ON "workout_sessions" USING btree ("user_id","started_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);