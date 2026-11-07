CREATE TYPE "public"."sign_up_state" AS ENUM('first', 'open', 'closed');--> statement-breakpoint
CREATE TABLE "instance_settings" (
	"one" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"sign_up" "sign_up_state" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_settings_one_row" CHECK ("instance_settings"."one")
);--> statement-breakpoint
-- The one row (#71, ADR-0029), started from what the instance already is. With no account yet
-- (only the system user, `cedo`), `first`: the first to register becomes curator. With a curator,
-- `closed`, since someone can reopen it. With accounts but no curator, `open`, as it was: nobody
-- could reopen it.
INSERT INTO "instance_settings" ("sign_up")
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM "users" WHERE "username" <> 'cedo') THEN 'first'
  WHEN EXISTS (
    SELECT 1
      FROM "group_members" gm
      JOIN "groups" g ON g."id" = gm."group_id"
      JOIN "users" u ON u."id" = gm."user_id"
     WHERE g."slug" = 'cedo' AND gm."role" = 'editor' AND u."username" <> 'cedo'
  ) THEN 'closed'
  ELSE 'open'
END::"sign_up_state";
