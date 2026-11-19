-- IF NOT EXISTS: a server that already has these (an earlier build of this change) skips them
CREATE TABLE IF NOT EXISTS "program_logo" (
	"program_id" text PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL,
	"type" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "program" ADD COLUMN IF NOT EXISTS "page_plans" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "program_logo" ADD CONSTRAINT "program_logo_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
