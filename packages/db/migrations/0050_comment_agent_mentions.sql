-- A qué agente se invoca en un comentario (RF-1602, T-34).
--
-- Tabla aparte de `comment_mentions` y no una columna más en ella, aunque las
-- dos salgan de leer `@algo` en el mismo texto. Son dos comportamientos: una
-- **avisa** a una persona y la otra **invoca** a un agente, que cuesta tokens y
-- escribe en el documento. Separadas, cada clave ajena sigue siendo obligatoria
-- en vez de quedar dos columnas opcionales que se turnan.

CREATE TABLE "comment_agent_mentions" (
	"comment_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	CONSTRAINT "comment_agent_mentions_comment_id_agent_id_pk" PRIMARY KEY("comment_id","agent_id")
);
--> statement-breakpoint
ALTER TABLE "comment_agent_mentions" ADD CONSTRAINT "comment_agent_mentions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_agent_mentions" ADD CONSTRAINT "comment_agent_mentions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_agent_mentions_agent_idx" ON "comment_agent_mentions" USING btree ("agent_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Dos cortafuegos, en el motor y no solo en quien inserta
-- ---------------------------------------------------------------------------
-- El disparo se decide en el consumidor del evento (T-35), y ahí se queda la
-- lógica. Estos dos son otra cosa: invariantes del modelo, de los que no
-- debería poder salirse ninguna ruta futura ni ninguna consulta escrita a mano.
-- Si no hay fila no hay invocación, así que basta con impedir que se escriba la
-- fila que no debería existir.
CREATE OR REPLACE FUNCTION comment_agent_mentions_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
DECLARE
  autor_persona uuid;
  app_del_hilo uuid;
  app_del_agente uuid;
BEGIN
  SELECT c.author_id, t.app_id INTO autor_persona, app_del_hilo
  FROM comments c
  JOIN comment_threads t ON t.id = c.thread_id
  WHERE c.id = NEW.comment_id;

  -- Una mención escrita por un agente no invoca a nadie (RF-1604). Es la mitad
  -- estructural del cortafuegos: aunque un agente escriba `@otro` en su texto,
  -- aquí no puede quedar constancia, y sin constancia no hay a quién despertar.
  IF autor_persona IS NULL THEN
    RAISE EXCEPTION 'Only a person can summon an agent'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Y solo a los de su propia app (RF-1512): compartir plantilla y workspace no
  -- hace visible al agente de otra app, ni siquiera acertando su identificador.
  SELECT app_id INTO app_del_agente FROM agents WHERE id = NEW.agent_id;
  IF app_del_agente IS DISTINCT FROM app_del_hilo THEN
    RAISE EXCEPTION 'That agent does not belong to this app'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE TRIGGER comment_agent_mentions_guard_trigger
  BEFORE INSERT OR UPDATE ON comment_agent_mentions
  FOR EACH ROW EXECUTE FUNCTION comment_agent_mentions_guard();
