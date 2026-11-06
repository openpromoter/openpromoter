ALTER TABLE "program" ADD COLUMN "payout_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "program" SET "payout_seq" = coalesce((SELECT max(substring("invoice_number" from 4)::int) FROM "payout" WHERE "payout"."program_id" = "program"."id" AND "invoice_number" ~ '^OP-[0-9]+$'), 0);
