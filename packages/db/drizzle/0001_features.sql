CREATE TABLE "event_log" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commission" ADD COLUMN "test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "partner" ADD COLUMN "commission_override" integer;--> statement-breakpoint
ALTER TABLE "partner" ADD COLUMN "vat_valid" boolean;--> statement-breakpoint
ALTER TABLE "partner" ADD COLUMN "vat_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "program" ADD COLUMN "listed_in_network" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "program" ADD COLUMN "payout_two_factor_above" integer DEFAULT 100000 NOT NULL;--> statement-breakpoint
ALTER TABLE "referral" ADD COLUMN "test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_log_ws" ON "event_log" USING btree ("workspace_id","id");