-- One session in progress per person. Every one but each person's newest is finished first — at
-- its last logged set, or at its start when it logged none — so the index can be built.
UPDATE "workout_sessions" AS s
   SET "ended_at" = coalesce(
         (SELECT max(l."logged_at") FROM "set_logs" l WHERE l."session_id" = s."id"),
         s."started_at"
       )
 WHERE s."ended_at" IS NULL
   AND EXISTS (
         SELECT 1 FROM "workout_sessions" n
          WHERE n."user_id" = s."user_id"
            AND n."ended_at" IS NULL
            AND (n."started_at", n."id") > (s."started_at", s."id")
       );--> statement-breakpoint
CREATE UNIQUE INDEX "workout_sessions_in_progress_idx" ON "workout_sessions" USING btree ("user_id") WHERE "workout_sessions"."ended_at" is null;
