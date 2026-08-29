-- Aislamiento de apps y documentos: la traducción literal de la tabla 3.6 de
-- REQUIREMENTS al motor.

ALTER TABLE apps ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE apps FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE app_tags ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE app_tags FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE documents FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE document_versions FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- K3 · Quién ve una app
-- ---------------------------------------------------------------------------
-- Pertenecer al workspace, y además —si la app es privada— ser su precursor.
-- No hay excepción para el administrador de plataforma: gestiona cuentas, no
-- contenido (D-6).
CREATE POLICY apps_visible ON apps
  FOR SELECT
  USING (
    workspace_id IN (SELECT user_workspaces(current_app_user()))
    AND (access_level <> 'PRIVATE' OR precursor_id = current_app_user())
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- K5 · Lo que crea un invitado nace compartido
-- ---------------------------------------------------------------------------
-- Cualquier miembro crea apps (RF-401), pero solo el dueño del workspace elige
-- el nivel de acceso: lo que crea un invitado nace y permanece en
-- WORKSPACE_WRITE, porque nadie usa el espacio de otro como cajón privado
-- (D-9). La condición va en el WITH CHECK, así que la regla se aplica aunque
-- la aplicación se despiste.
CREATE POLICY apps_insert ON apps
  FOR INSERT
  WITH CHECK (
    workspace_id IN (SELECT user_workspaces(current_app_user()))
    AND precursor_id = current_app_user()
    AND (
      access_level = 'WORKSPACE_WRITE'
      OR EXISTS (
        SELECT 1 FROM workspaces w
        WHERE w.id = apps.workspace_id AND w.owner_id = current_app_user()
      )
    )
  );
--> statement-breakpoint

-- Editar: el precursor siempre; el resto del workspace solo si la app está en
-- WORKSPACE_WRITE. Una app archivada no se edita (RF-409).
CREATE POLICY apps_update ON apps
  FOR UPDATE
  USING (
    archived_at IS NULL
    AND workspace_id IN (SELECT user_workspaces(current_app_user()))
    AND (precursor_id = current_app_user() OR access_level = 'WORKSPACE_WRITE')
  )
  WITH CHECK (
    workspace_id IN (SELECT user_workspaces(current_app_user()))
    AND (precursor_id = current_app_user() OR access_level = 'WORKSPACE_WRITE')
  );
--> statement-breakpoint

-- Eliminar es cosa del precursor y de nadie más (RF-411).
CREATE POLICY apps_delete ON apps
  FOR DELETE
  USING (precursor_id = current_app_user());
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- K5 (segunda mitad) · El nivel de acceso, una vez fijado
-- ---------------------------------------------------------------------------
-- La RLS filtra filas, no columnas: la política de UPDATE deja editar la app,
-- y eso incluiría cambiar su nivel de acceso. Quien puede cambiarlo es solo el
-- precursor que además es dueño del workspace (RF-406), y esa condición
-- depende de dos tablas, así que se comprueba en un trigger.
CREATE OR REPLACE FUNCTION apps_check_access_level_change() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.access_level IS DISTINCT FROM OLD.access_level THEN
    IF OLD.precursor_id <> current_app_user() THEN
      RAISE EXCEPTION 'Solo el precursor puede cambiar el nivel de acceso'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = NEW.workspace_id AND w.owner_id = current_app_user()
    ) THEN
      RAISE EXCEPTION 'El nivel de acceso de una app creada en un workspace ajeno queda fijado'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE TRIGGER apps_access_level_guard
  BEFORE UPDATE ON apps
  FOR EACH ROW EXECUTE FUNCTION apps_check_access_level_change();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- K6 · Herencia del rol de precursor
-- ---------------------------------------------------------------------------
-- Si alguien deja un workspace, sus apps se quedan y pasan al dueño (RF-413,
-- D-10). Va en un trigger y no en la aplicación porque la salida ocurre por dos
-- caminos distintos —expulsión y abandono— y una app huérfana sería
-- irrecuperable desde la interfaz.
--
-- El historial no se toca: cada versión sigue atribuida a quien la escribió.
CREATE OR REPLACE FUNCTION workspace_members_reassign_apps() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  nuevo_precursor uuid;
BEGIN
  SELECT owner_id INTO nuevo_precursor FROM workspaces WHERE id = OLD.workspace_id;
  IF nuevo_precursor IS NULL OR nuevo_precursor = OLD.user_id THEN
    RETURN OLD;
  END IF;

  UPDATE apps
  SET precursor_id = nuevo_precursor, updated_at = now()
  WHERE workspace_id = OLD.workspace_id AND precursor_id = OLD.user_id;

  RETURN OLD;
END
$$;
--> statement-breakpoint

CREATE TRIGGER workspace_members_reassign_apps_on_leave
  AFTER DELETE ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION workspace_members_reassign_apps();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- K4 · Documentos y versiones heredan la visibilidad de su app
-- ---------------------------------------------------------------------------
-- La regla vive en un solo sitio: si cambia quién ve una app, cambia con ella
-- quién ve su documento y su historial.
CREATE POLICY documents_visible ON documents
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM apps a WHERE a.id = documents.app_id));
--> statement-breakpoint

CREATE POLICY documents_write ON documents
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM apps a
      WHERE a.id = documents.app_id
        AND a.archived_at IS NULL
        AND (a.precursor_id = current_app_user() OR a.access_level = 'WORKSPACE_WRITE')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM apps a
      WHERE a.id = documents.app_id
        AND a.archived_at IS NULL
        AND (a.precursor_id = current_app_user() OR a.access_level = 'WORKSPACE_WRITE')
    )
  );
--> statement-breakpoint

CREATE POLICY document_versions_visible ON document_versions
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM documents d WHERE d.id = document_versions.document_id));
--> statement-breakpoint

-- Solo se insertan versiones, y siempre a nombre propio: una versión atribuida
-- a otro haría inútil el historial de autoría del que salen los contribuidores.
CREATE POLICY document_versions_insert ON document_versions
  FOR INSERT
  WITH CHECK (
    author_id = current_app_user()
    AND EXISTS (
      SELECT 1 FROM documents d
      JOIN apps a ON a.id = d.app_id
      WHERE d.id = document_versions.document_id
        AND a.archived_at IS NULL
        AND (a.precursor_id = current_app_user() OR a.access_level = 'WORKSPACE_WRITE')
    )
  );
--> statement-breakpoint

-- Las versiones son inmutables (RF-505): ni se modifican ni se borran.
REVOKE UPDATE, DELETE ON document_versions FROM app_user;--> statement-breakpoint

-- Las etiquetas siguen a su app.
CREATE POLICY app_tags_visible ON app_tags
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM apps a WHERE a.id = app_tags.app_id));
--> statement-breakpoint

CREATE POLICY app_tags_write ON app_tags
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM apps a
      WHERE a.id = app_tags.app_id
        AND a.archived_at IS NULL
        AND (a.precursor_id = current_app_user() OR a.access_level = 'WORKSPACE_WRITE')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM apps a
      WHERE a.id = app_tags.app_id
        AND a.archived_at IS NULL
        AND (a.precursor_id = current_app_user() OR a.access_level = 'WORKSPACE_WRITE')
    )
  );
