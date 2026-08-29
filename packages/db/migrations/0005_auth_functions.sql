-- Operaciones que ocurren **antes** de que exista identidad.
--
-- El login y la validación de sesión son la pescadilla que se muerde la cola:
-- necesitan tocar la base de datos para averiguar quién eres, pero las
-- políticas solo funcionan cuando ya se sabe. En lugar de abrir las tablas, se
-- expone un puñado de funciones SECURITY DEFINER de superficie mínima: cada una
-- exige un identificador exacto —un github_id, un hash de token— y devuelve solo
-- lo imprescindible. Ninguna admite filtros ni devuelve listados, así que no
-- sirven para enumerar (T-19).

-- ---------------------------------------------------------------------------
-- Alta y actualización del usuario en cada login
-- ---------------------------------------------------------------------------
-- La identidad es el github_id: handle y email pueden cambiar en GitHub sin
-- que la persona deje de ser la misma, y se refrescan aquí (RF-104, RF-208).
CREATE OR REPLACE FUNCTION auth_upsert_user(
  gh_id bigint, gh_handle citext, gh_email citext,
  gh_name text, gh_avatar text
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  uid uuid;
BEGIN
  INSERT INTO users (github_id, handle, email, display_name, avatar_url, last_login_at)
  VALUES (gh_id, gh_handle, gh_email, gh_name, gh_avatar, now())
  ON CONFLICT (github_id) DO UPDATE
    SET handle = EXCLUDED.handle,
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        avatar_url = EXCLUDED.avatar_url,
        last_login_at = now(),
        updated_at = now()
  RETURNING id INTO uid;

  RETURN uid;
END
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION auth_upsert_user(bigint, citext, citext, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_upsert_user(bigint, citext, citext, text, text) TO app_user;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Invitaciones pendientes al darse de alta (RF-106)
-- ---------------------------------------------------------------------------
-- Quien acaba de entrar no puede leer sus propias invitaciones: la política las
-- reserva al dueño del workspace, y con razón. Esta función las aplica en su
-- nombre, acotada a un usuario y su email verificado.
CREATE OR REPLACE FUNCTION auth_apply_pending_invitations(uid uuid, user_email citext)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  aplicadas integer := 0;
BEGIN
  WITH vigentes AS (
    SELECT id, workspace_id
    FROM workspace_invitations
    WHERE email = user_email
      AND status = 'PENDING'
      AND expires_at > now()
  ), altas AS (
    INSERT INTO workspace_members (workspace_id, user_id, role)
    SELECT workspace_id, uid, 'MEMBER' FROM vigentes
    ON CONFLICT (workspace_id, user_id) DO NOTHING
    RETURNING workspace_id
  )
  UPDATE workspace_invitations
  SET status = 'ACCEPTED'
  WHERE id IN (SELECT id FROM vigentes);

  GET DIAGNOSTICS aplicadas = ROW_COUNT;
  RETURN aplicadas;
END
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION auth_apply_pending_invitations(uuid, citext) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_apply_pending_invitations(uuid, citext) TO app_user;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Sesiones
-- ---------------------------------------------------------------------------
-- Validar una sesión exige conocer el hash exacto del token, que solo tiene
-- quien posee el token. Se comprueba de paso que la cuenta siga activa, para
-- que desactivar a alguien corte el acceso al instante (RF-110).
CREATE OR REPLACE FUNCTION auth_find_session(hash bytea)
  RETURNS TABLE (session_id uuid, user_id uuid, expires_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT s.id, s.user_id, s.expires_at
  FROM sessions s
  JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = encode(hash, 'hex')
    AND s.expires_at > now()
    AND u.status = 'ACTIVE'
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth_create_session(
  uid uuid, hash bytea, expires timestamptz, ip inet, agent text
) RETURNS uuid
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  INSERT INTO sessions (user_id, token_hash, expires_at, ip_prefix, user_agent)
  VALUES (uid, encode(hash, 'hex'), expires, ip, agent)
  RETURNING id
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth_revoke_session(hash bytea) RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  DELETE FROM sessions WHERE token_hash = encode(hash, 'hex')
$$;
--> statement-breakpoint

-- Se usa al desactivar una cuenta: sus sesiones caen de inmediato (RF-110).
CREATE OR REPLACE FUNCTION auth_revoke_user_sessions(uid uuid) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  borradas integer;
BEGIN
  DELETE FROM sessions WHERE user_id = uid;
  GET DIAGNOSTICS borradas = ROW_COUNT;
  RETURN borradas;
END
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION auth_find_session(bytea) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_create_session(uuid, bytea, timestamptz, inet, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_revoke_session(bytea) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_revoke_user_sessions(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_find_session(bytea) TO app_user;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_create_session(uuid, bytea, timestamptz, inet, text) TO app_user;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_revoke_session(bytea) TO app_user;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_revoke_user_sessions(uuid) TO app_user;
