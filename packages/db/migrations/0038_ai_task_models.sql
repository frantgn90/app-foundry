-- Qué modelo atiende cada tipo de tarea (RF-1101, RF-1102).
--
-- Cuelga del proveedor configurado y no solo del workspace, así que borrar un
-- proveedor se lleva sus asignaciones. Es lo que queremos: una tarea apuntando a
-- un proveedor que ya no está sería una invocación que falla en el momento más
-- inoportuno. Lo que queda es una tarea sin asignar, que se puede explicar.

CREATE TYPE "public"."ai_task" AS ENUM('IDEA_GENERATION', 'TEXT_ASSIST', 'AGENT_REVIEW', 'AGENT_REPLY');--> statement-breakpoint
CREATE TABLE "workspace_task_models" (
	"workspace_id" uuid NOT NULL,
	"task" "ai_task" NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"model_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_task_models_workspace_id_task_pk" PRIMARY KEY("workspace_id","task")
);
--> statement-breakpoint
ALTER TABLE "workspace_task_models" ADD CONSTRAINT "workspace_task_models_provider_fk" FOREIGN KEY ("workspace_id","provider") REFERENCES "public"."workspace_ai_providers"("workspace_id","provider") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- AQ3 · Quién ve y quién decide
-- ---------------------------------------------------------------------------
-- La ve cualquier miembro: una tarea sin modelo asignado es una función de IA
-- que no se puede ofrecer, y eso hay que saberlo para no enseñar un botón que no
-- lleva a ninguna parte (RF-1010). Decidirla es del dueño, que es quien paga
-- (RF-1102, RF-1107).
ALTER TABLE workspace_task_models ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workspace_task_models FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY workspace_task_models_visible ON workspace_task_models
  FOR SELECT
  USING (workspace_id IN (SELECT user_workspaces(current_app_user())));
--> statement-breakpoint

CREATE POLICY workspace_task_models_owner_manage ON workspace_task_models
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_task_models.workspace_id AND w.owner_id = current_app_user()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_task_models.workspace_id AND w.owner_id = current_app_user()
    )
  );
