-- Rest alerts by web push are removed (#38 → #39): on an iPhone they never arrived. Their device
-- registrations and the generated key pair go with them; the rest the server keeps stays.
DROP TABLE "instance_secrets" CASCADE;--> statement-breakpoint
DROP TABLE "push_subscriptions" CASCADE;--> statement-breakpoint
DROP INDEX "workout_sessions_rest_due_idx";--> statement-breakpoint
ALTER TABLE "workout_sessions" DROP COLUMN "rest_alerted_at";
