-- El registro de invocaciones: la verdad del consumo (RF-1201, RD-10).
--
-- El contador de Redis es una caché derivable de esta tabla; de aquí se
-- reconstruye cuando falta o cuando se descuadra. Y no guarda contenido: ni
-- prompt, ni documento, ni respuesta (RF-1202, RNF-112). Mide, no archiva.

CREATE TYPE "public"."ai_outcome" AS ENUM('COMPLETED', 'FAILED', 'CANCELLED', 'QUOTA_BLOCKED');--> statement-breakpoint
CREATE TABLE "ai_invocations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"app_id" uuid,
	"actor_user_id" uuid,
	"task" "ai_task" NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"model_id" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"ttft_ms" integer,
	"latency_ms" integer,
	"outcome" "ai_outcome" NOT NULL,
	"error_kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_invocations_workspace_idx" ON "ai_invocations" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_invocations_quota_idx" ON "ai_invocations" USING btree ("workspace_id","provider","created_at");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- AR1 · Lo escrito, escrito queda
-- ---------------------------------------------------------------------------
-- Sin UPDATE ni DELETE para el rol de la aplicación, igual que la auditoría
-- (RF-705): un registro de consumo que se puede reescribir no sirve para
-- cuadrar un mes. La retención se hará por partición o por un proceso con el rol
-- de mantenimiento, no borrando filas desde la aplicación.
REVOKE UPDATE, DELETE ON ai_invocations FROM app_user;--> statement-breakpoint

ALTER TABLE ai_invocations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai_invocations FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Cada uno ve lo suyo; el dueño del workspace, todo lo de su workspace
-- (RF-1208). Un miembro no tiene por qué saber en qué gastan los demás, y el
-- dueño sí: es su cuota.
CREATE POLICY ai_invocations_visible ON ai_invocations
  FOR SELECT
  USING (
    actor_user_id = current_app_user()
    OR EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = ai_invocations.workspace_id AND w.owner_id = current_app_user()
    )
  );
--> statement-breakpoint

-- Se registra a nombre propio y en un workspace propio: nadie apunta consumo a
-- cuenta de otro.
CREATE POLICY ai_invocations_insert_own ON ai_invocations
  FOR INSERT
  WITH CHECK (
    actor_user_id = current_app_user()
    AND workspace_id IN (SELECT user_workspaces(current_app_user()))
  );
