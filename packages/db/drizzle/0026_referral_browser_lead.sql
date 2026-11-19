-- only leads reported after this migration are flagged; existing referrals keep their current behaviour
ALTER TABLE "referral" ADD COLUMN "browser_lead" boolean DEFAULT false NOT NULL;
