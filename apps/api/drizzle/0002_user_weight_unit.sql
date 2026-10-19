CREATE TYPE "public"."weight_unit" AS ENUM('kg', 'lb');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "weight_unit" "weight_unit" DEFAULT 'kg' NOT NULL;