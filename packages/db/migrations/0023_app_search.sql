ALTER TABLE "apps" ADD COLUMN "search_tsv" "tsvector";--> statement-breakpoint
CREATE INDEX "apps_search_idx" ON "apps" USING gin ("search_tsv");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- AC1 · Lo que se busca lo mantiene la base de datos
-- ---------------------------------------------------------------------------
-- El texto de una app está repartido en tres tablas: su nombre y descripción,
-- el contenido de su visión y sus etiquetas. Recalcularlo desde la aplicación
-- obligaría a acordarse en cada sitio que escribe, y el día que aparezca otro
-- camino —una importación, el servidor MCP— la búsqueda empezaría a mentir sin
-- que nada fallara. Aquí no hay forma de olvidarse.
--
-- Va en SECURITY DEFINER porque se dispara desde escrituras en `documents` y en
-- `app_tags`, y el UPDATE sobre `apps` pasaría por sus propias políticas: quien
-- puede editar una visión no necesariamente puede tocar la fila de la app, y ese
-- rechazo abortaría el guardado entero por culpa de un índice.
--
-- Se usa el diccionario `simple`, que no intenta reducir palabras a su raíz. Los
-- demás asumen un idioma, y aquí conviven documentos en español y en inglés: con
-- `english`, «visión» y «visiones» serían palabras distintas y «planning» se
-- reduciría a «plan» solo en la mitad de los textos. A cambio de esa pérdida, la
-- búsqueda añade prefijos al consultar (§10), que cubre plurales y derivados sin
-- tener que adivinar el idioma de nadie.
CREATE OR REPLACE FUNCTION apps_refresh_search(target uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE apps a SET search_tsv =
      -- El nombre pesa más que el resto: quien busca «Idea Board» quiere esa
      -- app, no las diez que la mencionan de pasada.
      setweight(to_tsvector('simple', coalesce(a.name, '')), 'A')
   || setweight(to_tsvector('simple', coalesce(a.short_description, '')), 'B')
   || setweight(to_tsvector('simple', coalesce((
        SELECT string_agg(t.tag::text, ' ') FROM app_tags t WHERE t.app_id = a.id
      ), '')), 'B')
   || setweight(to_tsvector('simple', coalesce((
        SELECT d.current_content FROM documents d
        WHERE d.app_id = a.id AND d.type = 'VISION'
      ), '')), 'C')
  WHERE a.id = target;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION apps_search_from_app() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM apps_refresh_search(NEW.id);
  RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION apps_search_from_document() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM apps_refresh_search(NEW.app_id);
  RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION apps_search_from_tag() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM apps_refresh_search(COALESCE(NEW.app_id, OLD.app_id));
  RETURN NULL;
END;
$$;--> statement-breakpoint

-- `AFTER` y no `BEFORE`: la función lee las otras tablas, y en `BEFORE` leería
-- el estado anterior a la propia escritura que la dispara.
CREATE TRIGGER apps_search_on_app
  AFTER INSERT OR UPDATE OF name, short_description ON apps
  FOR EACH ROW EXECUTE FUNCTION apps_search_from_app();--> statement-breakpoint

CREATE TRIGGER apps_search_on_document
  AFTER INSERT OR UPDATE OF current_content ON documents
  FOR EACH ROW EXECUTE FUNCTION apps_search_from_document();--> statement-breakpoint

CREATE TRIGGER apps_search_on_tag
  AFTER INSERT OR DELETE ON app_tags
  FOR EACH ROW EXECUTE FUNCTION apps_search_from_tag();--> statement-breakpoint

-- Lo que ya existe también tiene que poder encontrarse.
SELECT apps_refresh_search(id) FROM apps;
