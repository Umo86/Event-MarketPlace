CREATE TABLE "supplier_users" (
	"supplier_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'staff' NOT NULL,
	"can_refund" boolean DEFAULT false NOT NULL,
	"can_edit_catalogue" boolean DEFAULT false NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_users_supplier_id_user_id_pk" PRIMARY KEY("supplier_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"postcode" text,
	"country" text DEFAULT 'United Kingdom' NOT NULL,
	"vat_registered" boolean DEFAULT true NOT NULL,
	"vat_number" text,
	"invoice_prefix" text NOT NULL,
	"stripe_account_id" text,
	"stripe_charges_enabled" boolean DEFAULT false NOT NULL,
	"stripe_payouts_enabled" boolean DEFAULT false NOT NULL,
	"stripe_details_submitted" boolean DEFAULT false NOT NULL,
	"paused_at" timestamp with time zone,
	"paused_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_users" ADD CONSTRAINT "supplier_users_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_users" ADD CONSTRAINT "supplier_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_users_user_idx" ON "supplier_users" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_stripe_unique" ON "suppliers" USING btree ("stripe_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_invoice_prefix_unique" ON "suppliers" USING btree (upper("invoice_prefix"));--> statement-breakpoint
CREATE INDEX "suppliers_name_idx" ON "suppliers" USING btree (lower("name"));