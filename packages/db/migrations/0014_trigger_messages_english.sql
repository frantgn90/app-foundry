-- Los mensajes de los triggers acaban en el navegador, así que son interfaz y
-- van en inglés (RNF-502). Los comentarios del esquema siguen en español.
CREATE OR REPLACE FUNCTION apps_check_access_level_change() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.access_level IS DISTINCT FROM OLD.access_level THEN
    IF OLD.precursor_id <> current_app_user() THEN
      RAISE EXCEPTION 'Only the precursor can change the access level'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = NEW.workspace_id AND w.owner_id = current_app_user()
    ) THEN
      RAISE EXCEPTION 'Apps created in someone else''s workspace keep their access level'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION apps_check_archived_immutable() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NOT NULL THEN
    IF NEW.name IS DISTINCT FROM OLD.name
       OR NEW.short_description IS DISTINCT FROM OLD.short_description
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.access_level IS DISTINCT FROM OLD.access_level
       OR NEW.icon_emoji IS DISTINCT FROM OLD.icon_emoji
       OR NEW.icon_color IS DISTINCT FROM OLD.icon_color
       OR NEW.repo_url IS DISTINCT FROM OLD.repo_url THEN
      RAISE EXCEPTION 'This app is archived and read-only: unarchive it first'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth_set_platform_role(uid uuid, nuevo platform_role)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE users SET platform_role = nuevo, updated_at = now() WHERE id = uid;
  IF NOT EXISTS (SELECT 1 FROM users WHERE platform_role = 'ADMIN' AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'The instance cannot be left without an active administrator'
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
  IF nuevo = 'DEACTIVATED' THEN
    DELETE FROM sessions WHERE user_id = uid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE platform_role = 'ADMIN' AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'The instance cannot be left without an active administrator'
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;
