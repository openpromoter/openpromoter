CREATE INDEX "audit_created" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "job_failed" ON "job" USING btree ("failed_at") WHERE failed_at is not null;--> statement-breakpoint
CREATE INDEX "partner_email" ON "partner" USING btree ("email");--> statement-breakpoint
CREATE INDEX "delivery_failed" ON "webhook_delivery" USING btree ("created_at") WHERE status = 'failed';