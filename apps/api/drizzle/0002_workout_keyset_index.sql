DROP INDEX "workouts_owner_idx";--> statement-breakpoint
CREATE INDEX "workouts_owner_name_idx" ON "workouts" USING btree ("owner_group_id","name","id");