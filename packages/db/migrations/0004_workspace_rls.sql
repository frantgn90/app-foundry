-- Aislamiento completo por workspace, y cierre de las dos deudas de H0.

-- ---------------------------------------------------------------------------
-- F2 · Pertenencia del usuario actual
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER para romper la recursión: la política de `workspace_members`
-- no puede consultarse a sí misma a través de otra política. Su superficie es
-- mínima —recibe un uuid, devuelve identificadores de workspace— y no concatena
-- SQL ni acepta filtros arbitrarios.
CREATE OR REPLACE FUNCTION user_workspaces(uid uuid) RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT workspace_id FROM workspace_members WHERE user_id = uid
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION user_workspaces(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION user_workspaces(uuid) TO app_user;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- F6 · Lectura de usuario durante el login
-- ---------------------------------------------------------------------------
-- El login busca por github_id **antes** de que exista identidad, así que no
-- puede pasar por las políticas normales. En lugar de abrir la tabla, se expone
-- esta función: recibe un github_id concreto y devuelve solo lo que la
-- autenticación necesita. No admite filtros, no devuelve listados y no expone
-- a nadie más, así que no sirve para enumerar usuarios (T-19).
CREATE OR REPLACE FUNCTION auth_find_user_by_github_id(gh_id bigint)
  RETURNS TABLE (id uuid, github_id bigint, handle citext, email citext,
                 display_name text, avatar_url text, platform_role platform_role,
                 status user_status)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT u.id, u.github_id, u.handle, u.email, u.display_name, u.avatar_url,
         u.platform_role, u.status
  FROM users u
  WHERE u.github_id = gh_id
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION auth_find_user_by_github_id(bigint) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_find_user_by_github_id(bigint) TO app_user;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- F5 · Cierre del autoascenso a ADMIN
-- ---------------------------------------------------------------------------
-- La RLS filtra filas, no columnas: la política `users_self_update` permite a
-- cada uno modificar su propia fila, y eso incluía `platform_role`. El permiso
-- por columna lo impide en el motor, que es donde tiene que impedirse.
REVOKE UPDATE ON users FROM app_user;--> statement-breakpoint
GRANT UPDATE (display_name, avatar_url, handle, email, last_login_at, updated_at)
  ON users TO app_user;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- F4 · Ver a los compañeros de workspace
-- ---------------------------------------------------------------------------
-- Hasta ahora cada uno solo se veía a sí mismo. Las menciones y la autoría
-- necesitan ver a quienes comparten workspace, y a nadie más (RF-815).
DROP POLICY users_self_select ON users;--> statement-breakpoint

CREATE POLICY users_visible ON users
  FOR SELECT
  USING (
    id = current_app_user()
    OR EXISTS (
      SELECT 1 FROM workspace_members m
      WHERE m.user_id = users.id
        AND m.workspace_id IN (SELECT user_workspaces(current_app_user()))
    )
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- F3 · Políticas de workspaces, membresías e invitaciones
-- ---------------------------------------------------------------------------
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workspace_members FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workspace_invitations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workspace_invitations FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Se ven los workspaces a los que se pertenece. Ni uno más.
CREATE POLICY workspaces_visible ON workspaces
  FOR SELECT
  USING (id IN (SELECT user_workspaces(current_app_user())));
--> statement-breakpoint

-- Solo el dueño renombra su workspace.
CREATE POLICY workspaces_owner_update ON workspaces
  FOR UPDATE
  USING (owner_id = current_app_user())
  WITH CHECK (owner_id = current_app_user());
--> statement-breakpoint

-- Crear un workspace es siempre crearlo para uno mismo: WITH CHECK impide
-- fabricar espacios a nombre de otro.
CREATE POLICY workspaces_insert_own ON workspaces
  FOR INSERT
  WITH CHECK (owner_id = current_app_user());
--> statement-breakpoint

-- Se ven los miembros de los workspaces propios.
CREATE POLICY workspace_members_visible ON workspace_members
  FOR SELECT
  USING (workspace_id IN (SELECT user_workspaces(current_app_user())));
--> statement-breakpoint

-- Altas y bajas de miembros las hace el dueño. La excepción es marcharse: uno
-- puede borrar su propia membresía (RF-308), pero no la de otros.
CREATE POLICY workspace_members_owner_manage ON workspace_members
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_members.workspace_id AND w.owner_id = current_app_user()
    )
    OR user_id = current_app_user()
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_members.workspace_id AND w.owner_id = current_app_user()
    )
  );
--> statement-breakpoint

-- Las invitaciones de un workspace las ve y las gestiona su dueño. Quien las
-- recibe no las ve aquí: se le aplican al darse de alta (RF-106), y hasta
-- entonces ni siquiera tiene cuenta.
CREATE POLICY workspace_invitations_owner ON workspace_invitations
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_invitations.workspace_id AND w.owner_id = current_app_user()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_invitations.workspace_id AND w.owner_id = current_app_user()
    )
  );
