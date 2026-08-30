-- Desactivar devuelve las sesiones que ha tirado, para poder vaciar su caché.

-- Las sesiones se validan contra una caché en Redis para no ir a la base de
-- datos en cada petición. El efecto secundario es que borrar las filas no basta:
-- lo cacheado sigue siendo válido hasta que caduca, y «desactivar» pasaba a
-- significar «dentro de un rato», que no es lo que dice RF-203.
--
-- La caché va indexada por el hash del token, que no se puede reconstruir, así
-- que hay que saber cuáles borrar. La propia función lo dice ahora: devuelve los
-- hashes que acaba de tirar. Se prefiere esto a llevar un índice aparte en Redis
-- porque la tabla es la fuente de verdad y así se cubren todas las sesiones,
-- incluidas las que existían antes de este cambio.
DROP FUNCTION IF EXISTS auth_set_user_status(uuid, user_status);--> statement-breakpoint

CREATE FUNCTION auth_set_user_status(uid uuid, nuevo user_status)
  RETURNS SETOF text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE users SET status = nuevo, updated_at = now() WHERE id = uid;

  -- Desactivar corta el acceso: sus sesiones se borran aquí mismo, en la misma
  -- transacción (RF-110), y se devuelven para que la caché las suelte también.
  IF nuevo = 'DEACTIVATED' THEN
    RETURN QUERY DELETE FROM sessions WHERE user_id = uid RETURNING token_hash;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM users WHERE platform_role = 'ADMIN' AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'La instancia no puede quedarse sin ningún administrador activo'
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION auth_set_user_status(uuid, user_status) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_set_user_status(uuid, user_status) TO app_user;
