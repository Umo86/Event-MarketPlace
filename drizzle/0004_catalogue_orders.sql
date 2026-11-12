CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"description" text,
	"image_file_id" uuid,
	"unit" text DEFAULT 'each' NOT NULL,
	"price_pence" integer NOT NULL,
	"early_price_pence" integer,
	"late_price_pence" integer,
	"vat_rate_bps" integer DEFAULT 2000 NOT NULL,
	"stock_limit" integer,
	"stand_type_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"pending_change" jsonb,
	"submitted_at" timestamp with time zone,
	"rejection_reason" text,
	"approved_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"commission_type" text,
	"commission_value" integer,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "basket_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"stand_id" uuid NOT NULL,
	"email" text NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_order_id" uuid NOT NULL,
	"stripe_dispute_id" text NOT NULL,
	"amount_pence" integer NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"evidence_due_by" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"supplier_order_id" uuid NOT NULL,
	"product_id" uuid,
	"category_id" uuid,
	"description" text NOT NULL,
	"product_code" text,
	"unit" text DEFAULT 'each' NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_pence" integer NOT NULL,
	"price_band" text NOT NULL,
	"vat_rate_bps" integer NOT NULL,
	"net_pence" integer NOT NULL,
	"vat_pence" integer NOT NULL,
	"total_pence" integer NOT NULL,
	"commission_pence" integer NOT NULL,
	"refunded_pence" integer DEFAULT 0 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"show_id" uuid NOT NULL,
	"stand_id" uuid NOT NULL,
	"email" text NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"company_name" text NOT NULL,
	"stand_number" text NOT NULL,
	"hall_name" text,
	"stand_type_name" text,
	"po_number" text,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"net_pence" integer NOT NULL,
	"vat_pence" integer NOT NULL,
	"total_pence" integer NOT NULL,
	"hold_until" timestamp with time zone NOT NULL,
	"stripe_customer_id" text,
	"stripe_setup_intent_id" text,
	"stripe_payment_method_id" text,
	"paid_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_order_id" uuid NOT NULL,
	"amount_pence" integer NOT NULL,
	"line_amounts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fee_refunded_pence" integer DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text DEFAULT 'panel' NOT NULL,
	"stripe_refund_id" text,
	"error" text,
	"credit_note_number" text,
	"credit_note_file_id" uuid,
	"requested_by" uuid,
	"by_media10" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"show_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"charge_account" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"net_pence" integer NOT NULL,
	"vat_pence" integer NOT NULL,
	"total_pence" integer NOT NULL,
	"fee_pence" integer NOT NULL,
	"refunded_pence" integer DEFAULT 0 NOT NULL,
	"fee_refunded_pence" integer DEFAULT 0 NOT NULL,
	"disputed_pence" integer DEFAULT 0 NOT NULL,
	"stripe_payment_intent_id" text,
	"stripe_charge_id" text,
	"payment_error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"invoice_number" text,
	"invoice_file_id" uuid,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "commission_type" text;--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "commission_value" integer;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "commission_type" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "commission_value" integer;--> statement-breakpoint
ALTER TABLE "show_categories" ADD COLUMN "commission_type" text;--> statement-breakpoint
ALTER TABLE "show_categories" ADD COLUMN "commission_value" integer;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_show_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."show_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "basket_items" ADD CONSTRAINT "basket_items_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "basket_items" ADD CONSTRAINT "basket_items_stand_id_stands_id_fk" FOREIGN KEY ("stand_id") REFERENCES "public"."stands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "basket_items" ADD CONSTRAINT "basket_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_supplier_order_id_supplier_orders_id_fk" FOREIGN KEY ("supplier_order_id") REFERENCES "public"."supplier_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_supplier_order_id_supplier_orders_id_fk" FOREIGN KEY ("supplier_order_id") REFERENCES "public"."supplier_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_category_id_show_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."show_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_stand_id_stands_id_fk" FOREIGN KEY ("stand_id") REFERENCES "public"."stands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_supplier_order_id_supplier_orders_id_fk" FOREIGN KEY ("supplier_order_id") REFERENCES "public"."supplier_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_credit_note_file_id_files_id_fk" FOREIGN KEY ("credit_note_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_invoice_file_id_files_id_fk" FOREIGN KEY ("invoice_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_show_idx" ON "products" USING btree ("show_id","status");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_supplier_idx" ON "products" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "basket_items_unique" ON "basket_items" USING btree ("stand_id","email","product_id");--> statement-breakpoint
CREATE INDEX "basket_items_owner_idx" ON "basket_items" USING btree ("show_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "disputes_stripe_unique" ON "disputes" USING btree ("stripe_dispute_id");--> statement-breakpoint
CREATE INDEX "order_lines_supplier_order_idx" ON "order_lines" USING btree ("supplier_order_id");--> statement-breakpoint
CREATE INDEX "order_lines_product_idx" ON "order_lines" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_number_unique" ON "orders" USING btree ("number");--> statement-breakpoint
CREATE INDEX "orders_show_idx" ON "orders" USING btree ("show_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_stand_idx" ON "orders" USING btree ("stand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_setup_intent_unique" ON "orders" USING btree ("stripe_setup_intent_id");--> statement-breakpoint
CREATE INDEX "refunds_supplier_order_idx" ON "refunds" USING btree ("supplier_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_stripe_unique" ON "refunds" USING btree ("stripe_refund_id") WHERE "refunds"."stripe_refund_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_orders_unique" ON "supplier_orders" USING btree ("order_id","supplier_id");--> statement-breakpoint
CREATE INDEX "supplier_orders_supplier_idx" ON "supplier_orders" USING btree ("supplier_id","created_at");--> statement-breakpoint
CREATE INDEX "supplier_orders_show_idx" ON "supplier_orders" USING btree ("show_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_orders_pi_unique" ON "supplier_orders" USING btree ("stripe_payment_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_orders_invoice_unique" ON "supplier_orders" USING btree ("supplier_id","invoice_number");