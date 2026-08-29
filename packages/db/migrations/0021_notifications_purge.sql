-- Purga automática de avisos (RF-910).

-- ---------------------------------------------------------------------------
-- Z4 · La purga no puede pasar por las políticas
-- ---------------------------------------------------------------------------
-- Un aviso deja de verse cuando su dueño pierde el acceso al workspace, y
-- Postgres aplica las políticas de lectura también al resolver el WHERE de un
-- borrado: para el rol de la aplicación esos avisos son intocables. Si la purga
-- corriera con esas políticas, serían justo los que nunca se limpiarían, que es
-- lo contrario de lo que se pretende.
--
-- De ahí SECURITY DEFINER. La superficie es estrecha: no recibe a quién borrar
-- ni acepta condiciones, solo los dos números de la configuración, y devuelve
-- cuántas filas se llevó por delante.
--
-- No toca nada de lo que los avisos apuntaban (RF-911): borra en `notifications`
-- y esta tabla no tiene ninguna baja en cascada hacia comentarios ni versiones.
CREATE OR REPLACE FUNCTION notif_purge(retention_days integer, max_per_user integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  borradas integer := 0;
  parcial integer;
BEGIN
  IF retention_days <= 0 OR max_per_user <= 0 THEN
    RAISE EXCEPTION 'La purga necesita valores positivos';
  END IF;

  -- Primero por antigüedad, y solo lo ya leído: un aviso viejo sin leer sigue
  -- siendo algo que esa persona no ha visto todavía.
  DELETE FROM notifications
  WHERE read_at IS NOT NULL
    AND read_at < now() - make_interval(days => retention_days);
  GET DIAGNOSTICS parcial = ROW_COUNT;
  borradas := borradas + parcial;

  -- Y después el tope por persona, que es el que garantiza que esto no crece sin
  -- límite aunque nadie lea nada. Aquí sí entra lo no leído: con el tope puesto,
  -- conservar los más recientes es lo más útil que se puede hacer.
  WITH numeradas AS (
    SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS puesto
    FROM notifications
  )
  DELETE FROM notifications n
  USING numeradas
  WHERE n.id = numeradas.id AND numeradas.puesto > max_per_user;
  GET DIAGNOSTICS parcial = ROW_COUNT;

  RETURN borradas + parcial;
END;
$$;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION notif_purge(integer, integer) TO app_user;
