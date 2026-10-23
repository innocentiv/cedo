ALTER TABLE "set_logs" ADD COLUMN "idempotency_key" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "set_logs_idempotency_idx" ON "set_logs" USING btree ("session_id","idempotency_key");