-- El catálogo de modelos que publica cada proveedor (T-28, RF-1007).
--
-- Es la única tabla de la v2 sin `workspace_id`, y conviene decir por qué: no
-- contiene datos de nadie, sino lo que un proveedor cuenta de sí mismo, y es
-- idéntico para todos los workspaces. Guardar una copia por workspace
-- multiplicaría la misma información y multiplicaría también las llamadas para
-- mantenerla al día.

CREATE TABLE "ai_models" (
	"provider" "ai_provider" NOT NULL,
	"model_id" text NOT NULL,
	"display_name" text NOT NULL,
	"context_window" integer DEFAULT 0 NOT NULL,
	"max_output_tokens" integer DEFAULT 0 NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_models_provider_model_id_pk" PRIMARY KEY("provider","model_id")
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- AQ1 · Aislamiento de una tabla que no aísla nada
-- ---------------------------------------------------------------------------
-- Se activa RLS igual que en el resto, por coherencia y para que una tabla
-- nueva nunca nazca sin ella. Pero las políticas son deliberadamente amplias: lo
-- que hay aquí es público entre quienes han entrado, y la escritura es un
-- refresco de caché, no un dato de nadie. Lo que sí se exige es identidad: sin
-- sesión no se lee ni se escribe, como en todo lo demás.
ALTER TABLE ai_models ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai_models FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY ai_models_readable ON ai_models
  FOR SELECT
  USING (current_app_user() IS NOT NULL);
--> statement-breakpoint

CREATE POLICY ai_models_writable ON ai_models
  FOR ALL
  USING (current_app_user() IS NOT NULL)
  WITH CHECK (current_app_user() IS NOT NULL);
