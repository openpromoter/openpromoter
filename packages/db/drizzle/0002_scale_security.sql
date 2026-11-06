-- 0002: indexes for 10M clicks / 1M conversions, a daily click rollup, a shared rate-limit table,
-- a dead-letter state for jobs, tenant-safe webhook idempotency and tier references.
-- Index builds lock writes on the table while they run (about 1 min per 10M clicks); run upgrades in a quiet window.
CREATE TABLE "click_daily" (
	"program_id" text NOT NULL,
	"partner_id" text NOT NULL,
	"day" date NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"bots" integer DEFAULT 0 NOT NULL,
	-- INCLUDE makes program/day sums index-only scans
	CONSTRAINT "click_daily_program_id_day_partner_id_pk" PRIMARY KEY("program_id","day","partner_id") INCLUDE ("clicks","bots")
);
--> statement-breakpoint
CREATE UNLOGGED TABLE "rate_limit" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "processed_event" DROP CONSTRAINT "processed_event_provider_event_id_pk";--> statement-breakpoint
ALTER TABLE "processed_event" ADD CONSTRAINT "processed_event_workspace_id_provider_event_id_pk" PRIMARY KEY("workspace_id","provider","event_id");--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "failed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "job" SET "failed_at" = now() WHERE "done_at" IS NULL AND "attempts" >= "max_attempts";--> statement-breakpoint
ALTER TABLE "click_daily" ADD CONSTRAINT "click_daily_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_daily" ADD CONSTRAINT "click_daily_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "click_daily_partner" ON "click_daily" USING btree ("partner_id","day");--> statement-breakpoint
CREATE INDEX "rate_limit_reset" ON "rate_limit" USING btree ("reset_at");--> statement-breakpoint
CREATE INDEX "agent_action_program_status" ON "agent_action" USING btree ("program_id","status");--> statement-breakpoint
CREATE INDEX "click_program_created_cov" ON "click" USING btree ("program_id","created_at") INCLUDE ("is_bot","partner_id");--> statement-breakpoint
CREATE INDEX "click_partner_created_cov" ON "click" USING btree ("partner_id","created_at") INCLUDE ("is_bot");--> statement-breakpoint
CREATE INDEX "click_visitor_created" ON "click" USING btree ("visitor_id","created_at");--> statement-breakpoint
CREATE INDEX "click_link_created" ON "click" USING btree ("link_id","created_at") WHERE link_id is not null;--> statement-breakpoint
DROP INDEX "click_program_created";--> statement-breakpoint
DROP INDEX "click_partner_created";--> statement-breakpoint
DROP INDEX "click_visitor";--> statement-breakpoint
CREATE UNIQUE INDEX "commission_program_source_key" ON "commission" USING btree ("program_id","source_key" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "commission_program_created_cov" ON "commission" USING btree ("program_id","created_at") INCLUDE ("status","amount","sale_amount");--> statement-breakpoint
CREATE INDEX "commission_partner_created" ON "commission" USING btree ("partner_id","created_at") INCLUDE ("status","amount","sale_amount");--> statement-breakpoint
CREATE INDEX "commission_program_status" ON "commission" USING btree ("program_id","status") INCLUDE ("amount","payout_id");--> statement-breakpoint
CREATE INDEX "commission_pending_hold" ON "commission" USING btree ("hold_until") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "commission_payout" ON "commission" USING btree ("payout_id") WHERE payout_id is not null;--> statement-breakpoint
DROP INDEX "commission_program_source";--> statement-breakpoint
DROP INDEX "commission_program_created";--> statement-breakpoint
DROP INDEX "commission_partner_status";--> statement-breakpoint
CREATE INDEX "fraud_flag_program_resolution" ON "fraud_flag" USING btree ("program_id","resolution");--> statement-breakpoint
CREATE INDEX "job_due" ON "job" USING btree ("run_at") WHERE done_at is null and failed_at is null;--> statement-breakpoint
CREATE INDEX "job_done" ON "job" USING btree ("done_at") WHERE done_at is not null;--> statement-breakpoint
DROP INDEX "job_ready";--> statement-breakpoint
CREATE UNIQUE INDEX "program_custom_domain_verified" ON "program" USING btree ("custom_domain") WHERE custom_domain_verified_at is not null;--> statement-breakpoint
CREATE INDEX "partner_program_lower_code" ON "partner" USING btree ("program_id",lower("code"));--> statement-breakpoint
CREATE INDEX "partner_program_status" ON "partner" USING btree ("program_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_group_id_program" ON "partner_group" USING btree ("id","program_id");--> statement-breakpoint
-- a partner's tier must belong to the partner's own program (closes cross-tenant group ids from every write path)
ALTER TABLE "partner" ADD CONSTRAINT "partner_group_same_program_fk" FOREIGN KEY ("group_id","program_id") REFERENCES "public"."partner_group"("id","program_id") ON DELETE SET NULL ("group_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payout_program_status_paid" ON "payout" USING btree ("program_id","status","paid_at") INCLUDE ("amount");--> statement-breakpoint
DROP INDEX "payout_program_status";--> statement-breakpoint
CREATE INDEX "promo_program_lower_code" ON "promo_code" USING btree ("program_id",lower("code"));--> statement-breakpoint
CREATE INDEX "referral_partner_converted" ON "referral" USING btree ("partner_id","converted_at") INCLUDE ("revenue");--> statement-breakpoint
CREATE INDEX "referral_program_converted" ON "referral" USING btree ("program_id","converted_at") INCLUDE ("partner_id") WHERE converted_at is not null;--> statement-breakpoint
CREATE INDEX "referral_program_status" ON "referral" USING btree ("program_id","status") INCLUDE ("mrr");--> statement-breakpoint
CREATE INDEX "referral_program_lower_email" ON "referral" USING btree ("program_id",lower("email"));--> statement-breakpoint
CREATE INDEX "referral_click" ON "referral" USING btree ("click_id") WHERE click_id is not null;--> statement-breakpoint
DROP INDEX "referral_partner";--> statement-breakpoint
-- click_daily is maintained by statement-level triggers, so every insert path (app, seed, imports) keeps it exact.
-- Rows are locked in key order to avoid deadlocks between concurrent bulk inserts.
CREATE FUNCTION "click_daily_ins"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "click_daily" AS d ("program_id", "partner_id", "day", "clicks", "bots")
  SELECT "program_id", "partner_id", ("created_at" AT TIME ZONE 'UTC')::date,
         count(*) FILTER (WHERE NOT "is_bot"), count(*) FILTER (WHERE "is_bot")
  FROM new_rows GROUP BY 1, 2, 3 ORDER BY 1, 3, 2
  ON CONFLICT ("program_id", "day", "partner_id")
  DO UPDATE SET "clicks" = d."clicks" + excluded."clicks", "bots" = d."bots" + excluded."bots";
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION "click_daily_del"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "click_daily" d SET "clicks" = d."clicks" - o."clicks", "bots" = d."bots" - o."bots"
  FROM (
    SELECT "program_id", "partner_id", ("created_at" AT TIME ZONE 'UTC')::date AS "day",
           count(*) FILTER (WHERE NOT "is_bot") AS "clicks", count(*) FILTER (WHERE "is_bot") AS "bots"
    FROM old_rows GROUP BY 1, 2, 3
  ) o
  WHERE d."program_id" = o."program_id" AND d."day" = o."day" AND d."partner_id" = o."partner_id";
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION "click_daily_upd"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "click_daily" d SET "clicks" = d."clicks" - o."clicks", "bots" = d."bots" - o."bots"
  FROM (
    SELECT "program_id", "partner_id", ("created_at" AT TIME ZONE 'UTC')::date AS "day",
           count(*) FILTER (WHERE NOT "is_bot") AS "clicks", count(*) FILTER (WHERE "is_bot") AS "bots"
    FROM old_rows GROUP BY 1, 2, 3
  ) o
  WHERE d."program_id" = o."program_id" AND d."day" = o."day" AND d."partner_id" = o."partner_id";
  INSERT INTO "click_daily" AS d ("program_id", "partner_id", "day", "clicks", "bots")
  SELECT "program_id", "partner_id", ("created_at" AT TIME ZONE 'UTC')::date,
         count(*) FILTER (WHERE NOT "is_bot"), count(*) FILTER (WHERE "is_bot")
  FROM new_rows GROUP BY 1, 2, 3 ORDER BY 1, 3, 2
  ON CONFLICT ("program_id", "day", "partner_id")
  DO UPDATE SET "clicks" = d."clicks" + excluded."clicks", "bots" = d."bots" + excluded."bots";
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER "click_daily_ins" AFTER INSERT ON "click" REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "click_daily_ins"();--> statement-breakpoint
CREATE TRIGGER "click_daily_del" AFTER DELETE ON "click" REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION "click_daily_del"();--> statement-breakpoint
CREATE TRIGGER "click_daily_upd" AFTER UPDATE ON "click" REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "click_daily_upd"();--> statement-breakpoint
-- backfill after the triggers exist: CREATE TRIGGER holds a lock that blocks concurrent click inserts until commit
INSERT INTO "click_daily" ("program_id", "partner_id", "day", "clicks", "bots")
SELECT "program_id", "partner_id", ("created_at" AT TIME ZONE 'UTC')::date,
       count(*) FILTER (WHERE NOT "is_bot"), count(*) FILTER (WHERE "is_bot")
FROM "click" GROUP BY 1, 2, 3;--> statement-breakpoint
-- custom-domain cache invalidation: every replica re-reads its cache when this kv row changes
CREATE FUNCTION "program_domains_changed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "kv" ("key", "value", "updated_at") VALUES ('domains:version', '{}'::jsonb, now())
  ON CONFLICT ("key") DO UPDATE SET "updated_at" = now();
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER "program_domains_changed" AFTER INSERT OR DELETE OR UPDATE OF "custom_domain", "custom_domain_verified_at", "slug" ON "program" FOR EACH STATEMENT EXECUTE FUNCTION "program_domains_changed"();
