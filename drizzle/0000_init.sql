CREATE TYPE "public"."confidence_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."screening_kind" AS ENUM('one_shot', 'daily');--> statement-breakpoint
CREATE TYPE "public"."screening_status" AS ENUM('complete', 'incomplete');--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screening_id" uuid NOT NULL,
	"url_hash" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"language" text NOT NULL,
	"date" text,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"status" text NOT NULL,
	"subject" text NOT NULL,
	"identity_confidence" text NOT NULL,
	"identity_evidence" jsonb NOT NULL,
	"source_reliability" text NOT NULL,
	"risk_level" "risk_level",
	"summary" text NOT NULL,
	"corroborating_urls" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"country" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persons_identity" UNIQUE("first_name","last_name","country")
);
--> statement-breakpoint
CREATE TABLE "screenings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"risk" "risk_level" NOT NULL,
	"confidence" "confidence_level" NOT NULL,
	"status" "screening_status" NOT NULL,
	"summary" text,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"coverage_json" jsonb NOT NULL,
	"usage_json" jsonb NOT NULL,
	"cost_usd" numeric(10, 6) NOT NULL,
	"duration_ms" integer NOT NULL,
	"kind" "screening_kind" DEFAULT 'one_shot' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_screening_id_screenings_id_fk" FOREIGN KEY ("screening_id") REFERENCES "public"."screenings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenings" ADD CONSTRAINT "screenings_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "findings_screening_idx" ON "findings" USING btree ("screening_id");--> statement-breakpoint
CREATE INDEX "findings_url_hash_idx" ON "findings" USING btree ("url_hash");--> statement-breakpoint
CREATE INDEX "screenings_created_at_idx" ON "screenings" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "screenings_person_idx" ON "screenings" USING btree ("person_id","created_at");