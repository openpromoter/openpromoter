ALTER TABLE "referral" ADD COLUMN "browser_lead" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- leads planted before this column existed: only the browser path stores an IP hash on a referral
UPDATE "referral" SET "browser_lead" = true WHERE "ip_hash" IS NOT NULL AND "external_customer_id" IS NULL;
