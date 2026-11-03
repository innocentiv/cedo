CREATE TYPE "public"."step_kind" AS ENUM('session', 'by_hand');--> statement-breakpoint
CREATE TABLE "progression_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"session_id" uuid,
	"kind" "step_kind" NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"from" jsonb NOT NULL,
	"target" jsonb NOT NULL,
	"held" jsonb,
	"streak" smallint DEFAULT 0 NOT NULL,
	"against" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "progression_steps" ADD CONSTRAINT "progression_steps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progression_steps" ADD CONSTRAINT "progression_steps_entry_id_workout_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."workout_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progression_steps" ADD CONSTRAINT "progression_steps_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "progression_steps_target_idx" ON "progression_steps" USING btree ("user_id","entry_id","taken_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "progression_steps_session_idx" ON "progression_steps" USING btree ("session_id") WHERE "progression_steps"."session_id" is not null;