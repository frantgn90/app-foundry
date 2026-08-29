-- Cambios de rol y de estado de cuenta.
--
-- Tras cerrar el autoascenso (0004), app_user ya no puede escribir en
-- platform_role ni en status. Alguien tiene que poder hacerlo —el administrador
-- de plataforma— y esa es la única vía: funciones acotadas cuyo permiso de uso
-- comprueba la capa de dominio antes de invocarlas (canManageAccounts).
--
-- El riesgo se acota en el propio SQL: no se puede dejar la instancia sin
-- ningún administrador activo, pase lo que pase en la aplicación.
CREATE OR REPLACE FUNCTION auth_set_platform_role(uid uuid, nuevo platform_role)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE users SET platform_role = nuevo, updated_at = now() WHERE id = uid;

  IF NOT EXISTS (
    SELECT 1 FROM users WHERE platform_role = 'ADMIN' AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'La instancia no puede quedarse sin ningún administrador activo'
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth_set_user_status(uid uuid, nuevo user_status)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE users SET status = nuevo, updated_at = now() WHERE id = uid;

  -- Desactivar corta el acceso al instante: sus sesiones se borran aquí mismo,
  -- en la misma transacción (RF-110).
  IF nuevo = 'DEACTIVATED' THEN
    DELETE FROM sessions WHERE user_id = uid;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM users WHERE platform_role = 'ADMIN' AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'La instancia no puede quedarse sin ningún administrador activo'
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;
--> statement-breakpoint

-- Solo se aplica en una instancia que aún no tiene administradores: es el
-- arranque en frío (RF-111), no una puerta trasera permanente.
CREATE OR REPLACE FUNCTION auth_bootstrap_admin(gh_handle citext) RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  ascendido boolean := false;
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE platform_role = 'ADMIN' AND status = 'ACTIVE') THEN
    RETURN false;
  END IF;

  UPDATE users SET platform_role = 'ADMIN', updated_at = now()
  WHERE handle = gh_handle AND status = 'ACTIVE';

  GET DIAGNOSTICS ascendido = ROW_COUNT;
  RETURN ascendido;
END
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION auth_set_platform_role(uuid, platform_role) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_set_user_status(uuid, user_status) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_bootstrap_admin(citext) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_set_platform_role(uuid, platform_role) TO app_user;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_set_user_status(uuid, user_status) TO app_user;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_bootstrap_admin(citext) TO app_user;
