ALTER TABLE "partner" ADD COLUMN "email_commissions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "partner" ADD COLUMN "email_messages" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "program" ADD COLUMN "reply_to" text;