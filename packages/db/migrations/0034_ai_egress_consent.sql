-- Constancia de que alguien aceptó que el contenido salga a un tercero (RF-1011).
--
-- Vive en el workspace y no en cada proveedor: lo que se consiente es que el
-- texto de las apps deje de estar solo aquí, y eso ocurre igual con un proveedor
-- que con dos. Se conserva aunque se borren todos, porque lo ya enviado no se
-- puede desenviar y volver a preguntar sugeriría lo contrario.
--
-- No hacen falta políticas nuevas: la fila es del workspace, que ya solo deja
-- actualizar a su dueño.

ALTER TABLE "workspaces" ADD COLUMN "ai_egress_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "ai_egress_accepted_by" uuid;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_ai_egress_accepted_by_users_id_fk" FOREIGN KEY ("ai_egress_accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- AP6 · Una fecha sin nombre no acredita nada
-- ---------------------------------------------------------------------------
ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_ai_egress_consent_complete
  CHECK (num_nonnulls(ai_egress_accepted_at, ai_egress_accepted_by) <> 1);
