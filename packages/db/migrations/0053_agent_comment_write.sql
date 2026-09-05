-- La única puerta por la que un agente escribe (RF-1601, T-27).
--
-- Las políticas de `comments` exigen `author_id = current_app_user()`, así que
-- un comentario de agente —que lo tiene nulo— no se puede insertar con el rol
-- de la aplicación. Eso se queda como está: lo que se abre es una función
-- acotada, no un permiso.
--
-- La alternativa era ampliar la política para admitir filas con
-- `author_agent_id`. Habría dado las mismas garantías sobre la fila, pero se
-- las habría dado a **cualquier ruta**, presente o futura, que hiciera un
-- INSERT sobre `comments`. Con la función, escribir a nombre de un agente es
-- una llamada que se ve al leer el código y que no admite otra forma de
-- invocarse que la suya.
--
-- ── Por qué la función tiene dueño propio ──
--
-- `comments` está bajo FORCE ROW LEVEL SECURITY, y con FORCE las políticas se
-- aplican también al dueño de la tabla: una función SECURITY DEFINER corriente
-- chocaría con la política de inserción igual que el rol de la aplicación. Lo
-- que sí las salta es un rol con BYPASSRLS.
--
-- Se crea uno para esto y solo para esto, en vez de aprovechar el rol de
-- migraciones. En local y en los tests ese rol es superusuario y funcionaría;
-- en una instalación donde no lo fuera, la función quedaría bloqueada y las
-- respuestas de agente fallarían **solo en producción**. Un rol propio hace que
-- se comporte igual en todas partes.
--
-- No puede iniciar sesión, no es dueño de ninguna tabla, y lo único que el rol
-- de la aplicación puede hacer con él es ejecutar esta función.
--
-- ── Y por eso comprueba a mano lo que la RLS comprobaría ──
--
-- Al saltarse las políticas, la visibilidad de la app deja de ser gratis. Se
-- repite aquí el mismo predicado de `apps_visible`, y conviene saber que queda
-- duplicado: si algún día cambia la regla de quién ve una app, hay dos sitios
-- que tocar. Es el precio de que esta sea la única puerta.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_writer') THEN
    CREATE ROLE agent_writer WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
  ELSE
    ALTER ROLE agent_writer WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO agent_writer;--> statement-breakpoint
GRANT SELECT, INSERT ON comments TO agent_writer;--> statement-breakpoint
GRANT SELECT ON comment_threads, apps, agents, agent_prompt_revisions, workspace_members
  TO agent_writer;--> statement-breakpoint

-- Y las dos funciones de identidad, que están revocadas a PUBLIC desde 0001 y
-- 0004. Sin ellas la función no puede preguntar quién llama, que es de lo que
-- depende todo lo que comprueba.
GRANT EXECUTE ON FUNCTION current_app_user() TO agent_writer;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION user_workspaces(uuid) TO agent_writer;--> statement-breakpoint

CREATE OR REPLACE FUNCTION agent_write_comment(
  p_thread_id uuid,
  p_agent_id uuid,
  p_prompt_revision_id uuid,
  p_body text,
  p_parent_id uuid DEFAULT NULL
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
  -- Así un agente no escribe en una app que quien lo invocó no ve.
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

  INSERT INTO comments (thread_id, parent_id, body, author_agent_id, agent_prompt_revision_id)
  VALUES (p_thread_id, p_parent_id, p_body, p_agent_id, p_prompt_revision_id)
  RETURNING id INTO nuevo;

  RETURN nuevo;
END
$$;
--> statement-breakpoint

ALTER FUNCTION agent_write_comment(uuid, uuid, uuid, text, uuid) OWNER TO agent_writer;--> statement-breakpoint
REVOKE ALL ON FUNCTION agent_write_comment(uuid, uuid, uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION agent_write_comment(uuid, uuid, uuid, text, uuid) TO app_user;--> statement-breakpoint

COMMENT ON FUNCTION agent_write_comment(uuid, uuid, uuid, text, uuid) IS
  'Única escritura de un comentario de agente para el rol de la aplicación: exige identidad de quien lo provocó, app visible para esa persona, agente activo de esa app y revisión de prompt suya (BE11, T-27).';
