-- Archivar tiene que poder deshacerse (RF-409).
--
-- La política anterior exigía `archived_at IS NULL` para cualquier UPDATE, de
-- modo que una app archivada quedaba congelada para siempre: ni su propio
-- precursor podía desarchivarla. El síntoma era desconcertante, porque la
-- sentencia no fallaba, simplemente no afectaba a ninguna fila.
--
-- Ahora el precursor puede actuar sobre una app archivada, y un trigger impide
-- que ese permiso sirva para algo más que desarchivarla.
DROP POLICY apps_update ON apps;--> statement-breakpoint

CREATE POLICY apps_update ON apps
  FOR UPDATE
  USING (
    workspace_id IN (SELECT user_workspaces(current_app_user()))
    AND (
      -- Una app archivada solo la toca su precursor, y solo para revivirla.
      (archived_at IS NULL AND (precursor_id = current_app_user() OR access_level = 'WORKSPACE_WRITE'))
      OR (archived_at IS NOT NULL AND precursor_id = current_app_user())
    )
  )
  WITH CHECK (
    workspace_id IN (SELECT user_workspaces(current_app_user()))
    AND (precursor_id = current_app_user() OR access_level = 'WORKSPACE_WRITE')
  );
--> statement-breakpoint

-- Mientras está archivada, lo único que puede cambiar es su propio archivado.
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
      RAISE EXCEPTION 'Una app archivada está en solo lectura: desarchívala primero'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE TRIGGER apps_archived_guard
  BEFORE UPDATE ON apps
  FOR EACH ROW EXECUTE FUNCTION apps_check_archived_immutable();
