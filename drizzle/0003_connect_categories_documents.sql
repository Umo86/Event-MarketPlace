CREATE TABLE "supplier_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"file_id" uuid NOT NULL,
	"expires_on" date,
	"reminder_sent_for" date,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "show_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"supplier_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"type" text NOT NULL,
	"account" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "kind" text DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "stripe_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_documents" ADD CONSTRAINT "supplier_documents_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_documents" ADD CONSTRAINT "supplier_documents_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_categories" ADD CONSTRAINT "show_categories_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_categories" ADD CONSTRAINT "show_categories_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_documents_supplier_idx" ON "supplier_documents" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "supplier_documents_expiry_idx" ON "supplier_documents" USING btree ("expires_on");--> statement-breakpoint
CREATE UNIQUE INDEX "show_categories_name_unique" ON "show_categories" USING btree ("show_id",lower("name"));--> statement-breakpoint
CREATE INDEX "show_categories_supplier_idx" ON "show_categories" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_one_organiser" ON "suppliers" USING btree ("kind") WHERE "suppliers"."kind" = 'organiser';