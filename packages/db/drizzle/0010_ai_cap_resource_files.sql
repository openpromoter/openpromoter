ALTER TABLE "resource" ADD COLUMN "file_name" text;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "file_type" text;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "file_data" "bytea";--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "ai_month" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "ai_spent_micros" integer DEFAULT 0 NOT NULL;