-- Plantillas de agente: el molde, no el interlocutor (RF-1501, RF-1502).
--
-- Quien firma un comentario es siempre una **instancia** en una app concreta,
-- que llega en la migración siguiente. Separar molde e instancia es lo que
-- permite ajustar la personalidad para una app sin tocar el resto (RF-1504) y
-- lo que hace que editar el molde no reescriba lo que ya dijeron sus copias
-- (RF-1505).
--
-- El handle es único **por workspace** y no en toda la instalación: dos
-- workspaces pueden tener cada uno su `@techlead` sin enterarse el uno del
-- otro, igual que dos apps pueden repetir nombre.
--
-- Las plantillas de fábrica no están aquí ni en ninguna otra tabla: son datos
-- del producto, y adoptar una copia sus campos a una fila de estas (RF-1514).
--
-- El aislamiento llega con el resto del modelo, en su propia migración; aquí
-- solo está la forma.

CREATE TABLE "agent_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"handle" "citext" NOT NULL,
	"icon_emoji" text NOT NULL,
	"icon_color" text NOT NULL,
	"prompt" text NOT NULL,
	"provider" "ai_provider",
	"model_id" text,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_templates_workspace_handle_key" UNIQUE("workspace_id","handle")
);
--> statement-breakpoint
ALTER TABLE "agent_templates" ADD CONSTRAINT "agent_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_templates" ADD CONSTRAINT "agent_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Un modelo sin proveedor no identifica a nada, y un proveedor sin modelo no
-- dice cuál. O van los dos o no va ninguno, y entonces se usa el que el
-- workspace tenga asignado al tipo de tarea (RF-1104).
ALTER TABLE "agent_templates" ADD CONSTRAINT "agent_templates_model_pair_check"
  CHECK (num_nonnulls("provider", "model_id") <> 1);
