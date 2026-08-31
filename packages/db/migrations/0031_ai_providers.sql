-- Proveedores de IA de un workspace (RF-1001..1006, TRD v2 §7.1).
--
-- Dos tablas y no una, a propósito: la Row-Level Security filtra **filas, no
-- columnas**. Mientras el texto cifrado conviviera con el estado y el cupo,
-- cualquier consulta legítima a la configuración lo arrastraría y bastaría un
-- `select *` despistado para publicarlo. Separado, el rol de la aplicación
-- puede leer la configuración y no puede leer el secreto (T-27, RNF-602).
--
-- El aislamiento y la revocación de permisos llegan en las migraciones
-- siguientes; aquí solo está la forma.

CREATE TYPE "public"."ai_provider" AS ENUM('ANTHROPIC', 'GROQ');--> statement-breakpoint
CREATE TYPE "public"."provider_status" AS ENUM('ACTIVE', 'DISABLED', 'INVALID');--> statement-breakpoint
CREATE TABLE "workspace_ai_credentials" (
	"workspace_id" uuid NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"nonce" "bytea" NOT NULL,
	"key_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_ai_credentials_workspace_id_provider_pk" PRIMARY KEY("workspace_id","provider")
);
--> statement-breakpoint
CREATE TABLE "workspace_ai_providers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"status" "provider_status" DEFAULT 'ACTIVE' NOT NULL,
	"credential_hint" text NOT NULL,
	"monthly_token_quota" bigint,
	"quota_alert_pct" smallint DEFAULT 80 NOT NULL,
	"verified_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_ai_providers_workspace_provider_key" UNIQUE("workspace_id","provider")
);
--> statement-breakpoint
ALTER TABLE "workspace_ai_credentials" ADD CONSTRAINT "workspace_ai_credentials_provider_fk" FOREIGN KEY ("workspace_id","provider") REFERENCES "public"."workspace_ai_providers"("workspace_id","provider") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_ai_providers" ADD CONSTRAINT "workspace_ai_providers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_ai_providers" ADD CONSTRAINT "workspace_ai_providers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_ai_providers_workspace_idx" ON "workspace_ai_providers" USING btree ("workspace_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- AP1 · Lo que no tiene sentido guardar
-- ---------------------------------------------------------------------------
-- Un cupo de cero o negativo no es «sin cupo» —eso es el nulo—, sino un
-- workspace que no puede invocar nada y no sabe por qué.
ALTER TABLE workspace_ai_providers
  ADD CONSTRAINT workspace_ai_providers_quota_positive
  CHECK (monthly_token_quota IS NULL OR monthly_token_quota > 0);--> statement-breakpoint

-- Avisar al 0 % es avisar siempre; avisar por encima de 100 es no avisar nunca.
ALTER TABLE workspace_ai_providers
  ADD CONSTRAINT workspace_ai_providers_alert_pct_range
  CHECK (quota_alert_pct > 0 AND quota_alert_pct <= 100);--> statement-breakpoint

-- La pista de la credencial es para reconocerla, no para reconstruirla: con
-- ocho caracteres ya se estaría regalando demasiado de una clave corta.
ALTER TABLE workspace_ai_providers
  ADD CONSTRAINT workspace_ai_providers_hint_short
  CHECK (char_length(credential_hint) <= 8);
