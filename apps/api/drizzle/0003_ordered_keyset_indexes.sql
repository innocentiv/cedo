CREATE INDEX "exercises_name_id_idx" ON "exercises" USING btree ("name","id");--> statement-breakpoint
CREATE INDEX "workouts_name_id_idx" ON "workouts" USING btree ("name","id");