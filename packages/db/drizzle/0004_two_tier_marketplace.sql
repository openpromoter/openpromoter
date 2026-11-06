ALTER TABLE "commission" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "partner" ADD COLUMN "recruited_by" text;--> statement-breakpoint
ALTER TABLE "program" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "program" ADD COLUMN "override_rate" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "commission_parent" ON "commission" USING btree ("parent_id") WHERE parent_id is not null;--> statement-breakpoint
CREATE INDEX "partner_recruited_by" ON "partner" USING btree ("recruited_by") WHERE recruited_by is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_id_program" ON "partner" USING btree ("id","program_id");--> statement-breakpoint
-- a recruiter must be another partner of the same program
ALTER TABLE "partner" ADD CONSTRAINT "partner_recruited_by_same_program" FOREIGN KEY ("recruited_by","program_id") REFERENCES "public"."partner"("id","program_id") ON DELETE SET NULL ("recruited_by");--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_not_own_recruiter" CHECK ("recruited_by" <> "id");
