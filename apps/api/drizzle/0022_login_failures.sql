CREATE TABLE "login_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"username" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "login_failures_address_at_idx" ON "login_failures" USING btree ("address","at");--> statement-breakpoint
CREATE INDEX "login_failures_address_username_at_idx" ON "login_failures" USING btree ("address","username","at");--> statement-breakpoint
CREATE INDEX "login_failures_at_idx" ON "login_failures" USING btree ("at");