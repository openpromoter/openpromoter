ALTER TABLE "commission" ADD COLUMN "fx_rate" double precision;--> statement-breakpoint
-- rows already in their program's currency need no conversion; the worker fills the rest from ECB rates
UPDATE "commission" c SET "fx_rate" = 1 FROM "program" p WHERE p."id" = c."program_id" AND lower(c."currency") = lower(p."currency");--> statement-breakpoint
-- keep the dashboard sums index-only now that they multiply by fx_rate
DROP INDEX IF EXISTS "commission_program_created_cov";--> statement-breakpoint
CREATE INDEX "commission_program_created_cov" ON "commission" USING btree ("program_id","created_at") INCLUDE ("status","amount","sale_amount","fx_rate");--> statement-breakpoint
DROP INDEX IF EXISTS "commission_partner_created";--> statement-breakpoint
CREATE INDEX "commission_partner_created" ON "commission" USING btree ("partner_id","created_at") INCLUDE ("status","amount","sale_amount","fx_rate");--> statement-breakpoint
CREATE INDEX "commission_fx_unknown" ON "commission" USING btree ("created_at") WHERE fx_rate is null;
