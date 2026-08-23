DROP INDEX "exercises_owner_idx";--> statement-breakpoint
CREATE INDEX "exercises_owner_name_idx" ON "exercises" USING btree ("owner_group_id","name","id");