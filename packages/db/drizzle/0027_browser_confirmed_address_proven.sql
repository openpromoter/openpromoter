-- both columns are nullable with no default: a catalog-only change, but never wait long for the lock
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "referral" ADD COLUMN "browser_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "address_proven_at" timestamp with time zone;