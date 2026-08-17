CREATE TYPE "public"."account_type" AS ENUM('asset', 'liability', 'equity', 'revenue', 'expense');--> statement-breakpoint
CREATE TYPE "public"."activity_type" AS ENUM('anruf', 'email', 'notiz', 'meeting', 'brief', 'besichtigung', 'wartung');--> statement-breakpoint
CREATE TYPE "public"."app_role" AS ENUM('admin', 'property_manager', 'finance', 'viewer', 'tester');--> statement-breakpoint
CREATE TYPE "public"."budget_status" AS ENUM('entwurf', 'eingereicht', 'genehmigt', 'abgelehnt');--> statement-breakpoint
CREATE TYPE "public"."demo_status" AS ENUM('pending', 'activated', 'expired', 'converted');--> statement-breakpoint
CREATE TYPE "public"."document_category" AS ENUM('vertrag', 'rechnung', 'bescheid', 'protokoll', 'korrespondenz', 'abrechnung', 'mahnung', 'kaution', 'uebergabe', 'sonstiges');--> statement-breakpoint
CREATE TYPE "public"."ea_booking_type" AS ENUM('einnahme', 'ausgabe');--> statement-breakpoint
CREATE TYPE "public"."expense_category" AS ENUM('betriebskosten_umlagefaehig', 'instandhaltung');--> statement-breakpoint
CREATE TYPE "public"."expense_type" AS ENUM('versicherung', 'grundsteuer', 'muellabfuhr', 'wasser_abwasser', 'heizung', 'strom_allgemein', 'hausbetreuung', 'lift', 'gartenpflege', 'schneeraeumung', 'verwaltung', 'ruecklage', 'reparatur', 'sanierung', 'sonstiges');--> statement-breakpoint
CREATE TYPE "public"."fiscal_period_status" AS ENUM('open', 'in_review', 'closed');--> statement-breakpoint
CREATE TYPE "public"."heat_billing_status" AS ENUM('entwurf', 'berechnet', 'geprueft', 'versendet', 'storniert');--> statement-breakpoint
CREATE TYPE "public"."heat_meter_type" AS ENUM('hkv', 'waermemengenzaehler', 'warmwasserzaehler');--> statement-breakpoint
CREATE TYPE "public"."heating_settlement_status" AS ENUM('entwurf', 'berechnet', 'versendet', 'abgeschlossen');--> statement-breakpoint
CREATE TYPE "public"."invite_status" AS ENUM('pending', 'accepted', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('offen', 'bezahlt', 'teilbezahlt', 'ueberfaellig');--> statement-breakpoint
CREATE TYPE "public"."key_status" AS ENUM('vorhanden', 'ausgegeben', 'verloren', 'gesperrt');--> statement-breakpoint
CREATE TYPE "public"."key_type" AS ENUM('hauptschluessel', 'wohnungsschluessel', 'kellerschluessel', 'garagenschluessel', 'briefkastenschluessel', 'sonstiges');--> statement-breakpoint
CREATE TYPE "public"."lease_status" AS ENUM('aktiv', 'beendet', 'gekuendigt');--> statement-breakpoint
CREATE TYPE "public"."management_type" AS ENUM('mietverwaltung', 'weg');--> statement-breakpoint
CREATE TYPE "public"."meter_type" AS ENUM('strom', 'gas', 'wasser', 'heizung', 'warmwasser', 'sonstiges');--> statement-breakpoint
CREATE TYPE "public"."mrg_bk_kategorie" AS ENUM('wasserversorgung', 'abwasserentsorgung', 'muellabfuhr', 'kanalraeumung', 'hausreinigung', 'hausbetreuung', 'rauchfangkehrer', 'schaedlingsbekaempfung', 'lichtkosten', 'beleuchtung', 'feuerversicherung', 'haftpflichtversicherung', 'leitungswasserschaden', 'sturmschaden', 'glasversicherung', 'grundsteuer', 'verwaltung', 'sonstige');--> statement-breakpoint
CREATE TYPE "public"."owner_change_rechtsgrund" AS ENUM('kauf', 'schenkung', 'erbschaft', 'zwangsversteigerung', 'einbringung');--> statement-breakpoint
CREATE TYPE "public"."owner_change_status" AS ENUM('entwurf', 'grundbuch_eingetragen', 'abgeschlossen');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('active', 'past_due', 'canceled', 'unpaid');--> statement-breakpoint
CREATE TYPE "public"."payment_type" AS ENUM('sepa', 'ueberweisung', 'bar', 'sonstiges');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('entwurf', 'berechnet', 'versendet', 'abgeschlossen');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trial', 'active', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."subscription_tier" AS ENUM('starter', 'professional', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('aktiv', 'leerstand', 'beendet');--> statement-breakpoint
CREATE TYPE "public"."unit_type" AS ENUM('wohnung', 'geschaeft', 'garage', 'stellplatz', 'lager', 'sonstiges');--> statement-breakpoint
CREATE TYPE "public"."user_subscription_tier" AS ENUM('trial', 'inactive', 'starter', 'pro', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."white_label_inquiry_status" AS ENUM('neu', 'kontaktiert', 'demo_vereinbart', 'verhandlung', 'abgeschlossen', 'abgelehnt');--> statement-breakpoint
CREATE TYPE "public"."white_label_license_status" AS ENUM('aktiv', 'gekuendigt', 'pausiert', 'abgelaufen');--> statement-breakpoint
CREATE TABLE "account_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"parent_id" uuid,
	"is_system" boolean DEFAULT false,
	"default_distribution_key_id" uuid,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_id" uuid,
	"unit_id" uuid,
	"tenant_id" uuid,
	"type" "activity_type" NOT NULL,
	"subject" text NOT NULL,
	"description" text,
	"contact_person" text,
	"created_by" text,
	"due_date" date,
	"completed" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"run_id" text,
	"table_name" text NOT NULL,
	"record_id" text,
	"action" text NOT NULL,
	"old_data" jsonb,
	"new_data" jsonb,
	"details" jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "automation_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"details" text,
	"items_processed" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "automation_rule_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"organization_id" uuid,
	"is_dry_run" boolean DEFAULT false NOT NULL,
	"trigger_data" jsonb,
	"matched_items" integer,
	"actions_preview" jsonb,
	"actions_executed" jsonb,
	"status" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger_type" text NOT NULL,
	"conditions" jsonb,
	"actions" jsonb,
	"is_active" boolean DEFAULT false,
	"last_run" timestamp with time zone,
	"run_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "automation_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"auto_invoicing_enabled" boolean DEFAULT false,
	"invoicing_day_of_month" integer DEFAULT 1,
	"auto_invoicing_email" boolean DEFAULT true,
	"auto_sepa_generation" boolean DEFAULT false,
	"auto_dunning_enabled" boolean DEFAULT false,
	"dunning_days_1" integer DEFAULT 14,
	"dunning_days_2" integer DEFAULT 28,
	"dunning_days_3" integer DEFAULT 42,
	"auto_dunning_email" boolean DEFAULT true,
	"dunning_interest_rate" text DEFAULT '4.00',
	"last_invoicing_run" timestamp with time zone,
	"last_dunning_run" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"property_id" uuid,
	"account_name" text NOT NULL,
	"iban" text,
	"bic" text,
	"bank_name" text,
	"opening_balance" numeric(10, 2) DEFAULT '0',
	"opening_balance_date" date,
	"current_balance" numeric(10, 2) DEFAULT '0',
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "booking_number_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"current_year" integer NOT NULL,
	"current_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chart_of_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"account_number" text NOT NULL,
	"name" text NOT NULL,
	"account_type" "account_type" NOT NULL,
	"description" text,
	"parent_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"consent_type" text NOT NULL,
	"consent_version" text DEFAULT '1.0' NOT NULL,
	"granted" boolean DEFAULT false NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"legal_basis" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contractors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"company_name" text NOT NULL,
	"contact_person" text,
	"email" text,
	"phone" text,
	"mobile" text,
	"address" text,
	"city" text,
	"postal_code" text,
	"iban" text,
	"bic" text,
	"specializations" text[],
	"rating" integer,
	"notes" text,
	"is_active" boolean DEFAULT true,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "damage_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"property_id" uuid,
	"unit_id" uuid,
	"tenant_id" uuid,
	"reported_by_id" uuid,
	"report_number" text NOT NULL,
	"category" text NOT NULL,
	"urgency" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'gemeldet' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"location" text,
	"photo_urls" text[],
	"assigned_to_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"cost_estimate" numeric,
	"actual_cost" numeric,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "data_retention_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"data_category" text NOT NULL,
	"retention_days" integer NOT NULL,
	"legal_basis" text NOT NULL,
	"auto_delete" boolean DEFAULT false,
	"notify_before_days" integer DEFAULT 30,
	"last_executed_at" timestamp with time zone,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "deadlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"property_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"deadline_date" date NOT NULL,
	"reminder_days" integer DEFAULT 14,
	"reminder_sent_at" timestamp with time zone,
	"category" text DEFAULT 'sonstiges',
	"source_type" text,
	"source_id" uuid,
	"is_recurring" boolean DEFAULT false,
	"recurrence_months" integer,
	"status" text DEFAULT 'offen',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "demo_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"token" text NOT NULL,
	"status" "demo_status" DEFAULT 'pending',
	"expires_at" timestamp with time zone NOT NULL,
	"activated_at" timestamp with time zone,
	"demo_ends_at" timestamp with time zone,
	"user_id" uuid,
	"organization_id" uuid,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "demo_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "depreciation_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"acquisition_date" date NOT NULL,
	"acquisition_cost" numeric(12, 2) NOT NULL,
	"useful_life_years" integer NOT NULL,
	"depreciation_rate" numeric(5, 2) NOT NULL,
	"accumulated_depreciation" numeric(12, 2) DEFAULT '0' NOT NULL,
	"book_value" numeric(12, 2) NOT NULL,
	"account_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "distribution_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"property_id" uuid,
	"key_code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"formula" text DEFAULT 'flaeche',
	"unit" text DEFAULT 'm²',
	"input_type" text DEFAULT 'flaeche',
	"included_unit_types" text[],
	"is_system" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"mrg_konform" boolean DEFAULT true,
	"mrg_paragraph" text,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_tag_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" text NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" text NOT NULL,
	"organization_id" uuid,
	"version_number" integer NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"storage_path" text NOT NULL,
	"uploaded_by" uuid,
	"change_note" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ea_bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_id" uuid,
	"type" "ea_booking_type" NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '20',
	"net_amount" numeric(10, 2),
	"tax_amount" numeric(10, 2),
	"document_ref" text,
	"beleg_nummer" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ebics_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"bank_name" text NOT NULL,
	"host_id" text NOT NULL,
	"host_url" text NOT NULL,
	"partner_id" text NOT NULL,
	"user_id" text NOT NULL,
	"iban" text NOT NULL,
	"bic" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"key_initialized" boolean DEFAULT false NOT NULL,
	"last_sync_at" timestamp with time zone,
	"encrypted_keys" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ebics_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_type" text NOT NULL,
	"order_status" text DEFAULT 'pending' NOT NULL,
	"request_data" text,
	"response_data" text,
	"error_message" text,
	"transaction_count" integer DEFAULT 0,
	"total_amount" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ebics_payment_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"batch_type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"payment_count" integer DEFAULT 0 NOT NULL,
	"total_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"sepa_xml" text,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "energy_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"property_id" uuid NOT NULL,
	"certificate_type" text NOT NULL,
	"energy_class" text,
	"heating_demand" numeric,
	"primary_energy_demand" numeric,
	"co2_emissions" numeric,
	"valid_from" date,
	"valid_until" date,
	"issuer" text,
	"certificate_number" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "energy_consumption" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"property_id" uuid NOT NULL,
	"unit_id" uuid,
	"year" integer NOT NULL,
	"month" integer,
	"energy_type" text NOT NULL,
	"consumption" numeric NOT NULL,
	"unit" text NOT NULL,
	"cost_eur" numeric,
	"co2_kg" numeric,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "expense_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"allocated_net" numeric(12, 2) NOT NULL,
	"allocation_basis" varchar(50) NOT NULL,
	"allocation_detail" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"category" "expense_category" NOT NULL,
	"expense_type" "expense_type" DEFAULT 'sonstiges',
	"bezeichnung" text NOT NULL,
	"betrag" numeric(10, 2) DEFAULT '0',
	"datum" date NOT NULL,
	"beleg_nummer" text,
	"beleg_url" text,
	"notes" text,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"mrg_kategorie" "mrg_bk_kategorie",
	"mrg_paragraph" text,
	"ist_umlagefaehig" boolean DEFAULT true,
	"distribution_key_id" uuid,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fiscal_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_id" uuid,
	"year" integer NOT NULL,
	"status" "fiscal_period_status" DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"depreciation_booked" boolean DEFAULT false NOT NULL,
	"accruals_reviewed" boolean DEFAULT false NOT NULL,
	"balance_reviewed" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guided_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"user_id" uuid,
	"workflow_type" text NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"total_steps" integer NOT NULL,
	"step_data" jsonb DEFAULT '{}',
	"status" text DEFAULT 'in_progress' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "heat_billing_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"action" text NOT NULL,
	"field" text,
	"old_value" text,
	"new_value" text,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "heat_billing_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"unit_id" uuid NOT NULL,
	"tenant_name" text,
	"area_m2" numeric(10, 2) NOT NULL,
	"mea" numeric(10, 6),
	"occupancy" integer DEFAULT 1,
	"heating_meter_type" "heat_meter_type",
	"heating_meter_value" numeric(12, 4),
	"heating_meter_missing" boolean DEFAULT false,
	"hot_water_meter_value" numeric(12, 4),
	"hot_water_meter_missing" boolean DEFAULT false,
	"heating_consumption_share" numeric(12, 2),
	"heating_area_share" numeric(12, 2),
	"heating_total" numeric(12, 2),
	"hot_water_consumption_share" numeric(12, 2),
	"hot_water_area_share" numeric(12, 2),
	"hot_water_total" numeric(12, 2),
	"maintenance_share" numeric(12, 2),
	"meter_reading_share" numeric(12, 2),
	"total_cost" numeric(12, 2),
	"prepayment" numeric(12, 2) DEFAULT '0',
	"balance" numeric(12, 2),
	"is_estimated" boolean DEFAULT false,
	"estimation_reason" text,
	"plausibility_flags" jsonb
);
--> statement-breakpoint
CREATE TABLE "heat_billing_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"status" "heat_billing_status" DEFAULT 'entwurf',
	"version" integer DEFAULT 1,
	"parent_run_id" integer,
	"heating_supply_cost" numeric(12, 2) NOT NULL,
	"hot_water_supply_cost" numeric(12, 2) DEFAULT '0',
	"maintenance_cost" numeric(12, 2) DEFAULT '0',
	"meter_reading_cost" numeric(12, 2) DEFAULT '0',
	"heating_consumption_share_pct" numeric(5, 2) DEFAULT '65',
	"heating_area_share_pct" numeric(5, 2) DEFAULT '35',
	"hot_water_consumption_share_pct" numeric(5, 2) DEFAULT '65',
	"hot_water_area_share_pct" numeric(5, 2) DEFAULT '35',
	"rounding_method" text DEFAULT 'kaufmaennisch',
	"rest_cent_rule" text DEFAULT 'assign_to_largest_share',
	"total_distributed" numeric(12, 2),
	"trial_balance_diff" numeric(12, 4),
	"compliance_check_result" jsonb,
	"warnings" jsonb,
	"computed_at" timestamp with time zone,
	"computed_by" text,
	"storno_reason" text,
	"storno_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "heating_cost_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"property_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"consumption" numeric(12, 4) DEFAULT '0',
	"consumption_unit" text DEFAULT 'kWh',
	"cost_share" numeric(12, 2) DEFAULT '0',
	"source" text DEFAULT 'manual',
	"provider" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "heating_settlement_details" (
	"id" serial PRIMARY KEY NOT NULL,
	"settlement_id" integer NOT NULL,
	"unit_id" uuid NOT NULL,
	"tenant_name" text,
	"area" numeric(10, 2) NOT NULL,
	"consumption" numeric(10, 2) NOT NULL,
	"fixed_amount" numeric(10, 2) NOT NULL,
	"variable_amount" numeric(10, 2) NOT NULL,
	"total_amount" numeric(10, 2) NOT NULL,
	"prepayment" numeric(10, 2) DEFAULT '0',
	"balance" numeric(10, 2)
);
--> statement-breakpoint
CREATE TABLE "heating_settlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"total_cost" numeric(10, 2) NOT NULL,
	"fixed_cost_share" numeric(5, 2) DEFAULT '45',
	"variable_cost_share" numeric(5, 2) DEFAULT '55',
	"status" "heating_settlement_status" DEFAULT 'entwurf',
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"organization_id" uuid,
	"endpoint" text,
	"request_hash" text,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"expires_at" timestamp with time zone,
	CONSTRAINT "idempotency_keys_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "insurance_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"insurance_policy_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"unit_id" uuid,
	"claim_date" date NOT NULL,
	"description" text NOT NULL,
	"damage_amount" numeric(12, 2),
	"reimbursed_amount" numeric(12, 2) DEFAULT '0',
	"status" text DEFAULT 'gemeldet',
	"claim_number" text,
	"document_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "insurance_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"property_id" uuid NOT NULL,
	"insurance_type" text DEFAULT 'gebaeudeversicherung',
	"provider" text NOT NULL,
	"policy_number" text,
	"coverage_amount" numeric(12, 2),
	"annual_premium" numeric(12, 2),
	"start_date" date NOT NULL,
	"end_date" date,
	"auto_renew" boolean DEFAULT true,
	"contact_person" text,
	"contact_phone" text,
	"contact_email" text,
	"document_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"unit_id" uuid,
	"line_type" varchar(50) NOT NULL,
	"description" text,
	"normalized_description" text,
	"amount" numeric(12, 2) NOT NULL,
	"tax_rate" integer DEFAULT 0,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "invoice_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"period" text NOT NULL,
	"initiated_by" uuid,
	"status" text DEFAULT 'started' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "invoice_runs_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "job_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(100) NOT NULL,
	"payload" jsonb DEFAULT '{}',
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error" text,
	"attempts" integer DEFAULT 0,
	"max_attempts" integer DEFAULT 3,
	"organization_id" uuid,
	"created_by" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"booking_number" text NOT NULL,
	"entry_date" date NOT NULL,
	"description" text NOT NULL,
	"beleg_nummer" text,
	"beleg_url" text,
	"source_type" text,
	"source_id" uuid,
	"property_id" uuid,
	"unit_id" uuid,
	"tenant_id" uuid,
	"is_storno" boolean DEFAULT false NOT NULL,
	"storno_of" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entry_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" numeric(12, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(12, 2) DEFAULT '0' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kautionen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"tenant_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"lease_id" uuid,
	"betrag" numeric(12, 2) NOT NULL,
	"eingangsdatum" date,
	"treuhandkonto_iban" text,
	"treuhandkonto_bank" text,
	"zinssatz" numeric(5, 3) DEFAULT '0',
	"aufgelaufene_zinsen" numeric(12, 2) DEFAULT '0',
	"letzte_zinsberechnung" date,
	"status" text DEFAULT 'aktiv',
	"rueckzahlungsdatum" date,
	"rueckzahlungsbetrag" numeric(12, 2),
	"einbehalten_betrag" numeric(12, 2) DEFAULT '0',
	"einbehalten_grund" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "kautions_bewegungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kaution_id" uuid NOT NULL,
	"datum" date NOT NULL,
	"betrag" numeric(12, 2) NOT NULL,
	"typ" text NOT NULL,
	"beschreibung" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "key_handovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_inventory_id" uuid NOT NULL,
	"tenant_id" uuid,
	"recipient_name" text,
	"handover_date" date NOT NULL,
	"return_date" date,
	"quantity" integer DEFAULT 1,
	"status" "key_status" DEFAULT 'ausgegeben',
	"handover_protocol" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "key_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"unit_id" uuid,
	"key_type" "key_type" NOT NULL,
	"key_number" text,
	"description" text,
	"total_count" integer DEFAULT 1,
	"available_count" integer DEFAULT 1,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "learned_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"pattern" text NOT NULL,
	"unit_id" uuid,
	"tenant_id" uuid,
	"match_count" integer DEFAULT 1,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"grundmiete" numeric(10, 2) NOT NULL,
	"betriebskosten_vorschuss" numeric(10, 2) DEFAULT '0',
	"heizungskosten_vorschuss" numeric(10, 2) DEFAULT '0',
	"wasserkosten_vorschuss" numeric(10, 2) DEFAULT '0',
	"kaution" numeric(10, 2),
	"kaution_bezahlt" boolean DEFAULT false,
	"status" "lease_status" DEFAULT 'aktiv',
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "letter_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"name" text NOT NULL,
	"category" text DEFAULT 'allgemein',
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"ip_address" text,
	"success" boolean DEFAULT false NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "maintenance_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"property_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"contract_type" text DEFAULT 'wartung',
	"contractor_name" text,
	"contractor_contact" text,
	"contractor_email" text,
	"contract_fee" numeric(10, 2),
	"interval_months" integer DEFAULT 12,
	"next_due_date" date NOT NULL,
	"last_maintenance_date" date,
	"reminder_days" integer DEFAULT 14,
	"reminder_sent_at" timestamp with time zone,
	"document_url" text,
	"notes" text,
	"is_active" boolean DEFAULT true,
	"estimated_cost" numeric(10, 2),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "maintenance_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"property_id" uuid NOT NULL,
	"unit_id" uuid,
	"contract_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'reparatur',
	"priority" text DEFAULT 'normal',
	"status" text DEFAULT 'open',
	"due_date" date,
	"completed_at" timestamp with time zone,
	"contractor_name" text,
	"contractor_contact" text,
	"estimated_cost" numeric(10, 2),
	"actual_cost" numeric(10, 2),
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "management_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"property_id" uuid,
	"owner_name" text,
	"contract_type" text DEFAULT 'hausverwaltung',
	"title" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"auto_renew" boolean DEFAULT true,
	"renewal_months" integer DEFAULT 12,
	"notice_period_months" integer DEFAULT 3,
	"notice_deadline" text,
	"monthly_fee" numeric(10, 2),
	"fee_type" text DEFAULT 'pro_einheit',
	"notes" text,
	"document_url" text,
	"status" text DEFAULT 'aktiv',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"recipient_type" text DEFAULT 'internal',
	"recipient_email" text,
	"message_type" text,
	"subject" text,
	"message_body" text,
	"status" text DEFAULT 'draft',
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "meter_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meter_id" uuid NOT NULL,
	"reading_date" date NOT NULL,
	"reading_value" numeric(12, 3) NOT NULL,
	"is_estimated" boolean DEFAULT false,
	"read_by" text,
	"image_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "meters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"property_id" uuid,
	"meter_number" text NOT NULL,
	"meter_type" "meter_type" NOT NULL,
	"location" text,
	"is_active" boolean DEFAULT true,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "monthly_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"unit_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"grundmiete" numeric(10, 2) DEFAULT '0',
	"betriebskosten" numeric(10, 2) DEFAULT '0',
	"heizungskosten" numeric(10, 2) DEFAULT '0',
	"wasserkosten" numeric(10, 2) DEFAULT '0',
	"ust_satz_miete" integer DEFAULT 10,
	"ust_satz_bk" integer DEFAULT 10,
	"ust_satz_heizung" integer DEFAULT 20,
	"ust_satz_wasser" integer DEFAULT 10,
	"ust" numeric(10, 2) DEFAULT '0',
	"gesamtbetrag" numeric(10, 2) DEFAULT '0',
	"status" "invoice_status" DEFAULT 'offen',
	"faellig_am" date,
	"pdf_url" text,
	"is_vacancy" boolean DEFAULT false,
	"weg_budget_plan_id" uuid,
	"owner_id" uuid,
	"vortrag_miete" numeric(10, 2) DEFAULT '0',
	"vortrag_bk" numeric(10, 2) DEFAULT '0',
	"vortrag_hk" numeric(10, 2) DEFAULT '0',
	"vortrag_sonstige" numeric(10, 2) DEFAULT '0',
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "organization_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "app_role" NOT NULL,
	"token" text NOT NULL,
	"status" "invite_status" DEFAULT 'pending',
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "organization_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"subscription_tier" "subscription_tier" DEFAULT 'starter',
	"subscription_status" "subscription_status" DEFAULT 'trial',
	"trial_ends_at" timestamp with time zone,
	"iban" text,
	"bic" text,
	"address" text,
	"city" text,
	"postal_code" text,
	"phone" text,
	"email" text,
	"brand_name" text,
	"logo_url" text,
	"primary_color" text,
	"support_email" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "owner_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"property_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"total_income" numeric(12, 2) DEFAULT '0',
	"total_expenses" numeric(12, 2) DEFAULT '0',
	"management_fee" numeric(12, 2) DEFAULT '0',
	"net_payout" numeric(12, 2) DEFAULT '0',
	"status" text DEFAULT 'entwurf',
	"pdf_url" text,
	"sepa_exported_at" timestamp with time zone,
	"email_sent_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "owner_portal_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"invite_token" text,
	"invite_expires_at" timestamp with time zone,
	"is_active" boolean DEFAULT true,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"company_name" text,
	"email" text,
	"phone" text,
	"mobile_phone" text,
	"address" text,
	"city" text,
	"postal_code" text,
	"country" text DEFAULT 'Österreich',
	"iban" text,
	"bic" text,
	"bank_name" text,
	"tax_number" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "password_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "password_reset_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"applied_amount" numeric(10, 2) NOT NULL,
	"allocation_type" text DEFAULT 'miete',
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid,
	"betrag" numeric(10, 2) NOT NULL,
	"buchungs_datum" date NOT NULL,
	"payment_type" "payment_type" DEFAULT 'ueberweisung',
	"verwendungszweck" text,
	"transaction_id" uuid,
	"notizen" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "processing_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"name" text NOT NULL,
	"purpose" text NOT NULL,
	"legal_basis" text NOT NULL,
	"data_categories" text[] NOT NULL,
	"data_subjects" text[] NOT NULL,
	"recipients" text[],
	"third_country_transfer" boolean DEFAULT false,
	"transfer_safeguards" text,
	"retention_period" text NOT NULL,
	"technical_measures" text[],
	"organizational_measures" text[],
	"responsible_person" text,
	"dpia_conducted" boolean DEFAULT false,
	"dpia_date" date,
	"is_active" boolean DEFAULT true,
	"last_review_date" date,
	"next_review_date" date,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"full_name" text,
	"organization_id" uuid,
	"avatar_url" text,
	"phone" text,
	"subscription_tier" "user_subscription_tier" DEFAULT 'trial',
	"trial_ends_at" timestamp with time zone,
	"subscription_ends_at" timestamp with time zone,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"payment_status" "payment_status" DEFAULT 'active',
	"payment_failed_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"ki_autopilot_active" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "profiles_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"management_type" "management_type" DEFAULT 'mietverwaltung' NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"postal_code" text NOT NULL,
	"total_units" integer DEFAULT 0,
	"total_area" numeric(10, 2),
	"construction_year" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "property_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"organization_id" uuid,
	"year" integer NOT NULL,
	"position_1_name" text,
	"position_1_amount" numeric(12, 2) DEFAULT '0',
	"position_2_name" text,
	"position_2_amount" numeric(12, 2) DEFAULT '0',
	"position_3_name" text,
	"position_3_amount" numeric(12, 2) DEFAULT '0',
	"position_4_name" text,
	"position_4_amount" numeric(12, 2) DEFAULT '0',
	"position_5_name" text,
	"position_5_amount" numeric(12, 2) DEFAULT '0',
	"status" "budget_status" DEFAULT 'entwurf',
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "property_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"organization_id" uuid,
	"name" text NOT NULL,
	"category" "document_category" DEFAULT 'sonstiges',
	"file_url" text,
	"file_size" integer,
	"mime_type" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "property_managers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "property_owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"ownership_share" numeric(5, 2) DEFAULT '100.00',
	"valid_from" date,
	"valid_to" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "reconcile_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" text NOT NULL,
	"type" text DEFAULT 'batch_upsert' NOT NULL,
	"status" text DEFAULT 'started' NOT NULL,
	"inserted" integer DEFAULT 0,
	"updated" integer DEFAULT 0,
	"skipped" integer DEFAULT 0,
	"errors" integer DEFAULT 0,
	"total_rows" integer DEFAULT 0,
	"error" text,
	"meta" jsonb,
	"started_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "reconcile_runs_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "rent_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_until" date,
	"grundmiete" numeric(10, 2) NOT NULL,
	"betriebskosten_vorschuss" numeric(10, 2) NOT NULL,
	"heizungskosten_vorschuss" numeric(10, 2) NOT NULL,
	"wasserkosten_vorschuss" numeric(10, 2) DEFAULT '0',
	"change_reason" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"report_type" text NOT NULL,
	"schedule" text NOT NULL,
	"property_id" uuid,
	"recipients" text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_run" timestamp with time zone,
	"next_run" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "saved_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"report_config" jsonb NOT NULL,
	"created_by" uuid,
	"is_shared" boolean DEFAULT false,
	"last_run" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "security_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"device_type" text,
	"browser" text,
	"os" text,
	"location" text,
	"is_active" boolean DEFAULT true,
	"last_activity_at" timestamp with time zone DEFAULT now(),
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sepa_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"month" integer NOT NULL,
	"year" integer NOT NULL,
	"total_amount" numeric(10, 2) DEFAULT '0',
	"tenant_count" integer DEFAULT 0,
	"status" text DEFAULT 'draft',
	"xml_content" text,
	"file_name" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "serial_letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"property_id" uuid,
	"template_id" uuid,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"recipient_count" integer DEFAULT 0,
	"sent_via" text DEFAULT 'pdf',
	"sent_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "settlement_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"anteil" numeric(10, 4) DEFAULT '0',
	"ausgaben_anteil" numeric(10, 2) DEFAULT '0',
	"vorschuss" numeric(10, 2) DEFAULT '0',
	"differenz" numeric(10, 2) DEFAULT '0',
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"status" "settlement_status" DEFAULT 'entwurf',
	"gesamtausgaben" numeric(10, 2) DEFAULT '0',
	"gesamtvorschuss" numeric(10, 2) DEFAULT '0',
	"differenz" numeric(10, 2) DEFAULT '0',
	"berechnungs_datum" timestamp with time zone,
	"versand_datum" timestamp with time zone,
	"pdf_url" text,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "signature_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" text NOT NULL,
	"document_name" text NOT NULL,
	"requested_by" uuid,
	"status" text DEFAULT 'pending',
	"signature_type" text DEFAULT 'simple',
	"created_at" timestamp with time zone DEFAULT now(),
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"signer_id" uuid,
	"signer_name" text NOT NULL,
	"signer_email" text NOT NULL,
	"signed_at" timestamp with time zone,
	"ip_address" text,
	"user_agent" text,
	"signature_hash" text,
	"signature_data" text,
	"verification_code" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"tenant_id" uuid,
	"unit_id" uuid,
	"property_id" uuid,
	"created_by_id" uuid,
	"assigned_to_id" uuid,
	"ticket_number" text NOT NULL,
	"category" text NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'offen' NOT NULL,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"resolution" text,
	"resolved_at" timestamp with time zone,
	"due_date" date,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tenant_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organization_id" uuid,
	"name" text NOT NULL,
	"category" "document_category" DEFAULT 'sonstiges',
	"file_url" text,
	"file_size" integer,
	"mime_type" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tenant_portal_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"invite_token" text,
	"invite_expires_at" timestamp with time zone,
	"is_active" boolean DEFAULT true,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"phone" text,
	"mobile_phone" text,
	"status" "tenant_status" DEFAULT 'aktiv',
	"mietbeginn" date,
	"mietende" date,
	"grundmiete" numeric(10, 2) DEFAULT '0',
	"betriebskosten_vorschuss" numeric(10, 2) DEFAULT '0',
	"heizungskosten_vorschuss" numeric(10, 2) DEFAULT '0',
	"wasserkosten_vorschuss" numeric(10, 2) DEFAULT '0',
	"warmwasserkosten_vorschuss" numeric(10, 2) DEFAULT '0',
	"sonstige_kosten" jsonb,
	"kaution" numeric(10, 2),
	"kaution_bezahlt" boolean DEFAULT false,
	"iban" text,
	"bic" text,
	"sepa_mandat" boolean DEFAULT false,
	"sepa_mandat_datum" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ticket_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_id" uuid,
	"content" text NOT NULL,
	"is_internal" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"bank_account_id" uuid,
	"amount" numeric(10, 2) NOT NULL,
	"transaction_date" date NOT NULL,
	"booking_text" text,
	"partner_name" text,
	"partner_iban" text,
	"reference" text,
	"category_id" uuid,
	"is_matched" boolean DEFAULT false,
	"matched_tenant_id" uuid,
	"matched_unit_id" uuid,
	"raw_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "unit_distribution_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"key_id" uuid NOT NULL,
	"value" numeric(10, 4) DEFAULT '0',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"top_nummer" text NOT NULL,
	"type" "unit_type" DEFAULT 'wohnung',
	"status" "tenant_status" DEFAULT 'leerstand',
	"flaeche" numeric(10, 2),
	"zimmer" integer,
	"nutzwert" numeric(10, 4),
	"stockwerk" integer,
	"vs_personen" integer DEFAULT 0,
	"leerstand_bk" numeric(10, 2) DEFAULT '0',
	"leerstand_hk" numeric(10, 2) DEFAULT '0',
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_2fa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"secret" text NOT NULL,
	"is_enabled" boolean DEFAULT false,
	"backup_codes" text[],
	"last_used" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "user_2fa_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user_organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"role" text DEFAULT 'viewer',
	"is_default" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "app_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp (6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vpi_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"adjustment_date" date NOT NULL,
	"previous_rent" numeric(10, 2) NOT NULL,
	"new_rent" numeric(10, 2) NOT NULL,
	"vpi_old" numeric(8, 2),
	"vpi_new" numeric(8, 2),
	"percentage_change" numeric(5, 2),
	"notification_sent" boolean DEFAULT false,
	"notification_date" date,
	"effective_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "vpi_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"value" numeric(8, 2) NOT NULL,
	"source" text DEFAULT 'manual',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "weg_agenda_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assembly_id" uuid NOT NULL,
	"top_number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'sonstiges',
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "weg_assemblies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"property_id" uuid NOT NULL,
	"title" text NOT NULL,
	"assembly_type" text DEFAULT 'ordentlich',
	"assembly_date" timestamp with time zone NOT NULL,
	"location" text,
	"invitation_sent_at" timestamp with time zone,
	"invitation_deadline" timestamp with time zone,
	"is_circular_resolution" boolean DEFAULT false,
	"circular_deadline" timestamp with time zone,
	"protocol_url" text,
	"protocol_number" text,
	"status" text DEFAULT 'geplant',
	"total_mea_present" numeric(10, 4),
	"total_mea_property" numeric(10, 4),
	"quorum_reached" boolean,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "weg_budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_plan_id" uuid NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"amount" numeric(12, 2) DEFAULT '0',
	"allocation_key" text DEFAULT 'mea',
	"ust_rate" integer DEFAULT 10,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "weg_budget_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"property_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"total_amount" numeric(12, 2) DEFAULT '0',
	"reserve_contribution" numeric(12, 2) DEFAULT '0',
	"management_fee" numeric(12, 2) DEFAULT '0',
	"active_from" date,
	"due_day" integer DEFAULT 5,
	"status" text DEFAULT 'entwurf',
	"approved_at" timestamp with time zone,
	"approved_by_vote_id" uuid,
	"activated_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "weg_maintenance_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"property_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'ordentliche_verwaltung',
	"priority" text DEFAULT 'normal',
	"estimated_cost" numeric(12, 2),
	"actual_cost" numeric(12, 2),
	"financing_source" text DEFAULT 'ruecklage',
	"special_assessment_id" uuid,
	"approved_by_vote_id" uuid,
	"status" text DEFAULT 'geplant',
	"start_date" date,
	"completion_date" date,
	"contractor_name" text,
	"contractor_contact" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "weg_owner_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"property_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"previous_owner_id" uuid NOT NULL,
	"new_owner_id" uuid NOT NULL,
	"transfer_date" date NOT NULL,
	"grundbuch_date" date,
	"tz_number" text,
	"kaufvertrag_date" date,
	"rechtsgrund" "owner_change_rechtsgrund" DEFAULT 'kauf',
	"status" "owner_change_status" DEFAULT 'entwurf',
	"mea_share" numeric(10, 4),
	"nutzwert" numeric(10, 4),
	"reserve_amount" numeric(12, 2) DEFAULT '0',
	"open_debts_amount" numeric(12, 2) DEFAULT '0',
	"aliquot_month" integer,
	"aliquot_old_owner_amount" numeric(12, 2) DEFAULT '0',
	"aliquot_new_owner_amount" numeric(12, 2) DEFAULT '0',
	"cancelled_invoice_count" integer DEFAULT 0,
	"new_invoice_count" integer DEFAULT 0,
	"notes" text,
	"created_by" uuid,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "weg_owner_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vote_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"unit_id" uuid,
	"vote_value" text NOT NULL,
	"mea_weight" numeric(10, 4),
	"voted_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "weg_reserve_fund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"property_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"amount" numeric(12, 2) DEFAULT '0',
	"description" text,
	"entry_type" text DEFAULT 'einzahlung',
	"unit_id" uuid,
	"owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "weg_settlement_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"mea_share" numeric(10, 4) NOT NULL,
	"mea_ratio" numeric(10, 6) NOT NULL,
	"total_soll" numeric(12, 2) DEFAULT '0',
	"total_ist" numeric(12, 2) DEFAULT '0',
	"saldo" numeric(12, 2) DEFAULT '0',
	"ruecklage_anteil" numeric(12, 2) DEFAULT '0',
	"sonderumlagen" numeric(12, 2) DEFAULT '0',
	"category_details" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "weg_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"property_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"total_expenses" numeric(12, 2) DEFAULT '0',
	"total_prepayments" numeric(12, 2) DEFAULT '0',
	"total_difference" numeric(12, 2) DEFAULT '0',
	"owner_count" integer DEFAULT 0,
	"total_mea" numeric(10, 4) DEFAULT '0',
	"reserve_fund_balance" numeric(12, 2) DEFAULT '0',
	"status" text DEFAULT 'entwurf',
	"created_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "weg_special_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"property_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"total_amount" numeric(12, 2) NOT NULL,
	"allocation_key" text DEFAULT 'mea',
	"due_date" date,
	"approved_by_vote_id" uuid,
	"status" text DEFAULT 'beschlossen',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "weg_unit_owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"property_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"mea_share" numeric(10, 4) NOT NULL,
	"nutzwert" numeric(10, 4),
	"valid_from" date,
	"valid_to" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "weg_vorschreibungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"property_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"budget_plan_id" uuid,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"mea_share" numeric(10, 4) NOT NULL,
	"betriebskosten" numeric(12, 2) DEFAULT '0',
	"ruecklage" numeric(12, 2) DEFAULT '0',
	"instandhaltung" numeric(12, 2) DEFAULT '0',
	"verwaltungshonorar" numeric(12, 2) DEFAULT '0',
	"heizung" numeric(12, 2) DEFAULT '0',
	"ust" numeric(12, 2) DEFAULT '0',
	"gesamtbetrag" numeric(12, 2) DEFAULT '0',
	"status" "invoice_status" DEFAULT 'offen',
	"faellig_am" date,
	"pdf_url" text,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "weg_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assembly_id" uuid NOT NULL,
	"agenda_item_id" uuid,
	"topic" text NOT NULL,
	"description" text,
	"required_majority" text DEFAULT 'einfach',
	"votes_yes" integer DEFAULT 0,
	"votes_no" integer DEFAULT 0,
	"votes_abstain" integer DEFAULT 0,
	"mea_votes_yes" numeric(10, 4) DEFAULT '0',
	"mea_votes_no" numeric(10, 4) DEFAULT '0',
	"mea_votes_abstain" numeric(10, 4) DEFAULT '0',
	"total_mea" numeric(10, 4),
	"result" text,
	"result_basis" text DEFAULT 'mea',
	"is_circular_vote" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "white_label_inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text NOT NULL,
	"contact_person" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"property_count" integer,
	"unit_count" integer,
	"message" text,
	"status" "white_label_inquiry_status" DEFAULT 'neu',
	"notes" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "white_label_licenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"license_name" text NOT NULL,
	"monthly_price" numeric(10, 2),
	"setup_fee" numeric(10, 2),
	"contract_start" date NOT NULL,
	"contract_end" date,
	"status" "white_label_license_status" DEFAULT 'aktiv',
	"custom_domain" text,
	"max_users" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "account_categories" ADD CONSTRAINT "account_categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_categories" ADD CONSTRAINT "account_categories_default_distribution_key_id_distribution_keys_id_fk" FOREIGN KEY ("default_distribution_key_id") REFERENCES "public"."distribution_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_log" ADD CONSTRAINT "automation_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule_logs" ADD CONSTRAINT "automation_rule_logs_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule_logs" ADD CONSTRAINT "automation_rule_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_settings" ADD CONSTRAINT "automation_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_number_sequences" ADD CONSTRAINT "booking_number_sequences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_reported_by_id_profiles_id_fk" FOREIGN KEY ("reported_by_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_assigned_to_id_profiles_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_retention_policies" ADD CONSTRAINT "data_retention_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_invites" ADD CONSTRAINT "demo_invites_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_invites" ADD CONSTRAINT "demo_invites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_assets" ADD CONSTRAINT "depreciation_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_assets" ADD CONSTRAINT "depreciation_assets_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_assets" ADD CONSTRAINT "depreciation_assets_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_keys" ADD CONSTRAINT "distribution_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_keys" ADD CONSTRAINT "distribution_keys_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_tag_assignments" ADD CONSTRAINT "document_tag_assignments_tag_id_document_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."document_tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_profiles_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ea_bookings" ADD CONSTRAINT "ea_bookings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebics_connections" ADD CONSTRAINT "ebics_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebics_orders" ADD CONSTRAINT "ebics_orders_connection_id_ebics_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."ebics_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebics_orders" ADD CONSTRAINT "ebics_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebics_payment_batches" ADD CONSTRAINT "ebics_payment_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebics_payment_batches" ADD CONSTRAINT "ebics_payment_batches_connection_id_ebics_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."ebics_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "energy_certificates" ADD CONSTRAINT "energy_certificates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "energy_certificates" ADD CONSTRAINT "energy_certificates_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "energy_consumption" ADD CONSTRAINT "energy_consumption_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "energy_consumption" ADD CONSTRAINT "energy_consumption_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "energy_consumption" ADD CONSTRAINT "energy_consumption_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_distribution_key_id_distribution_keys_id_fk" FOREIGN KEY ("distribution_key_id") REFERENCES "public"."distribution_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guided_workflows" ADD CONSTRAINT "guided_workflows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guided_workflows" ADD CONSTRAINT "guided_workflows_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heat_billing_audit_log" ADD CONSTRAINT "heat_billing_audit_log_run_id_heat_billing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heat_billing_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heat_billing_lines" ADD CONSTRAINT "heat_billing_lines_run_id_heat_billing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heat_billing_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heat_billing_lines" ADD CONSTRAINT "heat_billing_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heat_billing_runs" ADD CONSTRAINT "heat_billing_runs_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heating_cost_readings" ADD CONSTRAINT "heating_cost_readings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heating_cost_readings" ADD CONSTRAINT "heating_cost_readings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heating_cost_readings" ADD CONSTRAINT "heating_cost_readings_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heating_settlement_details" ADD CONSTRAINT "heating_settlement_details_settlement_id_heating_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."heating_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heating_settlement_details" ADD CONSTRAINT "heating_settlement_details_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heating_settlements" ADD CONSTRAINT "heating_settlements_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_insurance_policy_id_insurance_policies_id_fk" FOREIGN KEY ("insurance_policy_id") REFERENCES "public"."insurance_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_monthly_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."monthly_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_runs" ADD CONSTRAINT "invoice_runs_initiated_by_profiles_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kautionen" ADD CONSTRAINT "kautionen_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kautionen" ADD CONSTRAINT "kautionen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kautionen" ADD CONSTRAINT "kautionen_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kautionen" ADD CONSTRAINT "kautionen_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kautions_bewegungen" ADD CONSTRAINT "kautions_bewegungen_kaution_id_kautionen_id_fk" FOREIGN KEY ("kaution_id") REFERENCES "public"."kautionen"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_handovers" ADD CONSTRAINT "key_handovers_key_inventory_id_key_inventory_id_fk" FOREIGN KEY ("key_inventory_id") REFERENCES "public"."key_inventory"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_handovers" ADD CONSTRAINT "key_handovers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_inventory" ADD CONSTRAINT "key_inventory_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_inventory" ADD CONSTRAINT "key_inventory_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learned_matches" ADD CONSTRAINT "learned_matches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learned_matches" ADD CONSTRAINT "learned_matches_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learned_matches" ADD CONSTRAINT "learned_matches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_templates" ADD CONSTRAINT "letter_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD CONSTRAINT "maintenance_contracts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD CONSTRAINT "maintenance_contracts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD CONSTRAINT "maintenance_contracts_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_contract_id_maintenance_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."maintenance_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_contracts" ADD CONSTRAINT "management_contracts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_contracts" ADD CONSTRAINT "management_contracts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_meter_id_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meters" ADD CONSTRAINT "meters_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meters" ADD CONSTRAINT "meters_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_invoices" ADD CONSTRAINT "monthly_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_invoices" ADD CONSTRAINT "monthly_invoices_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_invited_by_profiles_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_payouts" ADD CONSTRAINT "owner_payouts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_payouts" ADD CONSTRAINT "owner_payouts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_payouts" ADD CONSTRAINT "owner_payouts_owner_id_property_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."property_owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_portal_access" ADD CONSTRAINT "owner_portal_access_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owners" ADD CONSTRAINT "owners_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_history" ADD CONSTRAINT "password_history_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_monthly_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."monthly_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_monthly_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."monthly_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_activities" ADD CONSTRAINT "processing_activities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_budgets" ADD CONSTRAINT "property_budgets_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_budgets" ADD CONSTRAINT "property_budgets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_documents" ADD CONSTRAINT "property_documents_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_documents" ADD CONSTRAINT "property_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_managers" ADD CONSTRAINT "property_managers_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_managers" ADD CONSTRAINT "property_managers_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_owners" ADD CONSTRAINT "property_owners_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_owners" ADD CONSTRAINT "property_owners_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_history" ADD CONSTRAINT "rent_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_sessions" ADD CONSTRAINT "security_sessions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_collections" ADD CONSTRAINT "sepa_collections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_collections" ADD CONSTRAINT "sepa_collections_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_letters" ADD CONSTRAINT "serial_letters_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_letters" ADD CONSTRAINT "serial_letters_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_letters" ADD CONSTRAINT "serial_letters_template_id_letter_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."letter_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_letters" ADD CONSTRAINT "serial_letters_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_details" ADD CONSTRAINT "settlement_details_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_details" ADD CONSTRAINT "settlement_details_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_details" ADD CONSTRAINT "settlement_details_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_requested_by_profiles_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_request_id_signature_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."signature_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_signer_id_profiles_id_fk" FOREIGN KEY ("signer_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_created_by_id_profiles_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_id_profiles_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_documents" ADD CONSTRAINT "tenant_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_documents" ADD CONSTRAINT "tenant_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_portal_access" ADD CONSTRAINT "tenant_portal_access_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_matched_tenant_id_tenants_id_fk" FOREIGN KEY ("matched_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_matched_unit_id_units_id_fk" FOREIGN KEY ("matched_unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_distribution_values" ADD CONSTRAINT "unit_distribution_values_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_distribution_values" ADD CONSTRAINT "unit_distribution_values_key_id_distribution_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."distribution_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_2fa" ADD CONSTRAINT "user_2fa_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_organizations" ADD CONSTRAINT "user_organizations_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_organizations" ADD CONSTRAINT "user_organizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vpi_adjustments" ADD CONSTRAINT "vpi_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_agenda_items" ADD CONSTRAINT "weg_agenda_items_assembly_id_weg_assemblies_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."weg_assemblies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_assemblies" ADD CONSTRAINT "weg_assemblies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_assemblies" ADD CONSTRAINT "weg_assemblies_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_budget_lines" ADD CONSTRAINT "weg_budget_lines_budget_plan_id_weg_budget_plans_id_fk" FOREIGN KEY ("budget_plan_id") REFERENCES "public"."weg_budget_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_budget_plans" ADD CONSTRAINT "weg_budget_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_budget_plans" ADD CONSTRAINT "weg_budget_plans_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_maintenance_items" ADD CONSTRAINT "weg_maintenance_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_maintenance_items" ADD CONSTRAINT "weg_maintenance_items_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_maintenance_items" ADD CONSTRAINT "weg_maintenance_items_special_assessment_id_weg_special_assessments_id_fk" FOREIGN KEY ("special_assessment_id") REFERENCES "public"."weg_special_assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_owner_changes" ADD CONSTRAINT "weg_owner_changes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_owner_changes" ADD CONSTRAINT "weg_owner_changes_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_owner_changes" ADD CONSTRAINT "weg_owner_changes_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_owner_changes" ADD CONSTRAINT "weg_owner_changes_previous_owner_id_owners_id_fk" FOREIGN KEY ("previous_owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_owner_changes" ADD CONSTRAINT "weg_owner_changes_new_owner_id_owners_id_fk" FOREIGN KEY ("new_owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_owner_changes" ADD CONSTRAINT "weg_owner_changes_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_owner_votes" ADD CONSTRAINT "weg_owner_votes_vote_id_weg_votes_id_fk" FOREIGN KEY ("vote_id") REFERENCES "public"."weg_votes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_owner_votes" ADD CONSTRAINT "weg_owner_votes_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_owner_votes" ADD CONSTRAINT "weg_owner_votes_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_reserve_fund" ADD CONSTRAINT "weg_reserve_fund_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_reserve_fund" ADD CONSTRAINT "weg_reserve_fund_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_reserve_fund" ADD CONSTRAINT "weg_reserve_fund_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_reserve_fund" ADD CONSTRAINT "weg_reserve_fund_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_settlement_details" ADD CONSTRAINT "weg_settlement_details_settlement_id_weg_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."weg_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_settlement_details" ADD CONSTRAINT "weg_settlement_details_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_settlement_details" ADD CONSTRAINT "weg_settlement_details_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_settlements" ADD CONSTRAINT "weg_settlements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_settlements" ADD CONSTRAINT "weg_settlements_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_special_assessments" ADD CONSTRAINT "weg_special_assessments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_special_assessments" ADD CONSTRAINT "weg_special_assessments_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_unit_owners" ADD CONSTRAINT "weg_unit_owners_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_unit_owners" ADD CONSTRAINT "weg_unit_owners_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_unit_owners" ADD CONSTRAINT "weg_unit_owners_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_unit_owners" ADD CONSTRAINT "weg_unit_owners_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_vorschreibungen" ADD CONSTRAINT "weg_vorschreibungen_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_vorschreibungen" ADD CONSTRAINT "weg_vorschreibungen_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_vorschreibungen" ADD CONSTRAINT "weg_vorschreibungen_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_vorschreibungen" ADD CONSTRAINT "weg_vorschreibungen_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_vorschreibungen" ADD CONSTRAINT "weg_vorschreibungen_budget_plan_id_weg_budget_plans_id_fk" FOREIGN KEY ("budget_plan_id") REFERENCES "public"."weg_budget_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_votes" ADD CONSTRAINT "weg_votes_assembly_id_weg_assemblies_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."weg_assemblies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weg_votes" ADD CONSTRAINT "weg_votes_agenda_item_id_weg_agenda_items_id_fk" FOREIGN KEY ("agenda_item_id") REFERENCES "public"."weg_agenda_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "white_label_licenses" ADD CONSTRAINT "white_label_licenses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_consent_user" ON "consent_records" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_consent_type" ON "consent_records" USING btree ("consent_type");--> statement-breakpoint
CREATE INDEX "idx_damage_reports_org" ON "damage_reports" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_damage_reports_property" ON "damage_reports" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "idx_damage_reports_tenant" ON "damage_reports" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_damage_reports_status" ON "damage_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_energy_certs_property" ON "energy_certificates" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "idx_energy_certs_org" ON "energy_certificates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_energy_consumption_property" ON "energy_consumption" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "idx_energy_consumption_year" ON "energy_consumption" USING btree ("year");--> statement-breakpoint
CREATE INDEX "idx_workflows_org" ON "guided_workflows" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_workflows_user" ON "guided_workflows" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_invoice_lines_invoice" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "idx_invoice_lines_unit" ON "invoice_lines" USING btree ("unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_unique_idx" ON "invoice_lines" USING btree ("invoice_id","unit_id","line_type","normalized_description");--> statement-breakpoint
CREATE INDEX "idx_job_queue_status" ON "job_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_job_queue_org" ON "job_queue" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leases_tenant_unit_start_unique" ON "leases" USING btree ("tenant_id","unit_id","start_date");--> statement-breakpoint
CREATE INDEX "idx_meter_readings_date" ON "meter_readings" USING btree ("meter_id","reading_date");--> statement-breakpoint
CREATE INDEX "idx_invoices_unit_status_year_month" ON "monthly_invoices" USING btree ("unit_id","status","year","month");--> statement-breakpoint
CREATE INDEX "idx_invoices_run_id" ON "monthly_invoices" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_reconcile_runs_run_id" ON "reconcile_runs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_reconcile_runs_status" ON "reconcile_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_security_sessions_user" ON "security_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_security_sessions_active" ON "security_sessions" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_tickets_org" ON "support_tickets" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_status" ON "support_tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tickets_tenant" ON "support_tickets" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "units_property_top_unique" ON "units" USING btree ("property_id","top_nummer");--> statement-breakpoint
CREATE INDEX "idx_weg_vorschreibungen_property" ON "weg_vorschreibungen" USING btree ("property_id","year","month");--> statement-breakpoint
CREATE INDEX "idx_weg_vorschreibungen_owner" ON "weg_vorschreibungen" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_weg_vorschreibungen_run" ON "weg_vorschreibungen" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");