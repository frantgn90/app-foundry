-- La puerta de escritura guarda también el razonamiento (RF-1403).
--
-- Mismo criterio que la vez anterior: se sustituye la función en vez de dejar
-- dos sobrecargas, y el parámetro nuevo va al final con valor por defecto.
--
-- Y hay que borrar la anterior a mano, porque `CREATE OR REPLACE` con otra
-- lista de parámetros crea una sobrecarga nueva en vez de reemplazar.

DROP FUNCTION IF EXISTS agent_write_comment(uuid, uuid, uuid, text, uuid, ai_provider, text);--> statement-breakpoint

CREATE FUNCTION agent_write_comment(
  p_thread_id uuid,
  p_agent_id uuid,
  p_prompt_revision_id uuid,
  p_body text,
  p_parent_id uuid DEFAULT NULL,
  p_provider ai_provider DEFAULT NULL,
  p_model_id text DEFAULT NULL,
  p_reasoning text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  quien uuid := current_app_user();
  app_del_hilo uuid;
  app_del_agente uuid;
  agente_activo boolean;
  revision_del_agente uuid;
  nuevo uuid;
BEGIN
  -- Un agente escribe siempre a cuenta de alguien: quien lo mencionó, quien
  -- pidió la revisión. Sin identidad no hay contra quién comprobar la
  -- visibilidad ni a quién imputar el gasto, así que no se escribe.
  IF quien IS NULL THEN
    RAISE EXCEPTION 'An agent comment needs the identity of whoever triggered it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- El hilo existe y su app es visible para quien llama. Mismo predicado que
  -- `apps_visible`: pertenecer al workspace y, si es privada, ser su precursor.
  SELECT t.app_id INTO app_del_hilo
  FROM comment_threads t
  JOIN apps a ON a.id = t.app_id
  WHERE t.id = p_thread_id
    AND a.workspace_id IN (SELECT user_workspaces(quien))
    AND (a.access_level <> 'PRIVATE' OR a.precursor_id = quien);

  IF app_del_hilo IS NULL THEN
    RAISE EXCEPTION 'That thread does not exist here'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT ag.app_id, ag.active AND ag.removed_at IS NULL
    INTO app_del_agente, agente_activo
  FROM agents ag WHERE ag.id = p_agent_id;

  -- De esta app y de ninguna otra, aunque compartan plantilla (RF-1512).
  IF app_del_agente IS DISTINCT FROM app_del_hilo THEN
    RAISE EXCEPTION 'That agent does not belong to this app'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Un agente desactivado o retirado no interviene (RF-1508, RF-1509).
  IF NOT agente_activo THEN
    RAISE EXCEPTION 'That agent is not active in this app'
      USING ERRCODE = 'check_violation';
  END IF;

  -- El perfil con el que escribe tiene que ser suyo: si no, el comentario diría
  -- que se escribió con una personalidad que ese agente nunca tuvo (RF-1510).
  SELECT r.agent_id INTO revision_del_agente
  FROM agent_prompt_revisions r WHERE r.id = p_prompt_revision_id;

  IF revision_del_agente IS DISTINCT FROM p_agent_id THEN
    RAISE EXCEPTION 'That prompt revision belongs to another agent'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO comments (
    thread_id, parent_id, body, author_agent_id, agent_prompt_revision_id,
    ai_provider, ai_model_id, ai_reasoning
  )
  VALUES (
    p_thread_id, p_parent_id, p_body, p_agent_id, p_prompt_revision_id,
    p_provider, p_model_id, nullif(p_reasoning, '')
  )
  RETURNING id INTO nuevo;

  RETURN nuevo;
END
$$;
--> statement-breakpoint

ALTER FUNCTION agent_write_comment(uuid, uuid, uuid, text, uuid, ai_provider, text, text)
  OWNER TO agent_writer;--> statement-breakpoint
REVOKE ALL ON FUNCTION agent_write_comment(uuid, uuid, uuid, text, uuid, ai_provider, text, text)
  FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION agent_write_comment(uuid, uuid, uuid, text, uuid, ai_provider, text, text)
  TO app_user;--> statement-breakpoint

COMMENT ON FUNCTION agent_write_comment(uuid, uuid, uuid, text, uuid, ai_provider, text, text) IS
  'Única escritura de un comentario de agente para el rol de la aplicación: exige identidad de quien lo provocó, app visible para esa persona, agente activo de esa app y revisión de prompt suya (BE11, T-27).';
