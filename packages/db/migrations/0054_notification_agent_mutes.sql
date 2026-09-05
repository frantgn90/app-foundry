-- Quién no quiere oír a qué agente (RF-1612).
--
-- Silenciar es de la persona y del agente concreto, no del hilo ni de la app:
-- lo que molesta es un perfil que opina demasiado, y apagarlo entero —o
-- quitarlo de la app— es una decisión de otro que además afecta a todos.
--
-- Y silenciado **sigue escribiendo**. Lo que deja de llegar es el aviso, no el
-- comentario: apagarle la voz a alguien porque a uno le cansa sería decidir por
-- los demás lo que pueden leer.

CREATE TABLE "notification_agent_mutes" (
	"user_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_agent_mutes_user_id_agent_id_pk" PRIMARY KEY("user_id","agent_id")
);
--> statement-breakpoint
ALTER TABLE "notification_agent_mutes" ADD CONSTRAINT "notification_agent_mutes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_agent_mutes" ADD CONSTRAINT "notification_agent_mutes_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_agent_mutes_agent_idx" ON "notification_agent_mutes" USING btree ("agent_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Aislamiento: cada uno gobierna sus silencios y no ve los de nadie
-- ---------------------------------------------------------------------------
-- No hay política de lectura para terceros a propósito. Que a alguien le canse
-- un agente es cosa suya, y una lista de quién ha silenciado a quién invitaría
-- a leerla por encima del hombro.
ALTER TABLE notification_agent_mutes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE notification_agent_mutes FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY notification_agent_mutes_own ON notification_agent_mutes
  FOR ALL
  USING (user_id = current_app_user())
  WITH CHECK (
    user_id = current_app_user()
    -- Y solo agentes de una app que se pueda ver: silenciar a uno de otro
    -- workspace no significa nada, y aceptarlo confirmaría que existe.
    AND EXISTS (
      SELECT 1 FROM agents ag JOIN apps a ON a.id = ag.app_id
      WHERE ag.id = notification_agent_mutes.agent_id
    )
  );--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Y una puerta para el emisor, porque la política de arriba no le sirve
-- ---------------------------------------------------------------------------
-- Quien avisa corre con la identidad de **quien provocó** la respuesta, no con
-- la de cada destinatario, así que con la política de arriba solo vería sus
-- propios silencios y acabaría avisando a todo el que hubiera silenciado al
-- agente. Aflojar la política para que un miembro lea los silencios de los
-- demás resolvería esto y abriría otra cosa: una lista de a quién soporta cada
-- uno, que no es asunto de nadie.
--
-- Así que se pregunta lo justo: dado un agente, quiénes lo han silenciado. Sin
-- filtros libres y sin listados, igual que `ai_credential_secret` (T-19, T-27).
-- Se usa para **no** mandar un aviso, que es el único uso que tiene.
CREATE OR REPLACE FUNCTION notification_agent_muted_by(p_agent_id uuid)
RETURNS TABLE (user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.user_id FROM notification_agent_mutes m WHERE m.agent_id = p_agent_id;
$$;--> statement-breakpoint

GRANT SELECT ON notification_agent_mutes TO agent_writer;--> statement-breakpoint
ALTER FUNCTION notification_agent_muted_by(uuid) OWNER TO agent_writer;--> statement-breakpoint
REVOKE ALL ON FUNCTION notification_agent_muted_by(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notification_agent_muted_by(uuid) TO app_user;--> statement-breakpoint

COMMENT ON FUNCTION notification_agent_muted_by(uuid) IS
  'Quiénes han silenciado a un agente, para no avisarles. Única lectura de silencios ajenos que tiene el rol de la aplicación (BE15, RF-1612).';
