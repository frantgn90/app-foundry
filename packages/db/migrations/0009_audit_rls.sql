-- Quién puede leer la auditoría, y quién no puede tocarla.

-- ¿Es administrador de plataforma quien hace la petición?
-- Va en una función para no repetir la subconsulta en cada política y para que
-- la comprobación viva en un solo sitio si algún día cambia.
CREATE OR REPLACE FUNCTION is_platform_admin() RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE id = current_app_user() AND platform_role = 'ADMIN' AND status = 'ACTIVE'
  )
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION is_platform_admin() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION is_platform_admin() TO app_user;--> statement-breakpoint

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Solo escritura desde la aplicación (RF-705): sin UPDATE ni DELETE, la
-- inmutabilidad la garantizan los permisos de Postgres y no el cuidado de quien
-- escribe el código.
REVOKE UPDATE, DELETE ON audit_log FROM app_user;--> statement-breakpoint

-- Cada uno solo puede registrar acciones a su propio nombre: WITH CHECK impide
-- fabricar entradas atribuidas a otro, que es lo único que haría inútil un
-- registro de auditoría.
CREATE POLICY audit_log_insert_propio ON audit_log
  FOR INSERT
  WITH CHECK (actor_id = current_app_user());
--> statement-breakpoint

-- Lectura: el administrador de plataforma ve los eventos de plataforma —los que
-- no pertenecen a ningún workspace— y el dueño de un workspace ve los suyos
-- (RF-703, RF-704). Ni el admin entra en la actividad de un workspace ajeno,
-- que sería contradecir D-6.
CREATE POLICY audit_log_lectura ON audit_log
  FOR SELECT
  USING (
    (workspace_id IS NULL AND is_platform_admin())
    OR EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = audit_log.workspace_id AND w.owner_id = current_app_user()
    )
  );
