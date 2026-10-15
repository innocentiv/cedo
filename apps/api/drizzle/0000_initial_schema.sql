CREATE TYPE "public"."auth_provider" AS ENUM('local');--> statement-breakpoint
CREATE TYPE "public"."group_kind" AS ENUM('personal', 'shared');--> statement-breakpoint
CREATE TYPE "public"."group_role" AS ENUM('editor', 'reader');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('image', 'video_link');--> statement-breakpoint
CREATE TYPE "public"."muscle_region" AS ENUM('upper', 'core', 'lower');--> statement-breakpoint
CREATE TYPE "public"."tracking_mode" AS ENUM('weight_reps', 'bodyweight_reps', 'duration', 'distance_duration');--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "group_role" NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" "group_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personal_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"auth_provider" "auth_provider" DEFAULT 'local' NOT NULL,
	"external_id" text,
	"personal_group_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "media_kind" NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"payload" jsonb NOT NULL,
	"thumbnail_key" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "muscles" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"region" "muscle_region" NOT NULL,
	"sort_index" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_favourites" (
	"user_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_favourites_user_id_target_id_pk" PRIMARY KEY("user_id","target_id")
);
--> statement-breakpoint
CREATE TABLE "exercise_media" (
	"exercise_id" uuid NOT NULL,
	"owner_group_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"sort_index" smallint NOT NULL,
	CONSTRAINT "exercise_media_exercise_id_media_id_pk" PRIMARY KEY("exercise_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "exercise_muscles" (
	"exercise_id" uuid NOT NULL,
	"owner_group_id" uuid NOT NULL,
	"muscle_slug" text NOT NULL,
	"load_pct" smallint NOT NULL,
	CONSTRAINT "exercise_muscles_exercise_id_muscle_slug_pk" PRIMARY KEY("exercise_id","muscle_slug"),
	CONSTRAINT "exercise_muscles_load_pct_ck" CHECK ("exercise_muscles"."load_pct" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_group_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tracking" "tracking_mode" DEFAULT 'weight_reps' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"equipment" text,
	"is_unilateral" boolean DEFAULT false NOT NULL,
	CONSTRAINT "exercises_id_owner_uq" UNIQUE("id","owner_group_id")
);
--> statement-breakpoint
CREATE TABLE "workout_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_id" uuid NOT NULL,
	"owner_group_id" uuid NOT NULL,
	"index" smallint NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "workout_days_id_owner_uq" UNIQUE("id","owner_group_id")
);
--> statement-breakpoint
CREATE TABLE "workout_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day_id" uuid NOT NULL,
	"owner_group_id" uuid NOT NULL,
	"index" smallint NOT NULL,
	"exercise_id" uuid NOT NULL,
	"superset_group" char(1),
	"rest_seconds" integer,
	"progression" jsonb DEFAULT '{"kind":"none"}'::jsonb NOT NULL,
	CONSTRAINT "workout_entries_id_owner_uq" UNIQUE("id","owner_group_id"),
	CONSTRAINT "workout_entries_superset_ck" CHECK ("workout_entries"."superset_group" is null or "workout_entries"."superset_group" ~ '^[A-Z]$')
);
--> statement-breakpoint
CREATE TABLE "workout_favourites" (
	"user_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_favourites_user_id_target_id_pk" PRIMARY KEY("user_id","target_id")
);
--> statement-breakpoint
CREATE TABLE "workout_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"owner_group_id" uuid NOT NULL,
	"index" smallint NOT NULL,
	"is_warmup" boolean DEFAULT false NOT NULL,
	"target_reps" smallint,
	"target_weight_g" integer,
	"target_rpe" smallint,
	"target_duration_s" integer,
	"target_distance_mm" integer,
	CONSTRAINT "workout_sets_rpe_ck" CHECK ("workout_sets"."target_rpe" is null or "workout_sets"."target_rpe" between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_group_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	CONSTRAINT "workouts_id_owner_uq" UNIQUE("id","owner_group_id")
);
--> statement-breakpoint
CREATE TABLE "set_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"entry_id" uuid,
	"exercise_id" uuid NOT NULL,
	"set_index" smallint NOT NULL,
	"is_warmup" boolean DEFAULT false NOT NULL,
	"weight_g" integer,
	"reps" smallint,
	"rpe" smallint,
	"duration_s" integer,
	"distance_mm" integer,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "set_logs_rpe_ck" CHECK ("set_logs"."rpe" is null or "set_logs"."rpe" between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "workout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workout_id" uuid,
	"day_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_access_tokens" ADD CONSTRAINT "personal_access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_personal_group_id_groups_id_fk" FOREIGN KEY ("personal_group_id") REFERENCES "public"."groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_favourites" ADD CONSTRAINT "exercise_favourites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_favourites" ADD CONSTRAINT "exercise_favourites_target_id_exercises_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_media" ADD CONSTRAINT "exercise_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_media" ADD CONSTRAINT "exercise_media_exercise_fk" FOREIGN KEY ("exercise_id","owner_group_id") REFERENCES "public"."exercises"("id","owner_group_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "exercise_muscles" ADD CONSTRAINT "exercise_muscles_muscle_slug_muscles_slug_fk" FOREIGN KEY ("muscle_slug") REFERENCES "public"."muscles"("slug") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_muscles" ADD CONSTRAINT "exercise_muscles_exercise_fk" FOREIGN KEY ("exercise_id","owner_group_id") REFERENCES "public"."exercises"("id","owner_group_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_owner_group_id_groups_id_fk" FOREIGN KEY ("owner_group_id") REFERENCES "public"."groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_days" ADD CONSTRAINT "workout_days_workout_fk" FOREIGN KEY ("workout_id","owner_group_id") REFERENCES "public"."workouts"("id","owner_group_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workout_entries" ADD CONSTRAINT "workout_entries_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_entries" ADD CONSTRAINT "workout_entries_day_fk" FOREIGN KEY ("day_id","owner_group_id") REFERENCES "public"."workout_days"("id","owner_group_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workout_favourites" ADD CONSTRAINT "workout_favourites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_favourites" ADD CONSTRAINT "workout_favourites_target_id_workouts_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_entry_fk" FOREIGN KEY ("entry_id","owner_group_id") REFERENCES "public"."workout_entries"("id","owner_group_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_owner_group_id_groups_id_fk" FOREIGN KEY ("owner_group_id") REFERENCES "public"."groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_entry_id_workout_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."workout_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_day_id_workout_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."workout_days"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_members_user_idx" ON "group_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_slug_idx" ON "groups" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "pats_token_hash_idx" ON "personal_access_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "pats_user_idx" ON "personal_access_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_idx" ON "users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "users_external_idx" ON "users" USING btree ("auth_provider","external_id") WHERE "users"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "media_created_by_idx" ON "media" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "muscles_region_idx" ON "muscles" USING btree ("region","sort_index");--> statement-breakpoint
CREATE INDEX "exercise_muscles_muscle_idx" ON "exercise_muscles" USING btree ("muscle_slug");--> statement-breakpoint
CREATE INDEX "exercises_owner_name_idx" ON "exercises" USING btree ("owner_group_id","name","id");--> statement-breakpoint
CREATE INDEX "exercises_name_id_idx" ON "exercises" USING btree ("name","id");--> statement-breakpoint
CREATE INDEX "exercises_name_trgm_idx" ON "exercises" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "workout_days_workout_idx" ON "workout_days" USING btree ("workout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_days_order_idx" ON "workout_days" USING btree ("workout_id","index");--> statement-breakpoint
CREATE INDEX "workout_entries_day_idx" ON "workout_entries" USING btree ("day_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_entries_order_idx" ON "workout_entries" USING btree ("day_id","index");--> statement-breakpoint
CREATE INDEX "workout_sets_entry_idx" ON "workout_sets" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_sets_order_idx" ON "workout_sets" USING btree ("entry_id","index");--> statement-breakpoint
CREATE INDEX "workouts_owner_name_idx" ON "workouts" USING btree ("owner_group_id","name","id");--> statement-breakpoint
CREATE INDEX "workouts_name_id_idx" ON "workouts" USING btree ("name","id");--> statement-breakpoint
CREATE INDEX "set_logs_exercise_time_idx" ON "set_logs" USING btree ("exercise_id","logged_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "set_logs_session_idx" ON "set_logs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "set_logs_entry_idx" ON "set_logs" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "workout_sessions_user_time_idx" ON "workout_sessions" USING btree ("user_id","started_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "workout_sessions_workout_idx" ON "workout_sessions" USING btree ("workout_id");