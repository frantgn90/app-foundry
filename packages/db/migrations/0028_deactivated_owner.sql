-- Qué pasa con las apps cuando se desactiva a quien las sostiene (RF-414).

-- Cuándo se desactivó, que hoy no se sabía: `updated_at` cambia por cualquier
-- cosa y no sirve de reloj para contar el plazo de gracia.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- El dueño inactivo esconde su workspace personal
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER porque la comprobación mira la cuenta del dueño, que quien
-- consulta no tiene por qué poder ver. Recibe un workspace y devuelve un
-- booleano: no lista, no acepta filtros y no sirve para enumerar a nadie.
CREATE OR REPLACE FUNCTION workspace_owner_is_active(ws uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspaces w
    JOIN users u ON u.id = w.owner_id
    WHERE w.id = ws AND u.status = 'ACTIVE'
  );
$$;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION workspace_owner_is_active(uuid) TO app_user;--> statement-breakpoint

-- Mientras su dueño esté desactivado, su workspace personal no se puede abrir:
-- las apps quedan huérfanas, ni suyas ni de nadie (RF-414).
--
-- No hace falta marcar nada ni deshacer nada después: la condición mira el
-- estado de ahora mismo, así que reactivar la cuenta las devuelve solas. Un
-- interruptor que hay que acordarse de volver a poner es un interruptor que
-- algún día se queda a medias.
--
-- Solo el workspace personal. En uno ajeno, la app es del sitio y no de la
-- persona: esconderla castigaría a todo un equipo porque alguien esté
-- suspendido, y para eso está la herencia de abajo.
DROP POLICY apps_visible ON apps;--> statement-breakpoint

CREATE POLICY apps_visible ON apps
  FOR SELECT
  USING (
    workspace_id IN (SELECT user_workspaces(current_app_user()))
    AND (access_level <> 'PRIVATE' OR precursor_id = current_app_user())
    AND (
      NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.id = apps.workspace_id AND w.is_personal)
      OR workspace_owner_is_active(apps.workspace_id)
    )
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Desactivar reparte lo que estaba a nombre de esa persona
-- ---------------------------------------------------------------------------
-- Sus apps en workspaces ajenos pasan al dueño de cada uno, igual que al salir
-- o al ser expulsado: el equipo no puede quedarse sin poder tocar un documento
-- porque hayan suspendido a quien lo empezó.
DROP FUNCTION IF EXISTS auth_set_user_status(uuid, user_status);--> statement-breakpoint

CREATE FUNCTION auth_set_user_status(uid uuid, nuevo user_status)
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
         -- El reloj del plazo de gracia arranca al desactivar y se borra al
         -- reactivar: volver deja la cuenta como si nunca se hubiera ido.
         deactivated_at = CASE WHEN nuevo = 'DEACTIVATED' THEN now() ELSE NULL END,
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

    -- Sus sesiones se borran aquí mismo, en la misma transacción (RF-110), y se
    -- devuelven para que la caché las suelte también.
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
