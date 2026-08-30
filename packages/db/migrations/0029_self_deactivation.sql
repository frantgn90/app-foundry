-- Darse de baja uno mismo, y poder volver (RF-207).

-- Quién apagó la cuenta. Distingue las dos situaciones que hasta ahora se
-- veían igual: una suspensión decidida por un administrador y una baja pedida
-- por la propia persona. Se parecen en el estado y no en lo que debe pasar
-- después: de una baja voluntaria se puede volver entrando; de una suspensión,
-- no, o la suspensión no serviría de nada.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_by uuid REFERENCES users(id);--> statement-breakpoint

-- El administrador sigue desactivando igual; ahora deja su firma.
DROP FUNCTION IF EXISTS auth_set_user_status(uuid, user_status);--> statement-breakpoint

CREATE FUNCTION auth_set_user_status(uid uuid, nuevo user_status, por uuid DEFAULT NULL)
  RETURNS SETOF text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  ws uuid;
BEGIN
  UPDATE users
     SET status = nuevo,
         deactivated_at = CASE WHEN nuevo = 'DEACTIVATED' THEN now() ELSE NULL END,
         deactivated_by = CASE WHEN nuevo = 'DEACTIVATED' THEN coalesce(por, uid) ELSE NULL END,
         updated_at = now()
   WHERE id = uid;

  IF nuevo = 'DEACTIVATED' THEN
    FOR ws IN
      SELECT DISTINCT a.workspace_id
        FROM apps a
        JOIN workspaces w ON w.id = a.workspace_id
       WHERE a.precursor_id = uid AND w.owner_id <> uid
    LOOP
      PERFORM workspace_inherit_apps(ws, uid);
    END LOOP;

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

REVOKE ALL ON FUNCTION auth_set_user_status(uuid, user_status, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_set_user_status(uuid, user_status, uuid) TO app_user;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Volver dentro del plazo
-- ---------------------------------------------------------------------------
-- Al entrar se comprueba si esta cuenta se dio de baja ella misma y sigue
-- dentro del periodo de gracia. Si es así, vuelve sola: es lo que hace que la
-- baja sea reversible sin tener que pedírselo a nadie.
--
-- Solo si se apagó ella misma. Reactivar aquí una cuenta suspendida por un
-- administrador convertiría la suspensión en un incordio de un solo intento.
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

  UPDATE users
     SET status = 'ACTIVE',
         deactivated_at = NULL,
         deactivated_by = NULL
   WHERE id = uid
     AND status = 'DEACTIVATED'
     AND deactivated_by = uid
     AND deactivated_at > now() - interval '90 days';

  RETURN uid;
END
$$;
