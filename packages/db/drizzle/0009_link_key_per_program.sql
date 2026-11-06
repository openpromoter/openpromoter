ALTER TABLE "link" DROP CONSTRAINT "link_key_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "link_program_key" ON "link" USING btree ("program_id","key");