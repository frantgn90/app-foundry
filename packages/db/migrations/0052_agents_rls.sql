-- Aislamiento del modelo de agentes (RNF-603, RNF-904, RD-6).
--
-- Cuatro tablas con tres criterios, porque sirven a tres cosas distintas:
--
--  * Las **plantillas** las mira cualquier miembro y las escribe solo el dueño
--    del workspace (RF-1502). Que las mire cualquiera no es una concesión: sin
--    verlas, quien puede editar una app no podría instanciar ninguna (RF-1503).
--  * Los **agentes** y sus **revisiones de prompt** siguen a su app: los ve
--    quien ve la app y los toca quien puede editarla, con el mismo predicado
--    que gobierna documentos y versiones.
--  * Las **menciones a agentes** siguen a su comentario.
--
-- Ninguna política habla de agentes escribiendo comentarios. Eso es una
-- decisión que se toma en BE, cuando exista quien escriba: hoy las políticas de
-- `comments` exigen `author_id = current_app_user()`, así que un comentario de
-- agente sencillamente no se puede insertar con el rol de la aplicación. Es el
-- estado correcto mientras nadie deba poder hacerlo.

ALTER TABLE agent_templates ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE agent_templates FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE agents FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE agent_prompt_revisions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE agent_prompt_revisions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE comment_agent_mentions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE comment_agent_mentions FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- BC8 · Las plantillas
-- ---------------------------------------------------------------------------
CREATE POLICY agent_templates_visible ON agent_templates
  FOR SELECT
  USING (workspace_id IN (SELECT user_workspaces(current_app_user())));
--> statement-breakpoint

-- Crear, editar y borrar: del dueño y de nadie más (RF-1502). Adoptar una
-- plantilla del catálogo de fábrica es crear una, así que cae aquí sin
-- necesidad de una regla propia (RF-1514).
CREATE POLICY agent_templates_owner_manage ON agent_templates
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = agent_templates.workspace_id AND w.owner_id = current_app_user()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = agent_templates.workspace_id AND w.owner_id = current_app_user()
    )
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- BC8 · Los agentes
-- ---------------------------------------------------------------------------
-- Verlos es ver la app, y de eso ya se encarga la política de `apps`: si la app
-- es privada y no eres su precursor, aquí no aparece nada. Eso es también lo
-- que sostiene RF-1512, porque no hay forma de llegar a un agente sin pasar por
-- su app.
CREATE POLICY agents_visible ON agents
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM apps a WHERE a.id = agents.app_id));
--> statement-breakpoint

-- Añadirlos, ajustarlos, desactivarlos y retirarlos: quien pueda editar la app
-- (RF-1503). Mismo predicado que documentos y versiones, y por el mismo motivo
-- —un invitado con permiso de escritura es un colaborador de pleno derecho—.
-- Una app archivada no admite cambios (RF-409).
CREATE POLICY agents_write ON agents
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM apps a
      WHERE a.id = agents.app_id
        AND a.archived_at IS NULL
        AND (a.precursor_id = current_app_user() OR a.access_level = 'WORKSPACE_WRITE')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM apps a
      WHERE a.id = agents.app_id
        AND a.archived_at IS NULL
        AND (a.precursor_id = current_app_user() OR a.access_level = 'WORKSPACE_WRITE')
    )
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- BC8 · Las revisiones del prompt
-- ---------------------------------------------------------------------------
-- Leerlas es leer el agente. Hace falta para enseñar de qué perfil salió un
-- comentario (RF-1510) y para ver si la instancia se apartó de su plantilla
-- (RF-1504), y las dos cosas las mira cualquiera que vea la app.
CREATE POLICY agent_prompt_revisions_visible ON agent_prompt_revisions
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM agents ag WHERE ag.id = agent_prompt_revisions.agent_id));
--> statement-breakpoint

-- Solo INSERT: el UPDATE y el DELETE están revocados desde 0047, así que aquí
-- no hay nada que gobernar. Ajustar la personalidad es añadir una revisión.
CREATE POLICY agent_prompt_revisions_insert ON agent_prompt_revisions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agents ag
      JOIN apps a ON a.id = ag.app_id
      WHERE ag.id = agent_prompt_revisions.agent_id
        AND a.archived_at IS NULL
        AND (a.precursor_id = current_app_user() OR a.access_level = 'WORKSPACE_WRITE')
    )
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- BC8 · Las menciones que invocan
-- ---------------------------------------------------------------------------
CREATE POLICY comment_agent_mentions_visible ON comment_agent_mentions
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM comments c WHERE c.id = comment_agent_mentions.comment_id));
--> statement-breakpoint

-- Se invoca desde un comentario propio y a un agente de esa misma app. Lo
-- segundo lo comprueba además el trigger de 0050; aquí está por lo mismo que en
-- el resto de políticas de escritura: que la regla no dependa de que la
-- aplicación se acuerde. Que el autor sea una persona sale solo, porque un
-- comentario de agente tiene `author_id` nulo y esto no lo iguala nadie.
CREATE POLICY comment_agent_mentions_insert ON comment_agent_mentions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM comments c
      JOIN comment_threads t ON t.id = c.thread_id
      JOIN agents ag ON ag.id = comment_agent_mentions.agent_id
      WHERE c.id = comment_agent_mentions.comment_id
        AND c.author_id = current_app_user()
        AND ag.app_id = t.app_id
    )
  );
--> statement-breakpoint

-- Retirar una mención al editar el texto: mismo criterio que al ponerla.
CREATE POLICY comment_agent_mentions_delete ON comment_agent_mentions
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM comments c
      WHERE c.id = comment_agent_mentions.comment_id AND c.author_id = current_app_user()
    )
  );
