-- Agentes: la instancia de una plantilla dentro de una app (RF-1503).
--
-- Es quien firma. Nace copiando los campos de su plantilla y a partir de ahí
-- vive su vida (RF-1504, RF-1505).
--
-- Dos formas de callar y no una (RF-1508, RF-1509): `active` es un descanso
-- —deja de intervenir y vuelve cuando se quiera— y `removed_at` una despedida.
-- Ninguna de las dos borra nada de lo que escribió.

CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"app_id" uuid NOT NULL,
	"template_id" uuid,
	"name" text NOT NULL,
	"handle" "citext" NOT NULL,
	"icon_emoji" text NOT NULL,
	"icon_color" text NOT NULL,
	"provider" "ai_provider",
	"model_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"removed_at" timestamp with time zone,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_template_id_agent_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."agent_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_app_handle_key" ON "agents" USING btree ("app_id","handle") WHERE "agents"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "agents_template_idx" ON "agents" USING btree ("template_id");--> statement-breakpoint

-- El mismo par que en las plantillas: o proveedor y modelo, o ninguno (RF-1104).
ALTER TABLE "agents" ADD CONSTRAINT "agents_model_pair_check"
  CHECK (num_nonnulls("provider", "model_id") <> 1);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Un agente no desciende de una plantilla de otro workspace (RF-1512)
-- ---------------------------------------------------------------------------
-- La RLS ya impide **leer** la plantilla de un workspace ajeno, así que por el
-- camino legítimo esto no puede pasar. Se comprueba igualmente en el motor
-- porque el invariante es del modelo y no de la política: una migración futura
-- que relaje una política no debería poder abrir la puerta a un agente cuyo
-- molde vive en otro sitio, y aquí no hay ninguna consulta que lo notara.
CREATE OR REPLACE FUNCTION agents_check_template_workspace() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
DECLARE
  ws_plantilla uuid;
  ws_app uuid;
BEGIN
  IF NEW.template_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT workspace_id INTO ws_plantilla FROM agent_templates WHERE id = NEW.template_id;
  SELECT workspace_id INTO ws_app FROM apps WHERE id = NEW.app_id;

  IF ws_plantilla IS DISTINCT FROM ws_app THEN
    RAISE EXCEPTION 'An agent cannot descend from another workspace template'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE TRIGGER agents_template_workspace_guard
  BEFORE INSERT OR UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION agents_check_template_workspace();
