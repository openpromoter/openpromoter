CREATE TABLE "parked_payment" (
	"workspace_id" text NOT NULL,
	"provider" text NOT NULL,
	"payment_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"event" jsonb NOT NULL,
	"test" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parked_payment_workspace_id_provider_payment_id_pk" PRIMARY KEY("workspace_id","provider","payment_id")
);
--> statement-breakpoint
CREATE INDEX "parked_payment_customer" ON "parked_payment" USING btree ("workspace_id","customer_id");