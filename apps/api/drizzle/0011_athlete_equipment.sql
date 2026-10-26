CREATE TABLE "athlete_equipment" (
	"user_id" uuid NOT NULL,
	"item" "equipment_item" NOT NULL,
	"step_g" integer,
	"min_g" integer,
	"max_g" integer,
	CONSTRAINT "athlete_equipment_user_id_item_pk" PRIMARY KEY("user_id","item"),
	CONSTRAINT "athlete_equipment_weights_ck" CHECK (("athlete_equipment"."step_g" is null and "athlete_equipment"."min_g" is null and "athlete_equipment"."max_g" is null) or ("athlete_equipment"."step_g" > 0 and "athlete_equipment"."min_g" >= 0 and ("athlete_equipment"."max_g" is null or "athlete_equipment"."max_g" >= "athlete_equipment"."min_g")))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "equipment_described_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "athlete_equipment" ADD CONSTRAINT "athlete_equipment_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;