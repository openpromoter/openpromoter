CREATE TABLE "charge_link" (
	"workspace_id" text NOT NULL,
	"provider" text NOT NULL,
	"payment_id" text NOT NULL,
	"charge_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charge_link_workspace_id_provider_charge_id_pk" PRIMARY KEY("workspace_id","provider","charge_id")
);
--> statement-breakpoint
CREATE INDEX "charge_link_payment" ON "charge_link" USING btree ("payment_id");