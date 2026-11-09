CREATE TABLE "email_log" (
	"id" text PRIMARY KEY NOT NULL,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"program_id" text,
	"message_id" text,
	"status" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_log_created" ON "email_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "email_log_to_created" ON "email_log" USING btree ("to","created_at");--> statement-breakpoint
CREATE INDEX "email_log_message" ON "email_log" USING btree ("message_id") WHERE message_id is not null;