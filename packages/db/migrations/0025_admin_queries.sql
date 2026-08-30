-- Lo que un administrador de la instancia puede consultar (RF-201, RF-204).

-- ---------------------------------------------------------------------------
-- AH1 · Listar cuentas sin abrir la tabla de usuarios
-- ---------------------------------------------------------------------------
-- La política de `users` deja ver a los compañeros de workspace y a nadie más,
-- y así debe seguir: es lo que impide que mencionar a alguien sirva para
-- averiguar quién tiene cuenta aquí (RF-815).
--
-- Ampliarla para el administrador sería más corto, pero le haría ver a todo el
-- mundo en cualquier consulta, incluida la lista de gente mencionable. Un
-- administrador tiene derecho a listar cuentas; no a que mencionar se comporte
-- distinto para él. Por eso una función acotada, que devuelve exactamente lo que
-- pide RF-201 y ni un campo más: ni emails de gente con la que no comparte nada,
-- ni nada que se acerque al contenido de un workspace ajeno (D-6).
--
-- No comprueba el rol: eso lo hace la capa de dominio antes de llamar, como con
-- las demás funciones de administración. Lo que sí hace es no permitir filtrar
-- por nada, de modo que no sirve para preguntar por una persona concreta.
CREATE OR REPLACE FUNCTION admin_list_users()
RETURNS TABLE (
  id uuid,
  handle citext,
  display_name text,
  avatar_url text,
  platform_role platform_role,
  status user_status,
  created_at timestamptz,
  last_login_at timestamptz,
  workspace_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.handle, u.display_name, u.avatar_url, u.platform_role, u.status,
         u.created_at, u.last_login_at,
         (SELECT count(*) FROM workspace_members m WHERE m.user_id = u.id)
    FROM users u
   ORDER BY u.created_at DESC;
$$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- AH4 · Métricas de la instancia, que son cuentas y nada más
-- ---------------------------------------------------------------------------
-- Números agregados: cuántos hay de cada cosa. Ni nombres, ni identificadores,
-- ni una sola fila de contenido (RF-204).
CREATE OR REPLACE FUNCTION admin_instance_metrics()
RETURNS TABLE (
  users_total bigint,
  users_active bigint,
  workspaces_total bigint,
  apps_total bigint,
  apps_archived bigint,
  versions_total bigint,
  threads_open bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (SELECT count(*) FROM users),
         (SELECT count(*) FROM users WHERE status = 'ACTIVE'),
         (SELECT count(*) FROM workspaces),
         (SELECT count(*) FROM apps),
         (SELECT count(*) FROM apps WHERE archived_at IS NOT NULL),
         (SELECT count(*) FROM document_versions),
         (SELECT count(*) FROM comment_threads WHERE status = 'OPEN');
$$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- AI1 · Auditoría de plataforma
-- ---------------------------------------------------------------------------
-- Solo los eventos que no son de ningún workspace: altas, sesiones, roles. Lo
-- que pasa dentro de un workspace es de su dueño, no del administrador de la
-- instancia (RF-703 frente a RF-704).
CREATE OR REPLACE FUNCTION admin_platform_audit(
  desde timestamptz,
  hasta timestamptz,
  quien uuid,
  tope integer
)
RETURNS TABLE (
  id uuid,
  actor_id uuid,
  actor_handle citext,
  action text,
  resource_type text,
  resource_id uuid,
  metadata jsonb,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.id, a.actor_id, u.handle, a.action, a.resource_type, a.resource_id,
         a.metadata, a.created_at
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_id
   WHERE a.workspace_id IS NULL
     AND (desde IS NULL OR a.created_at >= desde)
     AND (hasta IS NULL OR a.created_at <= hasta)
     AND (quien IS NULL OR a.actor_id = quien)
   ORDER BY a.created_at DESC
   LIMIT least(greatest(coalesce(tope, 100), 1), 500);
$$;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION admin_list_users() TO app_user;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION admin_instance_metrics() TO app_user;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION admin_platform_audit(timestamptz, timestamptz, uuid, integer) TO app_user;
