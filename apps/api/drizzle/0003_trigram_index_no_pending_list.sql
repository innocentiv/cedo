DROP INDEX "exercises_name_trgm_idx";--> statement-breakpoint
CREATE INDEX "exercises_name_trgm_idx" ON "exercises" USING gin ("name" gin_trgm_ops) WITH (fastupdate=false);