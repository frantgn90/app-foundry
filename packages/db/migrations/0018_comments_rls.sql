-- Quién comenta, quién edita lo suyo y qué no se puede borrar.

ALTER TABLE comment_threads ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE comment_threads FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE comments FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE comment_mentions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE comment_mentions FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- R3 · Comentar solo exige permiso de lectura
-- ---------------------------------------------------------------------------
-- Compartir una idea es pedir opinión: dejar sin voz a quien solo puede leer
-- vaciaría de sentido el nivel WORKSPACE_READ (RF-803, D-12). Basta con que la
-- app sea visible, y de eso ya se encarga su propia política.
CREATE POLICY comment_threads_visible ON comment_threads
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM apps a WHERE a.id = comment_threads.app_id));
--> statement-breakpoint

-- Una app archivada deja sus comentarios en solo lectura (RF-812).
CREATE POLICY comment_threads_insert ON comment_threads
  FOR INSERT
  WITH CHECK (
    created_by = current_app_user()
    AND EXISTS (
      SELECT 1 FROM apps a WHERE a.id = comment_threads.app_id AND a.archived_at IS NULL
    )
  );
--> statement-breakpoint

-- Resolver y reabrir puede hacerlo cualquiera que participe en la conversación,
-- no solo quien abrió el hilo: una discusión se cierra cuando se acaba, y quien
-- la da por acabada suele ser quien responde.
CREATE POLICY comment_threads_update ON comment_threads
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM apps a WHERE a.id = comment_threads.app_id AND a.archived_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM apps a WHERE a.id = comment_threads.app_id)
  );
--> statement-breakpoint

-- Borrar un hilo entero: su autor o el precursor de la app (RF-806).
CREATE POLICY comment_threads_delete ON comment_threads
  FOR DELETE
  USING (
    created_by = current_app_user()
    OR EXISTS (
      SELECT 1 FROM apps a
      WHERE a.id = comment_threads.app_id AND a.precursor_id = current_app_user()
    )
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Comentarios
-- ---------------------------------------------------------------------------
CREATE POLICY comments_visible ON comments
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM comment_threads t WHERE t.id = comments.thread_id));
--> statement-breakpoint

-- Siempre a nombre propio: un comentario atribuido a otro es exactamente lo que
-- convierte una conversación en algo en lo que no se puede confiar.
CREATE POLICY comments_insert ON comments
  FOR INSERT
  WITH CHECK (
    author_id = current_app_user()
    AND EXISTS (
      SELECT 1 FROM comment_threads t
      JOIN apps a ON a.id = t.app_id
      WHERE t.id = comments.thread_id AND a.archived_at IS NULL
    )
  );
--> statement-breakpoint

-- Editar y borrar lo propio (RF-806). El precursor no edita comentarios ajenos
-- —eso sería poner palabras en boca de otro—, solo puede borrar hilos enteros.
CREATE POLICY comments_update_own ON comments
  FOR UPDATE
  USING (author_id = current_app_user())
  WITH CHECK (author_id = current_app_user());
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- R4 · El borrado es lógico
-- ---------------------------------------------------------------------------
-- Borrar de verdad dejaría huecos en la conversación y se llevaría por delante
-- las respuestas que colgaban de ese comentario. La aplicación marca
-- `deleted_at` y la interfaz muestra que ahí hubo algo.
REVOKE DELETE ON comments FROM app_user;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- R2 · Un solo nivel de anidamiento
-- ---------------------------------------------------------------------------
-- Se comprueba en el motor y no solo en la interfaz: una respuesta a una
-- respuesta convertiría el panel lateral en un árbol imposible de leer en una
-- columna estrecha, y basta una llamada mal formada para colarla (RF-804).
CREATE OR REPLACE FUNCTION comments_check_single_level() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
DECLARE
  abuelo uuid;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT parent_id INTO abuelo FROM comments WHERE id = NEW.parent_id;
  IF abuelo IS NOT NULL THEN
    RAISE EXCEPTION 'Replies only go one level deep'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE TRIGGER comments_single_level_guard
  BEFORE INSERT OR UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION comments_check_single_level();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Menciones
-- ---------------------------------------------------------------------------
CREATE POLICY comment_mentions_visible ON comment_mentions
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM comments c WHERE c.id = comment_mentions.comment_id));
--> statement-breakpoint

-- Solo se mencionan miembros del workspace: mencionar no puede servir para
-- averiguar quién más usa la plataforma ni para dar acceso por la puerta de
-- atrás (RF-815).
CREATE POLICY comment_mentions_insert ON comment_mentions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM comments c
      JOIN comment_threads t ON t.id = c.thread_id
      JOIN apps a ON a.id = t.app_id
      JOIN workspace_members m ON m.workspace_id = a.workspace_id
      WHERE c.id = comment_mentions.comment_id
        AND c.author_id = current_app_user()
        AND m.user_id = comment_mentions.user_id
    )
  );
