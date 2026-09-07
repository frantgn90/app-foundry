-- La puerta por la que un agente abre un hilo (RF-1606, T-27, T-34).
--
-- Hasta ahora un agente solo podía **responder** en un hilo que ya existía, y
-- para eso está `agent_write_comment`. Una revisión hace lo otro: abre hilos
-- nuevos, anclados a fragmentos concretos del documento, y uno general con su
-- valoración de conjunto.
--
-- Sigue el mismo patrón que la puerta de escribir, y por el mismo motivo: las
-- políticas de `comment_threads` exigen `created_by = current_app_user()`, que
-- es exactamente lo que impide que el rol de la aplicación abra un hilo a
-- nombre de un agente. Relajar esa política abriría la puerta a cualquier
-- escritura; una función estrecha, con dueño propio y con sus comprobaciones
-- dentro, la deja abierta solo para esto.
--
-- Lo que comprueba, y por qué cada cosa:
--
--  * **Identidad**: un agente escribe siempre a cuenta de alguien —quien pidió
--    la revisión—. Sin ella no hay contra quién comprobar la visibilidad.
--  * **App visible y no archivada** para esa persona: el aislamiento del agente
--    es el de quien lo puso a leer, no uno nuevo.
--  * **Agente activo de esa app** (RF-1508, RF-1512).
--  * **Revisión viva y de esta app**: un trabajo que llega tarde, después de
--    cancelar, no puede seguir dejando hilos (RF-1610).
--  * **Un hilo inline trae su ancla**: cita y versión. Sin ellas no se puede
--    volver al fragmento, y un inline sin ancla es un general mal puesto.

CREATE FUNCTION agent_open_thread(
  p_app_id uuid,
  p_agent_id uuid,
  p_review_id uuid,
  p_kind thread_kind,
  p_anchor_quote text DEFAULT NULL,
  p_anchor_prefix text DEFAULT NULL,
  p_anchor_suffix text DEFAULT NULL,
  p_anchor_start int DEFAULT NULL,
  p_anchor_end int DEFAULT NULL,
  p_version_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  quien uuid := current_app_user();
  app_del_agente uuid;
  agente_activo boolean;
  documento uuid;
  nuevo uuid;
BEGIN
  IF quien IS NULL THEN
    RAISE EXCEPTION 'An agent thread needs the identity of whoever triggered it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- La app existe, la ve quien llama y admite escritura. Mismo predicado que
  -- `apps_visible`, escrito a mano porque una función con dueño propio no ve
  -- las políticas de nadie.
  SELECT d.id INTO documento
  FROM apps a
  JOIN documents d ON d.app_id = a.id AND d.type = 'VISION'
  WHERE a.id = p_app_id
    AND a.archived_at IS NULL
    AND a.workspace_id IN (SELECT user_workspaces(quien))
    AND (a.access_level <> 'PRIVATE' OR a.precursor_id = quien);

  IF documento IS NULL THEN
    RAISE EXCEPTION 'That app does not exist here'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT ag.app_id, ag.active AND ag.removed_at IS NULL
    INTO app_del_agente, agente_activo
  FROM agents ag WHERE ag.id = p_agent_id;

  IF app_del_agente IS DISTINCT FROM p_app_id THEN
    RAISE EXCEPTION 'That agent does not belong to this app'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT agente_activo THEN
    RAISE EXCEPTION 'That agent is not active in this app'
      USING ERRCODE = 'check_violation';
  END IF;

  -- La revisión, si viene, tiene que ser de esta app y seguir viva: un trabajo
  -- que llega tarde no sigue escribiendo lo que alguien mandó parar (RF-1610).
  IF p_review_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM agent_reviews r
      WHERE r.id = p_review_id AND r.app_id = p_app_id AND r.status = 'RUNNING'
    ) THEN
      RAISE EXCEPTION 'That review is not running any more'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF p_kind = 'INLINE' AND (p_anchor_quote IS NULL OR p_version_id IS NULL) THEN
    RAISE EXCEPTION 'An inline thread needs its quote and its version'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO comment_threads (
    app_id, document_id, kind, anchor_quote, anchor_prefix, anchor_suffix,
    anchor_start, anchor_end, anchored_version_id, anchor_status,
    review_id, created_by_agent_id
  )
  VALUES (
    p_app_id, documento, p_kind, p_anchor_quote, p_anchor_prefix, p_anchor_suffix,
    p_anchor_start, p_anchor_end, p_version_id,
    CASE WHEN p_kind = 'INLINE' THEN 'ANCHORED'::anchor_status ELSE NULL END,
    p_review_id, p_agent_id
  )
  RETURNING id INTO nuevo;

  RETURN nuevo;
END
$$;--> statement-breakpoint

ALTER FUNCTION agent_open_thread(uuid, uuid, uuid, thread_kind, text, text, text, int, int, uuid)
  OWNER TO agent_writer;--> statement-breakpoint
REVOKE ALL ON FUNCTION agent_open_thread(uuid, uuid, uuid, thread_kind, text, text, text, int, int, uuid)
  FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION agent_open_thread(uuid, uuid, uuid, thread_kind, text, text, text, int, int, uuid)
  TO app_user;--> statement-breakpoint

COMMENT ON FUNCTION agent_open_thread(uuid, uuid, uuid, thread_kind, text, text, text, int, int, uuid) IS
  'Única forma de que el rol de la aplicación abra un hilo a nombre de un agente: exige identidad de quien lo provocó, app visible y no archivada, agente activo de esa app y revisión viva (BJ3, T-27).';
